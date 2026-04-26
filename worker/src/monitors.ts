/**
 * Active Monitoring Engine
 *
 * After a booking job completes, the agent keeps watching.
 * This is what turns Onegent from a task executor into an ongoing personal operator.
 *
 * Three monitor types:
 *
 *   availability_watch — Auto-created when a step fails with no_availability.
 *     The agent checks every few hours and alerts the instant the slot opens.
 *     "Your 7pm reservation just became available at Le Bernardin."
 *
 *   reservation_check — Monitors booked reservations for cancellations.
 *     Detects when a booking link becomes invalid (404/410) — a strong signal
 *     that the reservation was cancelled or expired.
 *     "Your OpenTable reservation may have been cancelled — check now."
 *
 *   weather_alert — Monitors weather at the destination for trip dates.
 *     Uses the Open-Meteo free API (no key required). Alerts 48–72h in advance
 *     when bad weather is forecast, and surfaces the alternative plans from the
 *     original trip plan.
 *     "Rain expected in Paris on Saturday — here are your backup options."
 *
 * Check intervals:
 *   availability_watch  — every 3 hours (user is actively waiting)
 *   reservation_check   — every 24 hours (less urgent)
 *   weather_alert       — every 12 hours (useful ~3 days before trip)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type MonitorType = "availability_watch" | "reservation_check" | "weather_alert";
export type MonitorStatus = "active" | "triggered" | "paused" | "cancelled" | "resolved";

export interface AvailabilityWatchConfig {
  venue: string;
  apiEndpoint: string;
  body: Record<string, unknown>;
  targetTime?: string; // HH:MM — the slot we're watching for
}

export interface ReservationCheckConfig {
  venue: string;
  handoffUrl: string;
  bookingDate?: string; // YYYY-MM-DD, for context in the alert
}

export interface WeatherAlertConfig {
  destinationCity: string;
  tripDates: string[];   // YYYY-MM-DD[]
  lat?: number;
  lon?: number;
  alternatives?: string[]; // backup plan descriptions from the trip plan
}

export type MonitorConfig =
  | AvailabilityWatchConfig
  | ReservationCheckConfig
  | WeatherAlertConfig;

export interface BookingMonitor {
  id: string;
  job_id: string;
  session_id: string;
  step_index: number;
  step_label: string;
  step_emoji: string;
  type: MonitorType;
  config: MonitorConfig;
  status: MonitorStatus;
  last_checked_at: string | null;
  next_check_at: string;
  triggered_at: string | null;
  trigger_data: Record<string, unknown> | null;
  trigger_message: string | null;
  created_at: string;
}

export interface MonitorCheckResult {
  triggered: boolean;
  message?: string;
  data?: Record<string, unknown>;
  nextCheckAt: string;
}

// ── Check intervals ────────────────────────────────────────────────────────

export const CHECK_INTERVALS: Record<MonitorType, number> = {
  availability_watch: 3,   // hours
  reservation_check:  24,
  weather_alert:      12,
};

export function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

// ── Evaluation logic ───────────────────────────────────────────────────────

/** Main entry point — evaluate one monitor. */
export async function evaluateMonitor(
  monitor: BookingMonitor,
  baseUrl: string
): Promise<MonitorCheckResult> {
  try {
    switch (monitor.type) {
      case "availability_watch":
        return await checkAvailability(monitor.config as AvailabilityWatchConfig, baseUrl);
      case "reservation_check":
        return await checkReservation(monitor.config as ReservationCheckConfig);
      case "weather_alert":
        return await checkWeather(monitor.config as WeatherAlertConfig);
      default:
        return { triggered: false, nextCheckAt: hoursFromNow(24) };
    }
  } catch {
    // Never let a check failure crash the cron
    return {
      triggered: false,
      nextCheckAt: hoursFromNow(CHECK_INTERVALS[monitor.type]),
    };
  }
}

// ── availability_watch ─────────────────────────────────────────────────────

async function checkAvailability(
  config: AvailabilityWatchConfig,
  baseUrl: string
): Promise<MonitorCheckResult> {
  const res = await fetch(`${baseUrl}${config.apiEndpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config.body),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await res.json() as { status?: string; handoff_url?: string; selected_time?: string };

  if (data.status === "ready") {
    const timeStr = config.targetTime ? ` at ${config.targetTime}` : "";
    return {
      triggered: true,
      message: `${config.venue}${timeStr} is now available — tap to book before it fills up.`,
      data: { handoff_url: data.handoff_url, selected_time: data.selected_time },
      nextCheckAt: hoursFromNow(CHECK_INTERVALS.availability_watch),
    };
  }

  return {
    triggered: false,
    nextCheckAt: hoursFromNow(CHECK_INTERVALS.availability_watch),
  };
}

// ── reservation_check ──────────────────────────────────────────────────────

async function checkReservation(
  config: ReservationCheckConfig
): Promise<MonitorCheckResult> {
  let httpStatus = 200;
  try {
    const res = await fetch(config.handoffUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(8_000),
      redirect: "follow",
    });
    httpStatus = res.status;
  } catch {
    // Network error — don't trigger, try again later
    return { triggered: false, nextCheckAt: hoursFromNow(CHECK_INTERVALS.reservation_check) };
  }

  if (httpStatus === 404 || httpStatus === 410 || httpStatus === 403) {
    const dateStr = config.bookingDate ? ` on ${config.bookingDate}` : "";
    return {
      triggered: true,
      message: `Your reservation at ${config.venue}${dateStr} may have been cancelled — the booking link is no longer accessible.`,
      data: { httpStatus, handoffUrl: config.handoffUrl },
      nextCheckAt: hoursFromNow(CHECK_INTERVALS.reservation_check),
    };
  }

  return { triggered: false, nextCheckAt: hoursFromNow(CHECK_INTERVALS.reservation_check) };
}

// ── weather_alert ──────────────────────────────────────────────────────────

// WMO weather codes that warrant an alert
const BAD_WEATHER_CODES = new Set([
  45, 48,              // fog
  51, 53, 55,          // drizzle
  61, 63, 65,          // rain
  71, 73, 75, 77,      // snow
  80, 81, 82,          // rain showers
  85, 86,              // snow showers
  95, 96, 99,          // thunderstorm
]);

const WMO_DESCRIPTIONS: Record<number, string> = {
  45: "fog", 48: "icy fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "rain showers", 81: "showers", 82: "heavy showers",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "heavy thunderstorm",
};

async function checkWeather(config: WeatherAlertConfig): Promise<MonitorCheckResult> {
  // 1. Geocode city if we don't have coordinates
  let { lat, lon } = config;

  if (!lat || !lon) {
    try {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(config.destinationCity)}&count=1&language=en&format=json`,
        { signal: AbortSignal.timeout(5_000) }
      );
      const geoData = await geoRes.json() as { results?: Array<{ latitude: number; longitude: number }> };
      lat = geoData.results?.[0]?.latitude;
      lon = geoData.results?.[0]?.longitude;
    } catch {
      return { triggered: false, nextCheckAt: hoursFromNow(CHECK_INTERVALS.weather_alert) };
    }
  }

  if (!lat || !lon) {
    return { triggered: false, nextCheckAt: hoursFromNow(CHECK_INTERVALS.weather_alert) };
  }

  // 2. Fetch forecast for trip dates
  const dates = config.tripDates.filter((d) => d >= new Date().toISOString().slice(0, 10));
  if (dates.length === 0) {
    // Trip is in the past — stop monitoring
    return { triggered: false, nextCheckAt: hoursFromNow(9999) };
  }

  const startDate = dates[0];
  const endDate = dates[dates.length - 1] ?? startDate;

  let forecast: { time: string[]; weathercode: number[]; precipitation_probability_max: number[] } | undefined;
  try {
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,precipitation_probability_max&timezone=auto&start_date=${startDate}&end_date=${endDate}`,
      { signal: AbortSignal.timeout(8_000) }
    );
    const wData = await wRes.json() as { daily?: typeof forecast };
    forecast = wData.daily;
  } catch {
    return { triggered: false, nextCheckAt: hoursFromNow(CHECK_INTERVALS.weather_alert) };
  }

  if (!forecast) {
    return { triggered: false, nextCheckAt: hoursFromNow(CHECK_INTERVALS.weather_alert) };
  }

  // 3. Find bad weather days
  const badDays: Array<{ date: string; code: number; description: string; precipPct: number }> = [];

  for (let i = 0; i < forecast.time.length; i++) {
    const code = forecast.weathercode[i];
    const precipPct = forecast.precipitation_probability_max[i];
    if (BAD_WEATHER_CODES.has(code) || precipPct >= 70) {
      badDays.push({
        date: forecast.time[i],
        code,
        description: WMO_DESCRIPTIONS[code] ?? "bad weather",
        precipPct,
      });
    }
  }

  if (badDays.length === 0) {
    return { triggered: false, nextCheckAt: hoursFromNow(CHECK_INTERVALS.weather_alert) };
  }

  // Build human-readable alert
  const dayList = badDays
    .map((d) => `${new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} (${d.description}, ${d.precipPct}% rain)`)
    .join(", ");

  const hasAlternatives = (config.alternatives?.length ?? 0) > 0;
  const altText = hasAlternatives
    ? ` Your backup options: ${config.alternatives!.slice(0, 2).join(", ")}.`
    : "";

  return {
    triggered: true,
    message: `Weather alert for ${config.destinationCity}: ${dayList}.${altText}`,
    data: { lat, lon, badDays, forecast },
    nextCheckAt: hoursFromNow(24), // re-check daily once triggered (weather can improve)
  };
}

// ── Factory helpers (called after job completion) ──────────────────────────

/**
 * Build monitor configs to create automatically after a job completes.
 * Returns a list of monitors ready for DB insertion.
 */
export function buildAutoMonitors(
  job: { id: string; session_id: string; trip_label: string },
  steps: Array<{
    type: string;
    label: string;
    emoji: string;
    status: string;
    handoff_url?: string;
    apiEndpoint: string;
    body: Record<string, unknown>;
    timeFallbacks?: string[];
  }>
): Array<Omit<BookingMonitor, "created_at">> {
  const monitors: Array<Omit<BookingMonitor, "created_at">> = [];
  const now = new Date().toISOString();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // ── availability_watch: auto-created for all failed steps ──
    if (step.status === "error" || step.status === "no_availability") {
      monitors.push({
        id: `${job.id}-avail-${i}`,
        job_id: job.id,
        session_id: job.session_id,
        step_index: i,
        step_label: step.label,
        step_emoji: step.emoji,
        type: "availability_watch",
        config: {
          venue: step.label,
          apiEndpoint: step.apiEndpoint,
          body: step.body,
          targetTime: typeof step.body.time === "string" ? step.body.time : undefined,
        } satisfies AvailabilityWatchConfig,
        status: "active",
        last_checked_at: null,
        next_check_at: hoursFromNow(CHECK_INTERVALS.availability_watch),
        triggered_at: null,
        trigger_data: null,
        trigger_message: null,
      });
    }

    // ── reservation_check: auto-created for all successfully booked steps ──
    if (step.status === "done" && step.handoff_url) {
      const bookingDate = typeof step.body.date === "string" ? step.body.date
        : typeof step.body.checkIn === "string" ? step.body.checkIn
        : typeof step.body.departure === "string" ? step.body.departure
        : undefined;

      monitors.push({
        id: `${job.id}-resv-${i}`,
        job_id: job.id,
        session_id: job.session_id,
        step_index: i,
        step_label: step.label,
        step_emoji: step.emoji,
        type: "reservation_check",
        config: {
          venue: step.label,
          handoffUrl: step.handoff_url,
          bookingDate,
        } satisfies ReservationCheckConfig,
        status: "active",
        last_checked_at: null,
        next_check_at: hoursFromNow(CHECK_INTERVALS.reservation_check),
        triggered_at: null,
        trigger_data: null,
        trigger_message: null,
      });
    }

    // ── weather_alert: created for hotel/flight steps with destination info ──
    if (step.status === "done" && (step.type === "hotel" || step.type === "flight")) {
      const destination =
        typeof step.body.destination === "string" ? step.body.destination :
        typeof step.body.city === "string" ? step.body.city :
        typeof step.body.destinationCity === "string" ? step.body.destinationCity :
        null;

      if (destination) {
        const checkIn = typeof step.body.checkIn === "string" ? step.body.checkIn
          : typeof step.body.date === "string" ? step.body.date
          : null;
        const checkOut = typeof step.body.checkOut === "string" ? step.body.checkOut : null;

        const tripDates: string[] = [];
        if (checkIn) {
          tripDates.push(checkIn);
          if (checkOut && checkOut !== checkIn) tripDates.push(checkOut);
        }

        // Only create if trip is in the next 14 days
        const daysUntilTrip = checkIn
          ? Math.floor((new Date(checkIn).getTime() - Date.now()) / 86_400_000)
          : 999;

        if (tripDates.length > 0 && daysUntilTrip <= 14 && daysUntilTrip >= 0) {
          monitors.push({
            id: `${job.id}-wx-${i}`,
            job_id: job.id,
            session_id: job.session_id,
            step_index: i,
            step_label: step.label,
            step_emoji: step.emoji,
            type: "weather_alert",
            config: {
              destinationCity: destination,
              tripDates,
              alternatives: [],
            } satisfies WeatherAlertConfig,
            status: "active",
            last_checked_at: null,
            next_check_at: hoursFromNow(CHECK_INTERVALS.weather_alert),
            triggered_at: null,
            trigger_data: null,
            trigger_message: null,
          });
        }
      }
    }
  }

  return monitors;
}
