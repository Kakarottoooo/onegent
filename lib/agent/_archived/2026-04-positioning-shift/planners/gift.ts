import {
  DecisionPlan,
  GiftIntent,
  GiftProduct,
  OutputLanguage,
  PlanAction,
  PlanOption,
  DecisionEvidenceItem,
} from "../../types";
import { pickLanguageCopy } from "../../outputCopy";
import { searchShoppingProducts, ShoppingProduct } from "../../serpapi-shopping";

// ─── Search query builder ─────────────────────────────────────────────────────

function buildSearchQuery(intent: GiftIntent, angle: "safe" | "thoughtful" | "creative"): string {
  const parts: string[] = [];

  if (intent.interests && intent.interests.length > 0) {
    if (angle === "safe") {
      // Most popular, well-reviewed items for their top interest
      parts.push(`best ${intent.interests[0]} gift`);
    } else if (angle === "thoughtful") {
      // Personalized to a specific interest
      const interest = intent.interests[Math.min(1, intent.interests.length - 1)] ?? intent.interests[0];
      parts.push(`${interest} gift personalized`);
    } else {
      // Unique / unexpected for their interests
      parts.push(`unique ${intent.interests[intent.interests.length - 1]} gift unusual`);
    }
  } else if (intent.relationship) {
    const relLabel: Record<string, string> = {
      partner: "girlfriend boyfriend romantic",
      parent: "mom dad parent",
      friend: "best friend",
      sibling: "sister brother",
      colleague: "coworker office",
      boss: "boss manager professional",
      child: "kid son daughter",
      other: "",
    };
    parts.push(`${relLabel[intent.relationship] ?? intent.relationship} gift`);
  } else {
    parts.push(`gift idea`);
  }

  if (intent.occasion) {
    const occasionLabel: Record<string, string> = {
      birthday: "birthday",
      anniversary: "anniversary",
      christmas: "christmas",
      valentines: "valentines day",
      mothers_day: "mothers day",
      fathers_day: "fathers day",
      graduation: "graduation",
      wedding: "wedding",
      housewarming: "housewarming",
      other: "",
    };
    const occ = occasionLabel[intent.occasion];
    if (occ) parts.push(occ);
  }

  if (intent.budget_usd_max) {
    parts.push(`under $${intent.budget_usd_max}`);
  }

  return parts.join(" ");
}

// ─── Product → GiftProduct ────────────────────────────────────────────────────

function toGiftProduct(p: ShoppingProduct): GiftProduct {
  return {
    title: p.title,
    price: p.price,
    price_raw: p.price_raw,
    source: p.source,
    link: p.link,
    image_url: p.image_url,
    rating: p.rating,
    reviews: p.reviews,
  };
}

// ─── PlanOption builder ───────────────────────────────────────────────────────

interface GiftTierConfig {
  idx: number;
  label: string;
  angle: "safe" | "thoughtful" | "creative";
  summary: (lang: OutputLanguage, product: GiftProduct) => string;
  why_this_now: (lang: OutputLanguage) => string;
  best_for: (lang: OutputLanguage) => string;
}

const TIER_CONFIGS: GiftTierConfig[] = [
  {
    idx: 0,
    label: "safe",
    angle: "safe",
    summary: (lang, p) =>
      pickLanguageCopy(
        lang,
        `A crowd-pleasing choice that rarely misses: ${p.title}. Highly rated and easy to give.`,
        `口碑之选，几乎不会出错：${p.title}。评价极佳，简单大方。`
      ),
    why_this_now: (lang) =>
      pickLanguageCopy(
        lang,
        "The safe pick is proven popular — low risk of disappointing, high chance of delight.",
        "稳妥之选，广受好评，既不会让人失望，又有较大惊喜概率。"
      ),
    best_for: (lang) =>
      pickLanguageCopy(lang, "When you want to play it safe and nail it", "想要稳稳打动对方时"),
  },
  {
    idx: 1,
    label: "thoughtful",
    angle: "thoughtful",
    summary: (lang, p) =>
      pickLanguageCopy(
        lang,
        `A personalised pick tied to their specific interests: ${p.title}. Shows you paid attention.`,
        `根据他们的兴趣精心挑选：${p.title}。体现你的用心。`
      ),
    why_this_now: (lang) =>
      pickLanguageCopy(
        lang,
        "The most thoughtful pick tells them you know what they care about. It's the gift that says 'I see you.'",
        "最走心的礼物，让对方感受到你的关注。这份礼物在说「我了解你」。"
      ),
    best_for: (lang) =>
      pickLanguageCopy(lang, "When the relationship deserves a personal touch", "想展现用心与了解时"),
  },
  {
    idx: 2,
    label: "creative",
    angle: "creative",
    summary: (lang, p) =>
      pickLanguageCopy(
        lang,
        `A surprising and unexpected pick they wouldn't buy for themselves: ${p.title}. Memorable and unique.`,
        `出乎意料的惊喜之选，他们不会自己买的礼物：${p.title}。独特且难忘。`
      ),
    why_this_now: (lang) =>
      pickLanguageCopy(
        lang,
        "The most creative pick stands out from every other gift they'll receive. It's the one they'll remember.",
        "最有创意的礼物，在所有礼物中脱颖而出，让人印象深刻、念念不忘。"
      ),
    best_for: (lang) =>
      pickLanguageCopy(lang, "When you want to surprise and impress", "想要制造惊喜、令人印象深刻时"),
  },
];

function buildGiftPlanOption(
  product: GiftProduct,
  tier: GiftTierConfig,
  lang: OutputLanguage
): PlanOption {
  const priceStr = product.price_raw ?? (product.price ? `$${product.price}` : "Price varies");
  const ratingStr =
    product.rating
      ? pickLanguageCopy(lang, `${product.rating}★ (${product.reviews ?? "?"} reviews)`, `${product.rating}★（${product.reviews ?? "?"}条评价）`)
      : undefined;

  const highlights: string[] = [
    pickLanguageCopy(lang, `🏷 ${priceStr}`, `🏷 ${priceStr}`),
    ...(product.source ? [pickLanguageCopy(lang, `🛒 ${product.source}`, `🛒 ${product.source}`)] : []),
    ...(ratingStr ? [ratingStr] : []),
  ];

  const buyUrl = product.link ?? `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(product.title)}`;
  const primaryAction = {
    id: `buy-gift-${tier.idx}`,
    label: pickLanguageCopy(lang, "Buy this gift", "购买这份礼物"),
    url: buyUrl,
  };

  const searchUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(product.title)}`;
  const secondaryActions = [
    {
      id: `search-gift-${tier.idx}`,
      label: pickLanguageCopy(lang, "Compare prices", "比价"),
      url: searchUrl,
    },
  ];

  const tierLabels = [
    pickLanguageCopy(lang, "Safe pick", "稳妥之选"),
    pickLanguageCopy(lang, "Most thoughtful", "最走心"),
    pickLanguageCopy(lang, "Most creative", "最有创意"),
  ];

  return {
    id: `gift-opt-${tier.idx}`,
    label: tierLabels[tier.idx],
    option_category: "gift",
    title: product.title,
    subtitle: pickLanguageCopy(
      lang,
      [priceStr, product.source].filter(Boolean).join(" · "),
      [priceStr, product.source].filter(Boolean).join(" · ")
    ),
    summary: tier.summary(lang, product),
    why_this_now: tier.why_this_now(lang),
    best_for: tier.best_for(lang),
    estimated_total: priceStr,
    timing_note: pickLanguageCopy(
      lang,
      product.source ? `Available at ${product.source}` : "Available online",
      product.source ? `可在 ${product.source} 购买` : "可网络购买"
    ),
    risks: [],
    tradeoffs: [],
    highlights,
    primary_action: primaryAction,
    secondary_actions: secondaryActions,
    score: Math.max(7, 9.5 - tier.idx * 0.5),
  };
}

// ─── Next actions ─────────────────────────────────────────────────────────────

function buildNextActions(lang: OutputLanguage): PlanAction[] {
  return [
    {
      id: "refine-interests",
      type: "refine",
      label: pickLanguageCopy(lang, "Refine by interest", "按兴趣筛选"),
      description: pickLanguageCopy(lang, "Tell me more about their hobbies", "告诉我更多他们的爱好"),
      prompt: pickLanguageCopy(lang, "Find me gift ideas based on their specific interests", "根据他们具体的兴趣爱好找礼物"),
    },
    {
      id: "refine-budget",
      type: "refine",
      label: pickLanguageCopy(lang, "Change budget", "调整预算"),
      description: pickLanguageCopy(lang, "Try a different price range", "换个价格区间"),
      prompt: pickLanguageCopy(lang, "Find gifts in a different budget range", "在不同预算区间找礼物"),
    },
    {
      id: "share-plan",
      type: "share_plan",
      label: pickLanguageCopy(lang, "Share ideas", "分享礼物清单"),
      description: pickLanguageCopy(lang, "Share these gift options with someone", "将这些礼物选项分享给他人"),
    },
  ];
}

// ─── Main planner ─────────────────────────────────────────────────────────────

export async function runGiftPlanner(params: {
  intent: GiftIntent;
  outputLanguage: OutputLanguage;
}): Promise<DecisionPlan | null> {
  const { intent, outputLanguage: lang } = params;

  // Run all 3 searches in parallel
  const [safeProducts, thoughtfulProducts, creativeProducts] = await Promise.all([
    searchShoppingProducts({ query: buildSearchQuery(intent, "safe"), maxResults: 5 }),
    searchShoppingProducts({ query: buildSearchQuery(intent, "thoughtful"), maxResults: 5 }),
    searchShoppingProducts({ query: buildSearchQuery(intent, "creative"), maxResults: 5 }),
  ]);

  const tiers: Array<{ products: ShoppingProduct[]; tier: GiftTierConfig }> = [
    { products: safeProducts, tier: TIER_CONFIGS[0] },
    { products: thoughtfulProducts, tier: TIER_CONFIGS[1] },
    { products: creativeProducts, tier: TIER_CONFIGS[2] },
  ];

  const builtOptions: PlanOption[] = [];
  const evidenceItems: DecisionEvidenceItem[] = [];

  for (const { products, tier } of tiers) {
    const product = products[0];
    if (!product) continue;

    const giftProduct = toGiftProduct(product);
    builtOptions.push(buildGiftPlanOption(giftProduct, tier, lang));
    evidenceItems.push({
      id: `gift-evidence-${tier.idx}`,
      title: product.title,
      detail: [product.price_raw, product.source].filter(Boolean).join(" · "),
      tag: pickLanguageCopy(lang, tier.label, tier.label),
    });
  }

  if (builtOptions.length === 0) return null;

  const [primary, ...backups] = builtOptions;

  const recipientLabel = intent.recipient ?? pickLanguageCopy(lang, "someone special", "你的重要之人");
  const occasionLabel = intent.occasion
    ? ` ${pickLanguageCopy(lang, `for their ${intent.occasion.replace("_", " ")}`, `，${intent.occasion.replace("_", " ")} 礼物`)}`
    : "";
  const budgetLabel = intent.budget_usd_max
    ? pickLanguageCopy(lang, ` (budget: $${intent.budget_usd_max})`, `（预算：$${intent.budget_usd_max}）`)
    : "";

  return {
    id: `gift-${Date.now()}`,
    scenario: "gift",
    output_language: lang,
    title: pickLanguageCopy(
      lang,
      `Gift ideas for ${recipientLabel}${occasionLabel}`,
      `${recipientLabel}的礼物推荐${occasionLabel}`
    ),
    summary: pickLanguageCopy(
      lang,
      `I found 3 gift angles: a safe crowd-pleaser, a thoughtful pick tied to their interests, and a creative surprise. ${budgetLabel}`,
      `我从三个角度为你推荐礼物：稳妥之选、最走心之选和最有创意之选。${budgetLabel}`
    ),
    approval_prompt: pickLanguageCopy(
      lang,
      "Pick the angle that fits your vibe — tap Buy to go straight to checkout.",
      "选择最符合你风格的角度——点击「购买」直接结账。"
    ),
    confidence: builtOptions.length >= 3 ? "high" : "medium",
    scenario_brief: intent.planning_assumptions,
    primary_plan: primary,
    backup_plans: backups,
    tradeoff_summary: pickLanguageCopy(
      lang,
      "Safe pick is proven popular. Most thoughtful is personalised to their interests. Most creative surprises them with something unexpected.",
      "稳妥之选口碑好；最走心礼物根据兴趣定制；最有创意礼物带来意外惊喜。"
    ),
    risks: [
      pickLanguageCopy(lang, "Prices and availability may vary by retailer.", "不同零售商的价格和库存可能有所不同。"),
    ],
    next_actions: buildNextActions(lang),
    evidence_card_ids: evidenceItems.map((e) => e.id),
    evidence_items: evidenceItems,
  };
}
