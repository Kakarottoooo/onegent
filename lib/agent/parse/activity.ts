import { ActivityIntent, MultilingualQueryContext } from "../../types";
import { minimaxChat } from "../../minimax";

// ─── Code-layer fallbacks (deterministic, complement LLM extraction) ──────────
// LLMs occasionally drop the date field or leave Chinese show names
// un-normalized. Ticketmaster / SeatGeek both search poorly on CJK keywords,
// and a wrong date returns zero results regardless of other fields. These two
// maps + helpers catch those cases before the intent hits the search pipeline.

const CHINESE_SHOW_NAMES: Record<string, string> = {
  "汉密尔顿": "Hamilton",
  "狮子王": "The Lion King",
  "芝加哥": "Chicago",
  "悲惨世界": "Les Misérables",
  "魔法坏女巫": "Wicked",
  "女巫前传": "Wicked",
  "歌剧魅影": "The Phantom of the Opera",
  "剧院魅影": "The Phantom of the Opera",
  "猫": "Cats",
  "红磨坊": "Moulin Rouge",
  "阿拉丁": "Aladdin",
  "冰雪奇缘": "Frozen",
  "哈利波特与被诅咒的孩子": "Harry Potter and the Cursed Child",
  "西区故事": "West Side Story",
  "吉屋出租": "Rent",
  "妈妈咪呀": "Mamma Mia!",
};

function normalizeShowName(name: string | undefined | null): string | undefined | null {
  if (!name) return name;
  const stripped = name.replace(/[《》""''"']/g, "").trim();
  if (CHINESE_SHOW_NAMES[stripped]) return CHINESE_SHOW_NAMES[stripped];
  // Substring match (user may append extra chars like 》 or punctuation)
  for (const [zh, en] of Object.entries(CHINESE_SHOW_NAMES)) {
    if (stripped.includes(zh)) return en;
  }
  return name;
}

function buildDateFromMD(month: number, day: number, today: Date): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  if (isNaN(candidate.getTime())) return null;
  // If the candidate is before today (by more than 1 day), bump to next year
  const todayStart = new Date(year, today.getMonth(), today.getDate());
  if (candidate.getTime() < todayStart.getTime()) {
    candidate.setFullYear(year + 1);
  }
  const mm = String(candidate.getMonth() + 1).padStart(2, "0");
  const dd = String(candidate.getDate()).padStart(2, "0");
  return `${candidate.getFullYear()}-${mm}-${dd}`;
}

function extractExplicitDate(text: string, today: Date): string | null {
  // "5月20号" / "5月20日" / "5月20"
  const zhMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?/);
  if (zhMatch) return buildDateFromMD(parseInt(zhMatch[1], 10), parseInt(zhMatch[2], 10), today);
  // "5/20", "5-20", "5.20"   — require non-digit boundary on both sides to
  // avoid matching price ranges like "199.00" or version strings like "1.2.3"
  const sepMatch = text.match(/(?<![\d.])([0-1]?\d)[./\-]([0-3]?\d)(?![\d.])/);
  if (sepMatch) {
    const m = parseInt(sepMatch[1], 10);
    const d = parseInt(sepMatch[2], 10);
    // Extra guard: "5/20" is date, but "1/2" is ambiguous — require day >= 10
    // OR month-style separator with ambiguity resolved by context word nearby.
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && (d >= 10 || /[月日号]|看|去|订|票|演|day|month/i.test(text))) {
      return buildDateFromMD(m, d, today);
    }
  }
  return null;
}

function findExplicitDateAcrossTurns(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  today: Date
): string | null {
  // Most recent user mention wins. Walk turns newest → oldest.
  const userTurns = history.filter((h) => h.role === "user").map((h) => h.content);
  const ordered = [userMessage, ...userTurns.reverse()];
  for (const turn of ordered) {
    const d = extractExplicitDate(turn, today);
    if (d) return d;
  }
  return null;
}

/**
 * Parse a free-form activity query ("周六晚上想去纽约看音乐会") into a
 * structured ActivityIntent that the SeatGeek search pipeline can consume.
 *
 * The caller (activity-search.ts) then overrides the hard fields
 * (event_name / city / date) with authoritative Room-context values, mirroring
 * the flight/hotel pattern.
 */
export async function parseActivityIntent(
  userMessage: string,
  cityFullName: string,
  queryContext?: MultilingualQueryContext,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<ActivityIntent> {
  const text = await minimaxChat({
    messages: [
      ...(conversationHistory?.slice(-6) ?? []),
      {
        role: "user",
        content: `Extract activity / ticketed-event search requirements from this request. Return ONLY valid JSON.
The request may be short (e.g., just an artist or show name) because it continues a multi-turn conversation — use the preceding messages above to fill in city, date, and event_type when the current line alone is not enough.

User request: "${userMessage}"
Default city (use ONLY if neither the current request nor prior turns mentioned any city): ${cityFullName}
Today's date: ${new Date().toISOString().split("T")[0]}
Canonical NLU hints: ${JSON.stringify({
  normalized_query: queryContext?.normalized_query,
  location_hint: queryContext?.location_hint,
  date_text_hint: queryContext?.date_text_hint,
})}

Return JSON with these fields (omit any field the user did not mention):
{
  "category": "activity",
  "event_type": "concert" | "theater" | "sports" | "exhibition" | "comedy" | "festival" | "other",
  "event_name": "<specific artist / show / team name — null if user only gave a category>",
  "city": "<city name or default>",
  "date_from": "YYYY-MM-DD or null",
  "date_to": "YYYY-MM-DD or null (same as date_from when user specifies a single day)",
  "num_tickets": number or null,
  "budget_max_per_ticket": number (USD) or null,
  "seat_type": "premium" | "standard" | "economy" or null,
  "section_preferences": string[] or null,
  "avoid_sections": string[] or null,
  "wheelchair_required": true if user mentions wheelchair / accessibility, else omit
}

Rules:
- "百老汇" / "Broadway" → event_type="theater", city="New York".
- **SHOW NAMES ARE NOT CITIES.** The following are Broadway/West End show titles and MUST be stored in event_name, NEVER in city:
  "Chicago", "芝加哥", "Hamilton", "汉密尔顿", "The Lion King", "狮子王", "Wicked", "女巫前传",
  "The Phantom of the Opera", "歌剧魅影", "Les Misérables", "悲惨世界", "Cats", "猫",
  "Moulin Rouge", "红磨坊", "Aladdin", "阿拉丁", "Frozen", "冰雪奇缘", "MJ the Musical",
  "Book of Mormon", "Sweeney Todd", "Cabaret", "Hadestown", "Six", "哈利波特与被诅咒的孩子".
  If the user types any of these (alone or after "看"/"想看"), event_name=<that title verbatim>,
  and city MUST come from earlier turns (most commonly "New York" when Broadway context is present).
- "Taylor Swift", "Coldplay", "Lakers", "Yankees" → store verbatim in event_name.
- **CITY EXTRACTION:** city MUST be taken from the MOST RECENT explicit geographic mention by the USER across the whole conversation (e.g. "在纽约"/"去洛杉矶"/"in New York"). The default city above is a last resort ONLY when NO user turn in the history mentioned any city. Never infer city from event_name.
- **DATE EXTRACTION (critical):** When the user has given multiple date hints across turns (e.g. "周六晚上" then later "5.20"), pick the MOST RECENT explicit date. An explicit date from ANY turn (user OR assistant) overrides earlier relative expressions like "周六".
- **DATE FORMATS** — treat ALL of these as the same explicit date "month=M, day=D", and expand to YYYY-MM-DD using today's date as reference:
  - "5/20", "5-20", "5.20", "5 20"
  - "May 20", "May 20th", "5月20", "5月20号", "5月20日", "五月二十", "五月二十号", "五月二十日"
  - "2026/5/20", "2026-5-20", "2026.5.20"
  - If the user writes JUST digits separated by '.', '-', '/' or a space (like "5.20") in a date-ish context (asked about a date, or paired with "号"/"日"/"看"/time words), it IS a date — NEVER treat it as a price, version number, or decimal.
- **YEAR INFERENCE:** Today's date is above. If the resulting M/D has not yet passed this year, use this year. If it already passed, use next year.
- **ASSISTANT ECHOES:** If an assistant turn in the history has already confirmed a date (e.g. "5月20日在百老汇的演出"), sustain that date — the user does NOT need to repeat it.
- Relative dates: "周六" → upcoming Saturday (YYYY-MM-DD from today), "下周五" → upcoming Friday, "明天" → tomorrow. Expand to YYYY-MM-DD using today's date above.
- If user only says "周六晚上", set date_from=date_to=YYYY-MM-DD of that Saturday.
- "前排"/"VIP"/"orchestra"/"楼下前排" → seat_type="premium".
- "山顶票"/"后排"/"便宜点"/"GA" → seat_type="economy".
- "楼下"/"下层"/"lower bowl" → section_preferences: ["lower bowl"].
- Budget: "每张不超过 200 刀" / "budget 200 per ticket" → budget_max_per_ticket: 200. CNY numbers are OK to store as-is if user said 人民币.
- num_tickets: "一张" → 1, "两张" / "带女朋友" / "我们俩" → 2. Default 1 if user is clearly solo.`,
      },
    ],
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { category: "activity" };
  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // ── Post-processing: deterministic fixups the LLM tends to miss ─────────
    const today = new Date();
    const todayIso = today.toISOString().split("T")[0];

    // (1) Normalize Chinese show names → English (Ticketmaster/SeatGeek search
    //     poorly on CJK keywords).
    if (parsed.event_name) {
      parsed.event_name = normalizeShowName(parsed.event_name);
    }

    // (2) Date fallback: when LLM returned today (its "I don't know" default)
    //     or nothing, try regex extraction across all user turns.
    if (!parsed.date_from || parsed.date_from === todayIso) {
      const extracted = findExplicitDateAcrossTurns(userMessage, conversationHistory ?? [], today);
      if (extracted) {
        parsed.date_from = extracted;
        parsed.date_to = extracted;
      }
    }

    return {
      category: "activity",
      ...parsed,
    };
  } catch {
    return { category: "activity" };
  }
}
