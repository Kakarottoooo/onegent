/**
 * Client-side safety-net helpers for quick-pick buttons.
 *
 * When the LLM asks the user for a recommendation-leaning field ("what
 * cuisine?", "which show?") and the user responds with "whatever you pick"
 * / "随便 / 都行 / 推荐一下", we inject a hardcoded list of popular options
 * so the user still sees tappable buttons.
 *
 * Lives here (not in the NLU layer) so it stays reachable even as v1 is
 * retired in Phase D. The helpers are pure regex/constants — no LLM, no
 * async, safe to call from any React component.
 *
 * Kept aligned in spirit with v2 extractor prompt rule 7(c) which describes
 * what the model SHOULD have produced — this is the belt-and-suspenders
 * for when it forgets.
 */

import type { NluScenario, QuickPick } from "./agent/nlu-v2/types";

const RECOMMEND_ASK_PATTERNS = [
  /随便/,
  /都行/,
  /无所谓/,
  /没偏好/,
  /你(来)?决定/,
  /你看着办/,
  /你(帮我)?推荐/,
  /推荐一下/,
  /不知道/,
  /帮我选/,
  /surprise me/i,
  /\brecommend\b/i,
  /\bup to you\b/i,
  /\bany(thing)?\b.*(ok|fine|works?)/i,
];

export function looksLikeRecommendationAsk(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return RECOMMEND_ASK_PATTERNS.some((re) => re.test(trimmed));
}

const FALLBACK_QUICK_PICKS: Record<NluScenario, QuickPick[]> = {
  activity: [
    { label: "《汉密尔顿》", value: "Hamilton" },
    { label: "《狮子王》", value: "The Lion King" },
    { label: "《魔法坏女巫》", value: "Wicked" },
    { label: "《芝加哥》", value: "Chicago" },
    { label: "《歌剧魅影》", value: "The Phantom of the Opera" },
  ],
  hotel: [
    { label: "Midtown", value: "Midtown" },
    { label: "Upper East Side", value: "Upper East Side" },
    { label: "SoHo", value: "SoHo" },
    { label: "Financial District", value: "Financial District" },
    { label: "Brooklyn Heights", value: "Brooklyn Heights" },
  ],
  flight: [
    { label: "经济舱", value: "Economy" },
    { label: "豪华经济", value: "Premium Economy" },
    { label: "商务舱", value: "Business" },
    { label: "头等舱", value: "First" },
  ],
  restaurant: [
    { label: "日料", value: "Japanese" },
    { label: "意大利菜", value: "Italian" },
    { label: "中餐", value: "Chinese" },
    { label: "墨西哥菜", value: "Mexican" },
    { label: "泰餐", value: "Thai" },
  ],
  trip: [
    { label: "纽约", value: "New York" },
    { label: "东京", value: "Tokyo" },
    { label: "巴黎", value: "Paris" },
    { label: "洛杉矶", value: "Los Angeles" },
  ],
};

export function getFallbackQuickPicks(scenario: NluScenario | null): QuickPick[] | null {
  if (!scenario) return null;
  const picks = FALLBACK_QUICK_PICKS[scenario];
  return picks && picks.length > 0 ? picks : null;
}
