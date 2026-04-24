import {
  BigPurchaseCategory,
  BigPurchaseIntent,
  DecisionPlan,
  HeadphoneRecommendationCard,
  LaptopRecommendationCard,
  MultilingualQueryContext,
  OutputLanguage,
  PlanLinkAction,
  PlanOption,
  SmartphoneRecommendationCard,
} from "../../types";
import { pickLanguageCopy } from "../../outputCopy";
import { mapLinksToOpenLinkActions } from "./utils";

// ─── Intent parsing ───────────────────────────────────────────────────────────

const CATEGORY_PATTERNS: Array<{ cat: BigPurchaseCategory; regex: RegExp }> = [
  { cat: "laptop", regex: /\blaptop\b|\bnotebook\b|\bmacbook\b/i },
  { cat: "headphone", regex: /\bheadphones?\b|\bearphones?\b|\bairpods?\b|\bearbuds?\b|\bbuds?\b/i },
  { cat: "smartphone", regex: /\bsmartphone\b|\biphone\b|\bandroid phone\b|\bpixel\b|\bgalaxy\b|\bphone\b/i },
  { cat: "tablet", regex: /\btablet\b|\bipad\b/i },
  { cat: "camera", regex: /\bcamera\b|\bdslr\b|\bmirrorless\b/i },
  { cat: "tv", regex: /\btv\b|\btelevision\b/i },
];

export function parseBigPurchaseIntent(
  message: string,
  queryContext: MultilingualQueryContext
): BigPurchaseIntent {
  const lower = message.toLowerCase();

  const matched = CATEGORY_PATTERNS.find(({ regex }) => regex.test(lower));
  const product_category: BigPurchaseCategory = matched?.cat ?? "other";

  // Budget extraction: $1800, under $300, ~$500, etc.
  const budgetMatch = lower.match(/\$\s*(\d[\d,]*)\b/) ?? lower.match(/(\d[\d,]+)\s*(?:usd|dollars?)/i);
  const budget_usd_max = budgetMatch ? parseInt(budgetMatch[1].replace(/,/g, ""), 10) : null;

  // OS preference
  const os_preference =
    /\bwindows\b/.test(lower) ? "windows" :
    /\bmac(?:os|book)?\b/.test(lower) ? "mac" :
    /\blinux\b/.test(lower) ? "linux" :
    /\bios\b|\biphone\b|\bipad\b|\bapple\b/.test(lower) ? "ios" :
    /\bandroid\b/.test(lower) ? "android" :
    undefined;

  // Use case extraction
  const use_case =
    /\bdev\b|\bdeveloper\b|\bcoding\b|\bprogramming\b/.test(lower) ? "development" :
    /\bgaming\b|\bgames?\b/.test(lower) ? "gaming" :
    /\bvideo\b|\bedit(?:ing)?\b/.test(lower) ? "video_editing" :
    /\bbusiness\b|\bwork\b|\boffice\b/.test(lower) ? "business" :
    /\bphotography\b|\bphoto\b/.test(lower) ? "photography" :
    /\bmusic\b|\baudio\b|\bhifi\b/.test(lower) ? "audio" :
    /\bcommute\b|\btravel\b/.test(lower) ? "commute" :
    undefined;

  return {
    category: "unknown",
    scenario: "big_purchase",
    product_category,
    query: message,
    budget_usd_max,
    os_preference,
    use_case,
    constraints: queryContext.constraints_hint,
  };
}

// ─── Amazon URL builder ───────────────────────────────────────────────────────

function buildAmazonUrl(name: string): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(name)}`;
}

// ─── Option builders ──────────────────────────────────────────────────────────

function buildLaptopOption(
  card: LaptopRecommendationCard,
  label: string,
  tradeoff_reason: string | undefined,
  tradeoff_detail: string | undefined,
  language: OutputLanguage
): PlanOption {
  const d = card.device;
  const sku = card.recommended_sku ?? d.skus[0];
  const priceUsd = sku?.price_usd ?? d.price_usd;
  const watchOuts = card.watch_out.slice(0, 2);

  const amazonAction: PlanLinkAction = {
    id: "open-amazon",
    label: pickLanguageCopy(language, "Buy on Amazon", "在 Amazon 购买"),
    url: buildAmazonUrl(d.name),
  };

  return {
    id: d.id,
    label,
    option_category: "laptop",
    title: d.name,
    subtitle: [d.brand, `${d.display_size}"`, d.os, `${d.weight_kg} kg`].filter(Boolean).join(" | "),
    summary: card.why_recommended,
    why_this_now: card.why_recommended,
    best_for: pickLanguageCopy(language, "Dev + daily use", "开发 + 日常使用"),
    estimated_total: `$${priceUsd.toLocaleString()}`,
    timing_note: pickLanguageCopy(language, `${d.cpu} · ${sku?.ram_gb ?? d.ram_gb} GB RAM`, `${d.cpu} · ${sku?.ram_gb ?? d.ram_gb} GB 内存`),
    risks: watchOuts,
    tradeoffs: [],
    highlights: [
      pickLanguageCopy(language, `CPU: ${d.cpu}`, `处理器：${d.cpu}`),
      pickLanguageCopy(language, `${sku?.ram_gb ?? d.ram_gb} GB RAM, ${sku?.storage_gb ?? d.storage_gb} GB storage`, `${sku?.ram_gb ?? d.ram_gb} GB 内存，${sku?.storage_gb ?? d.storage_gb} GB 存储`),
      ...(watchOuts.length > 0 ? [pickLanguageCopy(language, `Watch out: ${watchOuts[0]}`, `注意：${watchOuts[0]}`)] : []),
    ].filter(Boolean),
    primary_action: amazonAction,
    secondary_actions: [amazonAction],
    evidence_card_id: d.id,
    score: card.final_score,
    tradeoff_reason,
    tradeoff_detail,
    product_model: d.name,
  };
}

function buildHeadphoneOption(
  card: HeadphoneRecommendationCard,
  label: string,
  tradeoff_reason: string | undefined,
  tradeoff_detail: string | undefined,
  language: OutputLanguage
): PlanOption {
  const d = card.device;
  const watchOuts = card.watch_out.slice(0, 2);

  const amazonAction: PlanLinkAction = {
    id: "open-amazon",
    label: pickLanguageCopy(language, "Buy on Amazon", "在 Amazon 购买"),
    url: buildAmazonUrl(d.name),
  };

  return {
    id: d.id,
    label,
    option_category: "headphone",
    title: d.name,
    subtitle: [d.brand, d.form_factor.replace("_", " "), d.wireless ? "wireless" : "wired", `$${d.price_usd}`].join(" | "),
    summary: card.why_recommended,
    why_this_now: card.why_recommended,
    best_for: pickLanguageCopy(language, "All-day listening", "全天候聆听"),
    estimated_total: `$${d.price_usd.toLocaleString()}`,
    timing_note: pickLanguageCopy(language, d.wireless ? "Wireless / Bluetooth" : "Wired", d.wireless ? "无线 / 蓝牙" : "有线"),
    risks: watchOuts,
    tradeoffs: [],
    highlights: [
      pickLanguageCopy(language, `${d.form_factor.replace("_", " ")} · ${d.weight_g}g`, `${d.form_factor.replace("_", " ")} · ${d.weight_g}g`),
      ...(watchOuts.length > 0 ? [pickLanguageCopy(language, `Watch out: ${watchOuts[0]}`, `注意：${watchOuts[0]}`)] : []),
    ].filter(Boolean),
    primary_action: amazonAction,
    secondary_actions: [amazonAction],
    evidence_card_id: d.id,
    score: card.final_score,
    tradeoff_reason,
    tradeoff_detail,
    product_model: d.name,
  };
}

function buildSmartphoneOption(
  card: SmartphoneRecommendationCard,
  label: string,
  tradeoff_reason: string | undefined,
  tradeoff_detail: string | undefined,
  language: OutputLanguage
): PlanOption {
  const d = card.device;
  const sku = card.recommended_sku ?? d.skus[0];
  const priceUsd = sku?.price_usd ?? d.price_usd;
  const watchOuts = card.watch_out.slice(0, 2);

  const amazonAction: PlanLinkAction = {
    id: "open-amazon",
    label: pickLanguageCopy(language, "Buy on Amazon", "在 Amazon 购买"),
    url: buildAmazonUrl(d.name),
  };

  return {
    id: d.id,
    label,
    option_category: "smartphone",
    title: d.name,
    subtitle: [d.brand, d.os, `${d.display_size}"`, `${d.weight_g}g`].filter(Boolean).join(" | "),
    summary: card.why_recommended,
    why_this_now: card.why_recommended,
    best_for: pickLanguageCopy(language, "Everyday use", "日常使用"),
    estimated_total: `$${priceUsd.toLocaleString()}`,
    timing_note: pickLanguageCopy(language, `${d.cpu} · ${sku?.storage_gb ?? 128} GB`, `${d.cpu} · ${sku?.storage_gb ?? 128} GB`),
    risks: watchOuts,
    tradeoffs: [],
    highlights: [
      pickLanguageCopy(language, `${d.os === "ios" ? "iOS" : "Android"} · ${d.cpu}`, `${d.os === "ios" ? "iOS" : "Android"} · ${d.cpu}`),
      ...(watchOuts.length > 0 ? [pickLanguageCopy(language, `Watch out: ${watchOuts[0]}`, `注意：${watchOuts[0]}`)] : []),
    ].filter(Boolean),
    primary_action: amazonAction,
    secondary_actions: [amazonAction],
    evidence_card_id: d.id,
    score: card.final_score,
    tradeoff_reason,
    tradeoff_detail,
    product_model: d.name,
  };
}

// ─── Tradeoff labels ──────────────────────────────────────────────────────────

function inferTradeoffReason(
  index: number,
  card: LaptopRecommendationCard | HeadphoneRecommendationCard | SmartphoneRecommendationCard,
  primaryCard: LaptopRecommendationCard | HeadphoneRecommendationCard | SmartphoneRecommendationCard,
  language: OutputLanguage
): string {
  // Try to derive a meaningful tradeoff label by comparing price to primary
  const getPrice = (c: typeof card) =>
    "device" in c ? (c.device.skus[0]?.price_usd ?? (c.device as { price_usd: number }).price_usd) : 0;
  const primaryPrice = getPrice(primaryCard);
  const backupPrice = getPrice(card);
  const diff = backupPrice - primaryPrice;

  if (Math.abs(diff) > 50) {
    return pickLanguageCopy(
      language,
      diff < 0 ? "Want cheaper" : "Want premium",
      diff < 0 ? "想省钱" : "想更好"
    );
  }
  return pickLanguageCopy(language, index === 0 ? "Want different" : "Another option", index === 0 ? "想要不同" : "另一个选择");
}

function inferTradeoffDetail(
  card: LaptopRecommendationCard | HeadphoneRecommendationCard | SmartphoneRecommendationCard,
  primaryCard: LaptopRecommendationCard | HeadphoneRecommendationCard | SmartphoneRecommendationCard,
  language: OutputLanguage
): string {
  const getPrice = (c: typeof card) =>
    "device" in c ? (c.device.skus[0]?.price_usd ?? (c.device as { price_usd: number }).price_usd) : 0;
  const primaryPrice = getPrice(primaryCard);
  const backupPrice = getPrice(card);
  const diff = backupPrice - primaryPrice;
  const sign = diff < 0 ? "saves" : "costs";
  const amount = Math.abs(diff);

  const whyLine = card.why_recommended.split(".")[0];
  if (amount > 20) {
    return pickLanguageCopy(language, `${whyLine} · ${sign} ~$${amount}`, `${whyLine} · 比主选${diff < 0 ? "便宜" : "贵"}约 $${amount}`);
  }
  return whyLine;
}

// ─── Main planner ─────────────────────────────────────────────────────────────

type ProductCard =
  | LaptopRecommendationCard
  | HeadphoneRecommendationCard
  | SmartphoneRecommendationCard;

function buildOptionFromCard(
  card: ProductCard,
  label: string,
  tradeoff_reason: string | undefined,
  tradeoff_detail: string | undefined,
  language: OutputLanguage
): PlanOption {
  if ("cpu" in card.device) {
    return buildLaptopOption(card as LaptopRecommendationCard, label, tradeoff_reason, tradeoff_detail, language);
  }
  if ("form_factor" in card.device) {
    return buildHeadphoneOption(card as HeadphoneRecommendationCard, label, tradeoff_reason, tradeoff_detail, language);
  }
  return buildSmartphoneOption(card as SmartphoneRecommendationCard, label, tradeoff_reason, tradeoff_detail, language);
}

export function runBigPurchasePlanner(params: {
  intent: BigPurchaseIntent;
  recommendations: ProductCard[];
  outputLanguage: OutputLanguage;
}): DecisionPlan | null {
  const { intent, recommendations, outputLanguage: lang } = params;
  if (recommendations.length === 0) return null;

  const [primaryCard, ...rest] = recommendations;
  const backupCards = rest.slice(0, 2);

  const primaryLabel = pickLanguageCopy(lang, "My Recommendation", "主推");
  const primaryOption = buildOptionFromCard(primaryCard, primaryLabel, undefined, undefined, lang);

  const backupOptions = backupCards.map((card, i) => {
    const tradeoff_reason = inferTradeoffReason(i, card, primaryCard, lang);
    const tradeoff_detail = inferTradeoffDetail(card, primaryCard, lang);
    const backupLabel = pickLanguageCopy(lang, `Backup ${i + 1}`, `备选 ${i + 1}`);
    return buildOptionFromCard(card, backupLabel, tradeoff_reason, tradeoff_detail, lang);
  });

  const budgetLine = intent.budget_usd_max
    ? pickLanguageCopy(lang, `~$${intent.budget_usd_max}`, `约 $${intent.budget_usd_max}`)
    : "";
  const categoryLabel = intent.product_category === "other"
    ? pickLanguageCopy(lang, "product", "产品")
    : intent.product_category;
  const osLine = intent.os_preference ? ` · ${intent.os_preference}` : "";

  const scenarioBrief: string[] = [
    [categoryLabel, budgetLine, intent.use_case, intent.os_preference].filter(Boolean).join(" · "),
  ].filter(Boolean);

  const openLinkActions = mapLinksToOpenLinkActions(primaryOption.secondary_actions ?? []);

  return {
    id: `big-purchase-${primaryOption.id}`,
    scenario: "big_purchase",
    output_language: lang,
    title: pickLanguageCopy(lang, `${categoryLabel} recommendation${osLine}`, `${categoryLabel}推荐${osLine}`),
    summary: pickLanguageCopy(
      lang,
      `I narrowed this down to one clear pick with ${backupOptions.length} alternative${backupOptions.length === 1 ? "" : "s"} so you can decide instead of comparing specs.`,
      `我已经把选项压缩成 1 个主推方案和 ${backupOptions.length} 个备选，你现在不用再自己比较参数了。`
    ),
    approval_prompt: pickLanguageCopy(
      lang,
      "Go with my pick, or swap to an alternative if you want a different trade-off.",
      "如果认可就按主推来，想换个取舍就切到备选。"
    ),
    confidence: recommendations.length >= 3 ? "high" : recommendations.length >= 1 ? "medium" : "low",
    scenario_brief: scenarioBrief,
    primary_plan: primaryOption,
    backup_plans: backupOptions,
    show_more_available: rest.length > 2,
    tradeoff_summary: (() => {
      const primaryName = primaryCard.device.name;
      const primaryScore = primaryCard.final_score?.toFixed(1) ?? "";
      const scoreStr = primaryScore
        ? pickLanguageCopy(lang, ` (score ${primaryScore})`, `（评分 ${primaryScore}）`)
        : "";
      const lead = pickLanguageCopy(
        lang,
        `${primaryName}${scoreStr} is the top pick.`,
        `${primaryName}${scoreStr} 是首选。`
      );
      const backupSummaries = backupOptions.map((opt) =>
        opt.tradeoff_reason
          ? pickLanguageCopy(lang, `${opt.title}: ${opt.tradeoff_reason}.`, `${opt.title}：${opt.tradeoff_reason}。`)
          : null
      ).filter(Boolean);
      return [lead, ...backupSummaries].join(" ");
    })(),
    risks: backupOptions.flatMap((o) => o.risks.slice(0, 1)),
    next_actions: [
      ...openLinkActions,
      {
        id: "share-plan",
        type: "share_plan",
        label: pickLanguageCopy(lang, "Share plan", "分享方案"),
        description: pickLanguageCopy(lang, "Copy a shareable link for this recommendation.", "复制这个推荐方案的分享链接。"),
      },
      {
        id: "send-for-vote",
        type: "send_for_vote",
        label: pickLanguageCopy(lang, "Send to friends", "发给朋友投票"),
        description: pickLanguageCopy(lang, "Let others vote on the options.", "让朋友们投票选出最喜欢的方案。"),
      },
      {
        id: "refine-0",
        type: "refine",
        label: pickLanguageCopy(lang, "Show cheaper options", "看更便宜的"),
        description: pickLanguageCopy(lang, "Rerun with a lower budget target.", "按更低预算重新推荐。"),
        prompt: pickLanguageCopy(
          lang,
          `Show me ${categoryLabel} options with a lower budget than ${intent.budget_usd_max ? `$${intent.budget_usd_max}` : "this"}.`,
          `推荐比${intent.budget_usd_max ? ` $${intent.budget_usd_max}` : "这个"}更便宜的${categoryLabel}选项。`
        ),
      },
    ],
    evidence_card_ids: recommendations.map((c) => c.device.id),
    evidence_items: recommendations.slice(0, 3).map((c) => ({
      id: c.device.id,
      title: c.device.name,
      detail: c.why_recommended,
      tag: pickLanguageCopy(lang, `Score ${c.final_score.toFixed(1)}`, `评分 ${c.final_score.toFixed(1)}`),
    })),
  };
}
