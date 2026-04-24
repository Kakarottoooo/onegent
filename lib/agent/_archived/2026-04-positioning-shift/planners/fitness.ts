import {
  DecisionPlan,
  FitnessIntent,
  FitnessStudio,
  OutputLanguage,
  PlanAction,
  PlanOption,
  DecisionEvidenceItem,
  Restaurant,
} from "../../types";
import { pickLanguageCopy } from "../../outputCopy";
import { googlePlacesSearch } from "../../tools";
import { CITIES } from "../../cities";

// ─── Google Places → FitnessStudio ───────────────────────────────────────────

function toFitnessStudio(r: Restaurant): FitnessStudio {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    rating: r.rating,
    review_count: r.review_count,
    price_level: r.price, // "$", "$$", "$$$"
    lat: r.lat,
    lng: r.lng,
    website: r.url,
  };
}

// ─── Tier selection ───────────────────────────────────────────────────────────

interface FitnessTier {
  label: string;
  studio: FitnessStudio;
  tier_key: "top_rated" | "most_popular" | "best_value";
}

function selectTiers(studios: FitnessStudio[], budget?: number): FitnessTier[] {
  const eligible = budget
    ? studios.filter((s) => {
        // "$" ≈ cheap, "$$" ≈ moderate, "$$$" ≈ pricey — filter $$$ when budget is tight
        if (budget < 20 && s.price_level === "$$$") return false;
        return true;
      })
    : studios;

  if (eligible.length === 0) return [];

  // Top rated: highest rating
  const byRating = [...eligible].sort((a, b) => (b.rating - a.rating) || (b.review_count - a.review_count));

  // Most popular: most reviews
  const byReviews = [...eligible].sort((a, b) => b.review_count - a.review_count);

  // Best value: good rating (>=4.0) + lowest price level
  const priceOrder = { "$": 1, "$$": 2, "$$$": 3 };
  const byValue = [...eligible]
    .filter((s) => s.rating >= 4.0)
    .sort((a, b) => {
      const pa = priceOrder[a.price_level as keyof typeof priceOrder] ?? 2;
      const pb = priceOrder[b.price_level as keyof typeof priceOrder] ?? 2;
      return pa - pb || b.rating - a.rating;
    });

  const picks: FitnessStudio[] = [];
  const usedIds = new Set<string>();

  function addUnique(candidates: FitnessStudio[]) {
    for (const s of candidates) {
      if (!usedIds.has(s.id)) {
        picks.push(s);
        usedIds.add(s.id);
        return;
      }
    }
    // If all duplicates, add the first not yet picked from original list
    for (const s of eligible) {
      if (!usedIds.has(s.id)) {
        picks.push(s);
        usedIds.add(s.id);
        return;
      }
    }
  }

  addUnique(byRating);
  addUnique(byReviews);
  addUnique(byValue);

  const tierKeys: Array<"top_rated" | "most_popular" | "best_value"> = [
    "top_rated",
    "most_popular",
    "best_value",
  ];

  return picks.map((studio, i) => ({
    studio,
    tier_key: tierKeys[i],
    label: "",
  }));
}

// ─── Deep link builders ───────────────────────────────────────────────────────

function buildClassPassUrl(intent: FitnessIntent): string {
  const location = intent.neighborhood
    ? `${intent.neighborhood}, ${intent.city}`
    : intent.city;
  return `https://classpass.com/search?query=${encodeURIComponent(intent.activity_label)}&location=${encodeURIComponent(location)}`;
}

function buildMindbodyUrl(intent: FitnessIntent): string {
  const location = intent.neighborhood
    ? `${intent.neighborhood}, ${intent.city}`
    : intent.city;
  return `https://www.mindbodyonline.com/explore/studios?q=${encodeURIComponent(intent.activity_label)}&near=${encodeURIComponent(location)}`;
}

function buildMapsUrl(studio: FitnessStudio): string {
  return `https://maps.google.com/search/?q=${encodeURIComponent(`${studio.name} ${studio.address}`)}`;
}

// ─── PlanOption builder ───────────────────────────────────────────────────────

function buildFitnessPlanOption(
  tier: FitnessTier,
  intent: FitnessIntent,
  lang: OutputLanguage
): PlanOption {
  const { studio, tier_key } = tier;

  const tierCopy = {
    top_rated: {
      label: pickLanguageCopy(lang, "Top rated", "评分最高"),
      summary: (s: FitnessStudio) =>
        pickLanguageCopy(
          lang,
          `${s.name} is one of the highest-rated ${intent.activity_label} studios in the area — ${s.rating}★ from ${s.review_count.toLocaleString()} reviews. A safe, proven choice.`,
          `${s.name} 是该地区评分最高的${intent.activity_label}工作室之一——${s.rating}★，共 ${s.review_count.toLocaleString()} 条评价，品质有保障。`
        ),
      why_this_now: () =>
        pickLanguageCopy(
          lang,
          "Highest community trust — the class that consistently gets rave reviews.",
          "社区口碑最佳，课程质量一贯受到好评。"
        ),
      best_for: () =>
        pickLanguageCopy(lang, "First timers and anyone who doesn't want to risk a bad class", "第一次尝试或不想踩雷的人"),
    },
    most_popular: {
      label: pickLanguageCopy(lang, "Most popular", "最受欢迎"),
      summary: (s: FitnessStudio) =>
        pickLanguageCopy(
          lang,
          `${s.name} has built a loyal following with ${s.review_count.toLocaleString()} reviews. Popular studios fill up fast — book ahead.`,
          `${s.name} 凭借 ${s.review_count.toLocaleString()} 条评价积累了大批忠实用户。热门工作室容易爆满，建议提前预约。`
        ),
      why_this_now: () =>
        pickLanguageCopy(
          lang,
          "The local go-to — the most people have tried this studio and keep coming back.",
          "本地热门首选，大量回头客的口碑之选。"
        ),
      best_for: () =>
        pickLanguageCopy(lang, "People who want to train where the community trains", "想融入本地健身社区的人"),
    },
    best_value: {
      label: pickLanguageCopy(lang, "Best value", "性价比最高"),
      summary: (s: FitnessStudio) =>
        pickLanguageCopy(
          lang,
          `${s.name} delivers quality ${intent.activity_label} at ${s.price_level ?? "competitive"} pricing — ${s.rating}★ with great value per class.`,
          `${s.name} 以${s.price_level ?? "亲民"}的价位提供优质${intent.activity_label}课程，${s.rating}★，性价比突出。`
        ),
      why_this_now: () =>
        pickLanguageCopy(
          lang,
          "Great quality without breaking the bank — ideal if you plan to come regularly.",
          "品质出色，价格友好，特别适合打算定期参加课程的你。"
        ),
      best_for: () =>
        pickLanguageCopy(lang, "Budget-conscious regulars who want to commit without overspending", "希望规律健身但注重花费的人"),
    },
  };

  const copy = tierCopy[tier_key];
  const ratingStr = `${studio.rating}★ (${studio.review_count.toLocaleString()} reviews)`;
  const priceStr = studio.price_level
    ? pickLanguageCopy(lang, `Price range: ${studio.price_level}`, `价位：${studio.price_level}`)
    : "";

  const highlights: string[] = [
    `⭐ ${ratingStr}`,
    `📍 ${studio.address}`,
    ...(priceStr ? [priceStr] : []),
  ];

  const mapsUrl = buildMapsUrl(studio);
  const classpassUrl = buildClassPassUrl(intent);
  const mindbodyUrl = buildMindbodyUrl(intent);

  const primaryAction = {
    id: `classpass-${studio.id}`,
    label: pickLanguageCopy(lang, "Book on ClassPass", "通过 ClassPass 预约"),
    url: classpassUrl,
  };

  const secondaryActions = [
    {
      id: `mindbody-${studio.id}`,
      label: pickLanguageCopy(lang, "Book on Mindbody", "通过 Mindbody 预约"),
      url: mindbodyUrl,
    },
    {
      id: `maps-${studio.id}`,
      label: pickLanguageCopy(lang, "View on map", "查看地图"),
      url: mapsUrl,
    },
    ...(studio.website
      ? [
          {
            id: `website-${studio.id}`,
            label: pickLanguageCopy(lang, "Studio website", "工作室官网"),
            url: studio.website,
          },
        ]
      : []),
  ];

  const timeNote = (() => {
    const parts: string[] = [];
    if (intent.day_preference) parts.push(intent.day_preference);
    if (intent.time_preference !== "any") parts.push(intent.time_preference);
    return parts.length > 0
      ? pickLanguageCopy(lang, `Available ${parts.join(" ")} sessions — verify schedule on ClassPass`, `${parts.join("、")}课程 — 请在 ClassPass 确认时间表`)
      : pickLanguageCopy(lang, "Verify class schedule and availability on ClassPass or Mindbody", "请在 ClassPass 或 Mindbody 确认课程时间和余位");
  })();

  return {
    id: `fitness-opt-${tier_key}`,
    label: copy.label,
    option_category: "fitness",
    title: studio.name,
    subtitle: pickLanguageCopy(lang, studio.address, studio.address),
    summary: copy.summary(studio),
    why_this_now: copy.why_this_now(),
    best_for: copy.best_for(),
    estimated_total: intent.budget_per_class
      ? pickLanguageCopy(lang, `Budget: up to $${intent.budget_per_class}/class`, `预算：每节课最多 $${intent.budget_per_class}`)
      : studio.price_level ?? "",
    timing_note: timeNote,
    risks: [
      pickLanguageCopy(lang, "Book in advance — popular classes fill up quickly.", "提前预约，热门课程容易爆满。"),
    ],
    tradeoffs: [],
    highlights,
    primary_action: primaryAction,
    secondary_actions: secondaryActions,
    score: Math.max(7, studio.rating * 1.8),
  };
}

// ─── Next actions ─────────────────────────────────────────────────────────────

function buildNextActions(intent: FitnessIntent, lang: OutputLanguage): PlanAction[] {
  return [
    {
      id: "refine-time",
      type: "refine",
      label: pickLanguageCopy(lang, "Different time", "换个时间"),
      description: pickLanguageCopy(lang, "Try morning, afternoon, or evening", "试试早上、下午或晚上"),
      prompt: pickLanguageCopy(
        lang,
        `Find ${intent.activity_label} classes at a different time`,
        `帮我找不同时间段的${intent.activity_label}课程`
      ),
    },
    {
      id: "refine-activity",
      type: "refine",
      label: pickLanguageCopy(lang, "Different activity", "换个运动"),
      description: pickLanguageCopy(lang, "Try yoga, pilates, spin, HIIT…", "尝试瑜伽、普拉提、动感单车、HIIT…"),
      prompt: pickLanguageCopy(lang, "Show me different fitness class options", "给我看看其他运动课程"),
    },
    {
      id: "share-plan",
      type: "share_plan",
      label: pickLanguageCopy(lang, "Share these options", "分享课程选项"),
      description: pickLanguageCopy(lang, "Send this to a friend to pick together", "发给朋友一起选"),
    },
  ];
}

// ─── Main planner ─────────────────────────────────────────────────────────────

export async function runFitnessPlanner(params: {
  intent: FitnessIntent;
  outputLanguage: OutputLanguage;
}): Promise<DecisionPlan | null> {
  const { intent, outputLanguage: lang } = params;

  // Build Google Places query: "[style] [activity] studio [neighborhood]"
  const stylePrefix = intent.style ? `${intent.style} ` : "";
  const neighborhoodSuffix = intent.neighborhood ? ` ${intent.neighborhood}` : "";
  const query = `${stylePrefix}${intent.activity_label} studio${neighborhoodSuffix}`;

  // Resolve city center to avoid Places API defaulting to SF bias
  const cityEntry = Object.values(CITIES).find(
    (c) => c.fullName === intent.city || intent.city.startsWith(c.label)
  );
  const cityCenter = cityEntry?.center;

  const places = await googlePlacesSearch({
    query,
    location: intent.city,
    ...(cityCenter ? { cityCenter } : {}),
    maxResults: 9,
  });

  if (places.length === 0) return null;

  const studios = places.map(toFitnessStudio);
  const tiers = selectTiers(studios, intent.budget_per_class);

  if (tiers.length === 0) return null;

  const options: PlanOption[] = tiers.map((tier) =>
    buildFitnessPlanOption(tier, intent, lang)
  );

  const [primary, ...backups] = options;

  const evidenceItems: DecisionEvidenceItem[] = tiers.map((t) => ({
    id: t.studio.id,
    title: t.studio.name,
    detail: `${t.studio.rating}★ · ${t.studio.address}`,
    tag: t.tier_key.replace("_", " "),
  }));

  const locationLabel = intent.neighborhood ?? intent.city;
  const timeLabel = (() => {
    const parts: string[] = [];
    if (intent.day_preference) parts.push(intent.day_preference);
    if (intent.time_preference !== "any") parts.push(intent.time_preference);
    return parts.join(" ");
  })();

  return {
    id: `fitness-${intent.activity}-${Date.now()}`,
    scenario: "fitness",
    output_language: lang,
    title: pickLanguageCopy(
      lang,
      `${intent.activity_label} studios in ${locationLabel}`,
      `${locationLabel} ${intent.activity_label}工作室`
    ),
    summary: pickLanguageCopy(
      lang,
      `I found ${tiers.length} ${intent.activity_label} studios near ${locationLabel}. Book directly through ClassPass or Mindbody${timeLabel ? ` for ${timeLabel} classes` : ""}.`,
      `我在${locationLabel}附近找到 ${tiers.length} 家${intent.activity_label}工作室。可通过 ClassPass 或 Mindbody 预约${timeLabel ? `${timeLabel}的课程` : ""}。`
    ),
    approval_prompt: pickLanguageCopy(
      lang,
      "Pick a studio — tap Book on ClassPass to see available times and lock in your spot.",
      "选择工作室——点击「ClassPass 预约」查看可用时间并锁定名额。"
    ),
    confidence: tiers.length >= 3 ? "high" : "medium",
    scenario_brief: intent.planning_assumptions,
    primary_plan: primary,
    backup_plans: backups,
    tradeoff_summary: pickLanguageCopy(
      lang,
      "Top rated has the strongest community reviews. Most popular is the local go-to with the biggest following. Best value gives quality at a friendlier price.",
      "评分最高的拥有最强口碑；最受欢迎的是本地热门首选；性价比最高的以亲民价位提供优质体验。"
    ),
    risks: [
      pickLanguageCopy(lang, "Class schedules and availability change — always confirm on ClassPass or Mindbody before heading over.", "课程时间和余位随时变动，出发前请在 ClassPass 或 Mindbody 确认。"),
      pickLanguageCopy(lang, "First-class deals are common — check the studio's website for intro offers.", "首课优惠很常见，可查看工作室官网了解新人优惠。"),
    ],
    next_actions: buildNextActions(intent, lang),
    evidence_card_ids: evidenceItems.map((e) => e.id),
    evidence_items: evidenceItems,
  };
}
