const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseLocalIsoDateTime(value: string): {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
} | null {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2})?)?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] == null ? undefined : Number(match[4]);
  const minute = match[5] == null ? undefined : Number(match[5]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, hour, minute };
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatParts(parts: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
}): string {
  const monthName = FULL_MONTHS[parts.month - 1];
  if (!monthName) return "";
  const date = `${monthName} ${parts.day}, ${parts.year}`;
  if (
    typeof parts.hour === "number" &&
    typeof parts.minute === "number" &&
    !(parts.hour === 0 && parts.minute === 0)
  ) {
    return `${date} at ${formatTime(parts.hour, parts.minute)}`;
  }
  return date;
}

export function formatActivityTaskDate(input: {
  datetimeLocal?: string | null;
  datetimeDisplay?: string | null;
  overrideDate?: string | null;
}): string {
  const structured = input.datetimeLocal ? parseLocalIsoDateTime(input.datetimeLocal) : null;
  if (structured) return formatParts(structured);

  const override = input.overrideDate ? parseLocalIsoDateTime(input.overrideDate) : null;
  if (override) return formatParts(override);

  return input.datetimeDisplay?.trim() ?? "";
}
