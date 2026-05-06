export const TASK_TIMELINE_HEADER_GLYPH = "🖥️";

const LEADING_TASK_ICON_PATTERN = /^\s*(?:(?:🖥️?|💻)\s*)+/u;
const LEADING_MOJIBAKE_ICON_PATTERN = /^\s*(?:(?:馃枼锔?|馃枼|馃捇)\s*)+/u;

export function normalizeTaskTimelineTitle(title: string): string {
  return title
    .replace(LEADING_TASK_ICON_PATTERN, "")
    .replace(LEADING_MOJIBAKE_ICON_PATTERN, "")
    .trimStart();
}
