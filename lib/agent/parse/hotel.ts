import { HotelIntent, MultilingualQueryContext } from "../../types";
import { minimaxChat } from "../../minimax";
import { resolveLocationHint } from "../../nlu";

const YYYY_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/;

// Defense in depth for Bug 1 (P0): MiniMax LLM frequently returns past years
// when the user gives a bare month/day without a year. SerpApi rejects past
// dates with 400 → user sees "no hotels found" — false negative.
// If the parsed date is strictly earlier than today, bump it forward by whole
// years until it is today-or-later. This matches what humans almost always
// mean when they omit a year: the next future occurrence of that month/day.
export function bumpPastDateToNextOccurrence<T extends string | null | undefined>(
  dateStr: T,
  today: Date,
): T {
  if (dateStr == null || dateStr === "") return dateStr;
  const m = (dateStr as string).match(YYYY_MM_DD);
  if (!m) return dateStr;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return dateStr;
  // Reject malformed dates that JS would silently coerce (e.g., 2026-02-31).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return dateStr;
  }

  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let bumpedYear = year;
  while (Date.UTC(bumpedYear, month - 1, day) < todayUtc) {
    bumpedYear += 1;
  }
  if (bumpedYear === year) return dateStr;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bumpedYear}-${pad(month)}-${pad(day)}` as T;
}

export async function parseHotelIntent(
  userMessage: string,
  cityFullName: string,
  queryContext?: MultilingualQueryContext,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  profileContext?: string,
): Promise<HotelIntent> {
  const text = await minimaxChat({
    messages: [
      ...(conversationHistory?.slice(-4) ?? []),
      {
        role: "user",
        content: `Extract hotel search requirements from this request. Return ONLY valid JSON.
${profileContext ? `\nKnown user preferences (apply these as defaults if not overridden by the current request):\n${profileContext}\n` : ""}
User request: "${userMessage}"
Default city (use ONLY if user did not mention any location): ${cityFullName}
Today's date: ${new Date().toISOString().split("T")[0]}
Canonical NLU hints: ${JSON.stringify({
  normalized_query: queryContext?.normalized_query,
  location_hint: queryContext?.location_hint,
  category_hint: queryContext?.category_hint,
  date_text_hint: queryContext?.date_text_hint,
  time_hint: queryContext?.time_hint,
})}

IMPORTANT: For "location", look for any city, region, or place name in the user request (including typos like "las vagas"="Las Vegas", "new yok"="New York"). Only fall back to "${cityFullName}" if the user truly mentioned no location.

Return JSON with these fields (omit fields that aren't mentioned):
{
  "category": "hotel",
  "location": "<city from user message, or ${cityFullName} if none>",
  "check_in": "YYYY-MM-DD or null",
  "check_out": "YYYY-MM-DD or null",
  "nights": number or null,
  "guests": number or null,
  "star_rating": number or null (minimum star rating requested),
  "room_type": "single|double|suite|null",
  "amenities": ["pool", "gym", "parking", "breakfast", "wifi", etc],
  "budget_per_night": number or null,
  "budget_total": number or null,
  "neighborhood": "specific area or null",
  "purpose": "business|leisure|romantic|family|null",
  "constraints": ["no chains", "quiet", "pet-friendly", etc],
  "priorities": ["price", "location", "amenities", etc],
  "special_occasion": "honeymoon" if user says "honeymoon" / "蜜月", "anniversary" if "anniversary" / "结婚周年" / "纪念日", "birthday" if "birthday" / "生日" — else omit,
  "has_children": true if user mentions kids, children, toddlers, 孩子, 小孩, 带娃 — else omit,
  "children_count": number of children if mentioned — else omit
}

For relative dates: "tonight" = today, "tomorrow" = tomorrow, "next Friday" = nearest upcoming Friday, "2 nights" sets nights=2 and check_out = check_in + 2 days.

If the user gives a month/day without a year (e.g. "5月20号", "May 20", "12/24"), choose the NEXT FUTURE OCCURRENCE relative to today's date above: use the current year if that month/day has not yet passed, otherwise use the next year. Never emit a date in the past.`,
      },
    ],
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      category: "hotel",
      location: resolveLocationHint(undefined, queryContext, userMessage, cityFullName),
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // Bug 1 (P0) defense in depth: bump past dates to next future occurrence
    // BEFORE the nights→check_out derivation so a past check_in doesn't drag
    // the computed check_out into the past too.
    const today = new Date();
    if (typeof parsed.check_in === "string") {
      parsed.check_in = bumpPastDateToNextOccurrence(parsed.check_in, today);
    }
    if (typeof parsed.check_out === "string") {
      parsed.check_out = bumpPastDateToNextOccurrence(parsed.check_out, today);
    }
    // If nights given but no check_out, compute it
    if (parsed.check_in && parsed.nights && !parsed.check_out) {
      const d = new Date(parsed.check_in);
      d.setDate(d.getDate() + parsed.nights);
      parsed.check_out = d.toISOString().split("T")[0];
    }
    parsed.location = resolveLocationHint(parsed.location, queryContext, userMessage, cityFullName);
    return { category: "hotel", ...parsed };
  } catch {
    return {
      category: "hotel",
      location: resolveLocationHint(undefined, queryContext, userMessage, cityFullName),
    };
  }
}
