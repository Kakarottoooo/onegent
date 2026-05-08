import type { BookingJobStep } from "@/lib/db";
import type { JobModificationPatch } from "@/lib/booking-jobs/types";

const ISO_DATE_RE = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/;
const CHINESE_DATE_RE = /(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/;
const SLASH_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/;
const AMPM_TIME_RE = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const CHINESE_TIME_RE = /(上午|早上|下午|晚上|晚间|中午)?\s*(\d{1,2})\s*点(?:半|[:：]([0-5]\d)|([0-5]?\d)\s*分)?/;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const EN_MONTH_DATE_RE = new RegExp(
  `\\b(${Object.keys(MONTHS).join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,
  "i",
);

const CITY_ALIASES: Array<[RegExp, string]> = [
  [/\bnew\s+york\b|\bnyc\b/i, "New York"],
  [/\bnashville\b/i, "Nashville"],
  [/\bdetroit\b/i, "Detroit"],
  [/\bchicago\b/i, "Chicago"],
  [/\blos\s+angeles\b|\bla\b/i, "Los Angeles"],
  [/\bsan\s+francisco\b|\bsf\b/i, "San Francisco"],
  [/\bmiami\b/i, "Miami"],
  [/\bboston\b/i, "Boston"],
  [/\bphiladelphia\b/i, "Philadelphia"],
  [/\bwashington\b|\bdc\b|\bd\.c\.\b/i, "Washington, DC"],
  [/\batlanta\b/i, "Atlanta"],
  [/\bseattle\b/i, "Seattle"],
  [/\baustin\b/i, "Austin"],
  [/\bdallas\b/i, "Dallas"],
  [/\bhouston\b/i, "Houston"],
  [/\blas\s+vegas\b|\bvegas\b/i, "Las Vegas"],
];

export interface ActivityEventChoiceParseResult {
  event_date?: string;
  event_time?: string;
  city?: string;
  missing_fields: string[];
}

export interface ActivityEventChoicePatchResult {
  ok: boolean;
  patch?: JobModificationPatch;
  parsed: ActivityEventChoiceParseResult;
  question?: string;
}

export function parseActivityEventChoiceReply(
  message: string,
  now = new Date(),
): ActivityEventChoiceParseResult {
  const event_date = parseDate(message, now);
  const event_time = parseTime(message);
  const city = parseCity(message);
  const missing_fields = event_date ? [] : ["event_date"];
  return {
    ...(event_date ? { event_date } : {}),
    ...(event_time ? { event_time } : {}),
    ...(city ? { city } : {}),
    missing_fields,
  };
}

export function buildActivityEventChoicePatch(
  message: string,
  step?: BookingJobStep,
  now = new Date(),
): ActivityEventChoicePatchResult {
  const parsed = parseActivityEventChoiceReply(message, now);
  if (parsed.missing_fields.length > 0) {
    return {
      ok: false,
      parsed,
      question:
        "Which date should I use for this provider page? You can reply like \"Sep 17 7pm Detroit\".",
    };
  }

  const constraints: Record<string, unknown> = {
    task_type: "activity_booking",
  };
  if (parsed.event_date) constraints.event_date = parsed.event_date;
  if (parsed.event_time) constraints.event_time = parsed.event_time;
  if (parsed.city) constraints.city = parsed.city;

  const label = typeof step?.label === "string" ? step.label : "activity";
  const details = [
    parsed.event_date,
    parsed.event_time,
    parsed.city,
  ].filter(Boolean).join(" ");

  return {
    ok: true,
    parsed,
    patch: {
      constraints,
      message: `User chose ${details || "a provider listing"} for ${label}.`,
    },
  };
}

function parseDate(message: string, now: Date): string | undefined {
  const iso = message.match(ISO_DATE_RE);
  if (iso) return formatIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const zh = message.match(CHINESE_DATE_RE);
  if (zh) {
    const year = zh[1] ? Number(zh[1]) : inferYear(Number(zh[2]), Number(zh[3]), now);
    return formatIsoDate(year, Number(zh[2]), Number(zh[3]));
  }

  const en = message.match(EN_MONTH_DATE_RE);
  if (en) {
    const month = MONTHS[en[1].replace(/\.$/, "").toLowerCase()];
    const day = Number(en[2]);
    const year = en[3] ? Number(en[3]) : inferYear(month, day, now);
    return formatIsoDate(year, month, day);
  }

  const slash = message.match(SLASH_DATE_RE);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const year = slash[3] ? Number(slash[3]) : inferYear(month, day, now);
    return formatIsoDate(year, month, day);
  }

  return undefined;
}

function parseTime(message: string): string | undefined {
  const ampm = message.match(AMPM_TIME_RE);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = ampm[2] ? Number(ampm[2]) : 0;
    const marker = ampm[3].toLowerCase();
    if (marker.startsWith("p") && hour < 12) hour += 12;
    if (marker.startsWith("a") && hour === 12) hour = 0;
    return formatTime(hour, minute);
  }

  const zh = message.match(CHINESE_TIME_RE);
  if (zh) {
    const marker = zh[1] ?? "";
    let hour = Number(zh[2]);
    let minute = 0;
    if (message.includes("点半")) minute = 30;
    if (zh[3]) minute = Number(zh[3]);
    if (zh[4]) minute = Number(zh[4]);
    const isPm = /下午|晚上|晚间/.test(marker);
    if (isPm && hour < 12) hour += 12;
    if (/中午/.test(marker) && hour < 12) hour += 12;
    return formatTime(hour, minute);
  }

  return undefined;
}

function parseCity(message: string): string | undefined {
  for (const [pattern, city] of CITY_ALIASES) {
    if (pattern.test(message)) return city;
  }
  return undefined;
}

function inferYear(month: number, day: number, now: Date): number {
  const year = now.getFullYear();
  const today = new Date(year, now.getMonth(), now.getDate()).getTime();
  const candidate = new Date(year, month - 1, day).getTime();
  return candidate < today ? year + 1 : year;
}

function formatIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatTime(hour: number, minute: number): string | undefined {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
