import { sql } from "./db";
import {
  CityTripIntent,
  CreditCardRecommendationCard,
  DateNightDecisionStyle,
  DateNightFollowUp,
  DateNightIntent,
  DateNightStage,
  DecisionEvidenceItem,
  DecisionPlan,
  FlightRecommendationCard,
  HotelRecommendationCard,
  OutputLanguage,
  ParsedIntent,
  PlanAction,
  PlanLinkAction,
  PlanOption,
  RecommendationCard,
  RestaurantIntent,
  ScenarioIntent,
  ScenarioType,
  WeekendTripIntent,
} from "./types";
import { pickLanguageCopy } from "./outputCopy";
import { runModularPlanner } from "./agent/planner-engine";
import { ModuleResults } from "./agent/planner-engine/types";
import { buildCityTripEngineConfig } from "./agent/scenario-configs/city-trip";
import { mapLinksToOpenLinkActions } from "./agent/planners/utils";
import {
  getBestCardForTrip,
  buildTripCardCallout,
} from "./agent/planners/trip-card";
import {
  buildBookingComUrl,
  buildKayakFlightsUrl,
  buildOpenTableUrl,
  type GoogleFlightsOpts,
} from "./agent/planners/booking-links";

const DATE_NIGHT_REGEX =
  /\bdate night\b|\bfirst date\b|\banniversary\b|\bromantic\b|\bproposal\b|\bdating\b|\bdate\b|\bpartner\b|\bgirlfriend\b|\bboyfriend\b|\bwife\b|\bhusband\b|\bfiance\b/i;
const DATE_NIGHT_ZH_REGEX =
  /约会|第一次约会|第一次见面|浪漫|纪念日|表白|女朋友|男朋友|老婆|老公/;
const WEEKEND_TRIP_REGEX =
  /\bweekend trip\b|\bweekend getaway\b|\bweekend away\b|\bgetaway\b|\bcity break\b|\bshort trip\b|\bmini vacation\b|\btrip package\b/i;
const WEEKEND_ZH_REGEX = /周末|短途|旅行|出游|度假/;
const CITY_TRIP_REGEX =
  /\bformulate.*plans?\b|\bplans? for.*trip\b|\btrip.*plans?\b|\bitinerary\b|\bseveral plans\b/i;
const CITY_TRIP_ZH_REGEX = /制定.*方案|旅游.*方案|行程.*规划|出行.*计划|几套.*方案|行程.*安排/;
const EVENING_ZH_REGEX = /晚上|晚饭|晚餐/;
const NOON_ZH_REGEX = /中午|午饭|午餐/;
const MORNING_ZH_REGEX = /早餐|早饭/;

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const CHINESE_WEEKDAY_ALIASES: Array<{ english: string; aliases: string[] }> = [
  { english: "monday", aliases: ["周一", "星期一", "礼拜一"] },
  { english: "tuesday", aliases: ["周二", "星期二", "礼拜二"] },
  { english: "wednesday", aliases: ["周三", "星期三", "礼拜三"] },
  { english: "thursday", aliases: ["周四", "星期四", "礼拜四"] },
  { english: "friday", aliases: ["周五", "星期五", "礼拜五"] },
  { english: "saturday", aliases: ["周六", "星期六", "礼拜六"] },
  { english: "sunday", aliases: ["周日", "周天", "星期日", "星期天", "礼拜日", "礼拜天"] },
];

// Big purchase: product category keyword + (budget signal OR purchase intent verb)
// Priority: city_trip/weekend_trip take precedence when both would match.
const BIG_PURCHASE_CATEGORY_REGEX =
  /\blaptop\b|\bnotebook\b|\bmacbook\b|\bheadphones?\b|\bairpods?\b|\bbuds?\b|\bsmartphone\b|\biphone\b|\bandroid phone\b|\bpixel\b|\bgalaxy\b|\btablet\b|\bipad\b|\bcamera\b|\bdslr\b|\bmirrorless\b|\btv\b|\btelevision\b|\bappliance\b|\bwasher\b|\bdryer\b|\brefrigerator\b/i;
const BIG_PURCHASE_BUDGET_REGEX = /\$\d+|\bunder\b|\baround\b|\babout\b|\bbudget\b|\bmax\b|\bless than\b|\bup to\b/i;
const BIG_PURCHASE_INTENT_REGEX = /\bbuy\b|\bpurchase\b|\bpick\b|\bget\b|\bshould i get\b|\bhelp me (?:pick|choose|find|get|buy)\b|\bwhich (?:one|laptop|phone|headphone)\b|\bbest \w+ (?:under|for|around)\b|\brecommend\b/i;

export function detectScenarioFromMessage(message: string): ScenarioType | null {
  const lower = message.toLowerCase();
  // Exclude common false positives: "round trip", "business trip", "day trip"
  const tripWordIsWeekend = /\btrip\b/.test(lower) && !/\bround.?trip\b|\bbusiness.?trip\b|\bday.?trip\b|\bone.?way\b/i.test(lower);
  const hasWeekendSignal =
    WEEKEND_TRIP_REGEX.test(lower) ||
    // Require BOTH flight and hotel signals — hotel-only or flight-only queries
    // ("find a hotel for the weekend", "cheap flights this weekend") should NOT trigger
    // the trip-package flow; only queries that explicitly involve both travel + accommodation do.
    ((/\bweekend\b|\btravel\b|\bgetaway\b|\bvacation\b/i.test(lower) || tripWordIsWeekend) &&
      /\bflight\b|\bfly\b/.test(lower) &&
      /\bhotel\b|\bstay\b/.test(lower)) ||
    (WEEKEND_ZH_REGEX.test(message) && /航班|机票/.test(message) && /酒店|住宿/.test(message));

  if (hasWeekendSignal) return "weekend_trip";

  // City trip: traveling to a city + hotel + activities (restaurants/bars/nightlife)
  const hasCityTripSignal =
    ((/\btravel(?:ing)? to\b|\bgoing to\b|\bvisit(?:ing)?\b|\btrip to\b/i.test(lower)) &&
      /\bhotel\b|\bstay\b|\bbook\b.*\bhotel\b|\breserve\b.*\bhotel\b/i.test(lower) &&
      /\brestaurants?\b|\bbars?\b|\bnightlife\b|\bmusic\b|\beat\b|\bdining\b|\bdrink/i.test(lower)) ||
    (CITY_TRIP_REGEX.test(lower) && /\bhotel\b|\bstay\b/i.test(lower)) ||
    (CITY_TRIP_ZH_REGEX.test(message) && /酒店|住宿/.test(message));
  if (hasCityTripSignal) return "city_trip";

  if (DATE_NIGHT_REGEX.test(lower) || DATE_NIGHT_ZH_REGEX.test(message)) {
    return "date_night";
  }

  // Big purchase: product category + budget signal OR explicit purchase intent verb
  if (
    BIG_PURCHASE_CATEGORY_REGEX.test(lower) &&
    (BIG_PURCHASE_BUDGET_REGEX.test(lower) || BIG_PURCHASE_INTENT_REGEX.test(lower))
  ) {
    return "big_purchase";
  }

  return null;
}

export function detectScenario(
  message: string,
  intent: ParsedIntent
): ScenarioType | null {
  if (intent.category !== "restaurant") {
    const scenario = detectScenarioFromMessage(message);
    return scenario === "weekend_trip" || scenario === "city_trip" ? scenario : null;
  }
  if (intent.purpose === "date") return "date_night";
  if (DATE_NIGHT_REGEX.test(message.toLowerCase()) || DATE_NIGHT_ZH_REGEX.test(message)) {
    return "date_night";
  }
  if (
    intent.party_size === 2 &&
    (intent.noise_level === "quiet" ||
      (intent.atmosphere ?? []).some((item) =>
        /romantic|intimate|quiet|cozy|约会|浪漫|安静/i.test(item)
      ))
  ) {
    return "date_night";
  }
  return null;
}

export function parseScenarioIntent(
  message: string,
  intent: RestaurantIntent
): ScenarioIntent | null {
  if (detectScenario(message, intent) !== "date_night") return null;
  return {
    ...intent,
    scenario: "date_night",
    scenario_goal: buildDateNightGoal(intent, inferDateNightStage(message)),
    stage: inferDateNightStage(message),
    follow_up_preference: inferFollowUpPreference(message),
    decision_style: inferDecisionStyle(message),
    time_hint: inferTimeHint(message),
    detected_date_text: inferDateText(message),
    wants_quiet_buffer:
      intent.noise_level === "quiet" ||
      /quiet|calm|not too loud|low noise|easy conversation/i.test(message) ||
      /安静|不要太吵|别太吵/.test(message),
  };
}

export function runScenarioPlanner(params: {
  scenarioIntent: DateNightIntent;
  recommendations: RecommendationCard[];
  userMessage: string;
  cityLabel: string;
  outputLanguage: OutputLanguage;
  afterDinnerOption?: import("./types").AfterDinnerVenue | null;
}): DecisionPlan | null {
  if (params.recommendations.length === 0) return null;
  const primaryCard = params.recommendations[0];
  const backupCards = params.recommendations.slice(1, 3);
  const primaryPlanBase = buildDateNightOption(
    primaryCard,
    params.scenarioIntent,
    undefined,
    pickLanguageCopy(params.outputLanguage, "Main pick", "主方案"),
    params.userMessage,
    params.outputLanguage
  );
  // Attach after_dinner_option to the primary plan so it travels with it during backup promotion.
  const primaryPlan = params.afterDinnerOption
    ? { ...primaryPlanBase, after_dinner_option: params.afterDinnerOption }
    : primaryPlanBase;
  const backupPlans = backupCards.map((card, index) =>
    buildDateNightOption(
      card,
      params.scenarioIntent,
      describeDateNightFallback(card, primaryCard, index, params.outputLanguage),
      pickLanguageCopy(params.outputLanguage, `Backup ${index + 1}`, `备选 ${index + 1}`),
      params.userMessage,
      params.outputLanguage
    )
  );
  const risks = dedupeStrings([
    ...collectDateNightRisks(primaryCard, params.scenarioIntent, params.outputLanguage),
    ...backupPlans.flatMap((plan) => plan.risks.slice(0, 1)),
  ]).slice(0, 4);

  return {
    id: `date-night-${primaryCard.restaurant.id}`,
    scenario: "date_night",
    output_language: params.outputLanguage,
    title: pickLanguageCopy(
      params.outputLanguage,
      `${formatStageLabel(params.scenarioIntent.stage, "en")} decision package`,
      `${formatStageLabel(params.scenarioIntent.stage, "zh")}决策方案`
    ),
    summary: pickLanguageCopy(
      params.outputLanguage,
      `I compressed this into one main date-night plan and ${backupPlans.length} fallback option${backupPlans.length === 1 ? "" : "s"} so you can approve instead of comparing a long list.`,
      `我已经把它压缩成 1 个主方案和 ${backupPlans.length} 个备选，你现在不用再在长列表里自己来回比较了。`
    ),
    approval_prompt: pickLanguageCopy(
      params.outputLanguage,
      "Approve the main plan if you want the safest move, or swap to a backup if you want a different tradeoff.",
      "如果你想走最稳的方案，就直接确认主方案；如果你想换一种取舍，可以切到备选。"
    ),
    confidence: inferConfidence(primaryCard.score, backupPlans.length),
    scenario_brief: buildDateNightBrief(
      params.scenarioIntent,
      primaryCard,
      params.cityLabel,
      params.outputLanguage
    ),
    primary_plan: primaryPlan,
    backup_plans: backupPlans,
    show_more_available: params.recommendations.length > 3,
    tradeoff_summary: buildDateNightTradeoffSummary(primaryCard, backupCards, params.outputLanguage),
    ...(() => {
      const eventDate = resolveDateContext(params.scenarioIntent.detected_date_text);
      if (!eventDate) return {};
      const { hours, minutes } = resolveTimeContext(params.scenarioIntent.time_hint);
      const pad = (n: number) => String(n).padStart(2, "0");
      const localISO = `${eventDate.getFullYear()}-${pad(eventDate.getMonth() + 1)}-${pad(eventDate.getDate())}T${pad(hours)}:${pad(minutes)}:00`;
      return {
        event_datetime: localISO,
        event_location: primaryCard.restaurant.address,
      };
    })(),
    risks,
    next_actions: buildDateNightActions(
      primaryCard.suggested_refinements ?? [],
      params.outputLanguage,
      primaryPlan
    ),
    evidence_card_ids: params.recommendations.slice(0, 3).map((card) => card.restaurant.id),
    evidence_items: params.recommendations.slice(0, 3).map((card) => ({
      id: card.restaurant.id,
      title: card.restaurant.name,
      detail: `${card.why_recommended}${card.watch_out ? pickLanguageCopy(params.outputLanguage, ` Watch-out: ${card.watch_out}`, ` 注意：${card.watch_out}`) : ""}`,
      tag: `${card.restaurant.cuisine || pickLanguageCopy(params.outputLanguage, "Restaurant", "餐厅")} | ${pickLanguageCopy(params.outputLanguage, "score", "评分")} ${card.score.toFixed(1)}`,
    })),
  };
}

export function runWeekendTripPlanner(params: {
  scenarioIntent: WeekendTripIntent;
  flightRecommendations: FlightRecommendationCard[];
  hotelRecommendations: HotelRecommendationCard[];
  creditCardRecommendations: CreditCardRecommendationCard[];
  restaurantRecommendations?: RecommendationCard[];
  userMessage: string;
  outputLanguage: OutputLanguage;
}): DecisionPlan | null {
  if (!params.flightRecommendations.length || !params.hotelRecommendations.length) {
    return null;
  }

  const stablePair = {
    flight: pickStableFlight(params.flightRecommendations),
    hotel: pickStableHotel(params.hotelRecommendations),
  };
  const valuePair = {
    flight: pickValueFlight(params.flightRecommendations, stablePair.flight.flight.id),
    hotel: pickValueHotel(params.hotelRecommendations, stablePair.hotel.hotel.id),
  };
  const experiencePair = {
    flight: pickExperienceFlight(
      params.flightRecommendations,
      new Set([stablePair.flight.flight.id, valuePair.flight.flight.id])
    ),
    hotel: pickExperienceHotel(
      params.hotelRecommendations,
      new Set([stablePair.hotel.hotel.id, valuePair.hotel.hotel.id])
    ),
  };

  // Assign restaurants to tiers: top-rated for experience, mid for stable, any for value
  const restaurants = params.restaurantRecommendations ?? [];
  const r0 = restaurants[0];
  const r1 = restaurants[1] ?? r0;
  const r2 = restaurants[2] ?? r0;

  const optionMap = {
    stable: buildWeekendTripOption({
      id: "stable",
      label: pickLanguageCopy(params.outputLanguage, "Most stable", "最稳妥"),
      scenarioIntent: params.scenarioIntent,
      flight: stablePair.flight,
      hotel: stablePair.hotel,
      restaurant: r1,
      card: pickCardForSpend(params.creditCardRecommendations, estimateTripTotal(stablePair.flight, stablePair.hotel)),
      fallbackReason: pickLanguageCopy(params.outputLanguage, "Default if you want the least fragile itinerary.", "如果你想要最不容易出错的行程，就选这个。"),
      outputLanguage: params.outputLanguage,
    }),
    value: buildWeekendTripOption({
      id: "value",
      label: pickLanguageCopy(params.outputLanguage, "Best value", "最划算"),
      scenarioIntent: params.scenarioIntent,
      flight: valuePair.flight,
      hotel: valuePair.hotel,
      restaurant: r2,
      card: pickCardForSpend(params.creditCardRecommendations, estimateTripTotal(valuePair.flight, valuePair.hotel)),
      fallbackReason: pickLanguageCopy(params.outputLanguage, "Use this if staying under budget matters more than polish.", "如果你更在意压住预算，而不是追求最顺滑的体验，就选这个。"),
      outputLanguage: params.outputLanguage,
    }),
    experience: buildWeekendTripOption({
      id: "experience",
      label: pickLanguageCopy(params.outputLanguage, "Best experience", "体验最好"),
      scenarioIntent: params.scenarioIntent,
      flight: experiencePair.flight,
      hotel: experiencePair.hotel,
      restaurant: r0,
      card: pickCardForSpend(params.creditCardRecommendations, estimateTripTotal(experiencePair.flight, experiencePair.hotel)),
      fallbackReason: pickLanguageCopy(params.outputLanguage, "Use this if you are willing to spend a bit more for a smoother stay.", "如果你愿意多花一点，换更顺的行程和更舒服的入住体验，就选这个。"),
      outputLanguage: params.outputLanguage,
    }),
  };

  // Deduplicate: when inventory is limited, pick* functions fall back to the same flight/hotel,
  // producing options with identical itineraries but different labels. Filter them out before
  // building the plan so the user never sees duplicate packages.
  const pairCombo: Record<string, string> = {
    stable: `${stablePair.flight.flight.id}:${stablePair.hotel.hotel.id}`,
    value: `${valuePair.flight.flight.id}:${valuePair.hotel.hotel.id}`,
    experience: `${experiencePair.flight.flight.id}:${experiencePair.hotel.hotel.id}`,
  };
  const seenCombos = new Set<string>();
  const uniqueKeys = chooseWeekendTripPriority(params.scenarioIntent).filter((key) => {
    const combo = pairCombo[key];
    if (seenCombos.has(combo)) return false;
    seenCombos.add(combo);
    return true;
  });
  const ordered = uniqueKeys.map((key) => optionMap[key]);
  const primary = ordered[0];
  const backups = ordered.slice(1, 3).map((option, index) => ({
    ...option,
    label: pickLanguageCopy(params.outputLanguage, `Backup ${index + 1}`, `备选 ${index + 1}`),
  }));

  const evidenceItems: DecisionEvidenceItem[] = [
    {
      id: `flight-${primary.id}`,
      title: pickLanguageCopy(params.outputLanguage, `${primary.title} flight`, `${primary.title} 的航班`),
      detail: primary.highlights[0] ?? primary.summary,
      tag: pickLanguageCopy(params.outputLanguage, "Flight", "航班"),
    },
    {
      id: `hotel-${primary.id}`,
      title: pickLanguageCopy(params.outputLanguage, `${primary.title} hotel`, `${primary.title} 的酒店`),
      detail: primary.highlights[1] ?? primary.why_this_now,
      tag: pickLanguageCopy(params.outputLanguage, "Hotel", "酒店"),
    },
  ];
  if (primary.highlights[2]) {
    evidenceItems.push({
      id: `card-${primary.id}`,
      title: pickLanguageCopy(params.outputLanguage, "Trip card fit", "旅行卡匹配"),
      detail: primary.highlights[2],
      tag: pickLanguageCopy(params.outputLanguage, "Card", "信用卡"),
    });
  }

  return {
    id: `weekend-trip-${params.scenarioIntent.destination_city ?? "trip"}-${params.scenarioIntent.start_date ?? "tbd"}`,
    scenario: "weekend_trip",
    output_language: params.outputLanguage,
    title: pickLanguageCopy(
      params.outputLanguage,
      `${params.scenarioIntent.destination_city ?? "Weekend"} trip package`,
      `${params.scenarioIntent.destination_city ?? "周末"}旅行方案包`
    ),
    summary: pickLanguageCopy(
      params.outputLanguage,
      "I bundled flight, hotel, timing risk, and card choice into three trip packages so you can approve one trip shape instead of manually stitching travel tabs together.",
      "我已经把航班、酒店、时间衔接风险和用卡建议打包成 3 套旅行方案，你现在只需要批准一种行程形态。"
    ),
    approval_prompt: pickLanguageCopy(
      params.outputLanguage,
      "Approve the package that best matches your tolerance for cost versus friction.",
      "直接确认最符合你对预算和折腾程度取舍的那套方案。"
    ),
    confidence: inferConfidence(primary.score, backups.length),
    scenario_brief: buildWeekendTripBrief(params.scenarioIntent, primary, params.outputLanguage),
    primary_plan: {
      ...primary,
      label: pickLanguageCopy(params.outputLanguage, "Main pick", "主方案"),
      fallback_reason: undefined,
    },
    backup_plans: backups,
    show_more_available: false,
    tradeoff_summary: buildWeekendTripTradeoffSummary(
      ordered.map((opt) => ({
        label: opt.label,
        total: parseFloat(opt.estimated_total.replace(/[$,]/g, "")) || 0,
        flightLabel: opt.highlights[0]?.split(":")[0]?.trim() ?? opt.title,
        hotelLabel: opt.highlights[1]?.split(":")[0]?.trim() ?? "",
      })),
      params.outputLanguage
    ),
    ...(() => {
      if (!params.scenarioIntent.start_date) return {};
      const primaryPairKey = uniqueKeys[0] as "stable" | "value" | "experience";
      const primaryHotelCard = { stable: stablePair.hotel, value: valuePair.hotel, experience: experiencePair.hotel }[primaryPairKey];
      return {
        event_datetime: `${params.scenarioIntent.start_date}T09:00:00`,
        event_location: primaryHotelCard.hotel.address || primaryHotelCard.hotel.name,
      };
    })(),
    ...(() => {
      const primaryPairKey = uniqueKeys[0] as "stable" | "value" | "experience";
      const primaryPair = { stable: stablePair, value: valuePair, experience: experiencePair }[primaryPairKey];
      const card = getBestCardForTrip({ flight_usd: primaryPair.flight.flight.price, hotel_usd: primaryPair.hotel.hotel.total_price });
      if (!card) return {};
      const lang = params.outputLanguage === "zh" ? "zh" : "en";
      return { trip_card_callout: buildTripCardCallout(card, lang) };
    })(),
    risks: dedupeStrings([
      ...primary.risks,
      ...backups.flatMap((option) => option.risks.slice(0, 1)),
    ]).slice(0, 4),
    next_actions: buildWeekendTripActions(params.scenarioIntent, params.outputLanguage, primary),
    evidence_card_ids: dedupeStrings([
      stablePair.flight.flight.id,
      stablePair.hotel.hotel.id,
      valuePair.flight.flight.id,
      valuePair.hotel.hotel.id,
      experiencePair.flight.flight.id,
      experiencePair.hotel.hotel.id,
    ]),
    evidence_items: evidenceItems,
    autopilot_context: {
      city: params.scenarioIntent.destination_city,
      departure_city: params.scenarioIntent.departure_city,
      start_date: params.scenarioIntent.start_date,
      end_date: params.scenarioIntent.end_date,
      travelers: params.scenarioIntent.travelers,
    },
  };
}

// ─── Plan-level tradeoff summary ──────────────────────────────────────────────

/**
 * Builds a 1-2 sentence plan-level comparative summary explaining why the
 * primary is the default pick and what each backup trades away.
 * Rendered between the primary card and the backup section in ScenarioPlanView.
 */
function buildDateNightTradeoffSummary(
  primaryCard: RecommendationCard,
  backupCards: RecommendationCard[],
  language: OutputLanguage
): string {
  if (backupCards.length === 0) return "";
  const parts: string[] = [];

  const primaryScore = primaryCard.score.toFixed(1);
  parts.push(
    pickLanguageCopy(
      language,
      `${primaryCard.restaurant.name} is the default pick (score ${primaryScore}).`,
      `${primaryCard.restaurant.name} 是默认推荐（评分 ${primaryScore}）。`
    )
  );

  backupCards.forEach((card) => {
    const scoreDiff = (primaryCard.score - card.score).toFixed(1);
    const primaryPrice = normalizePrice(primaryCard.restaurant.price);
    const backupPrice = normalizePrice(card.restaurant.price);
    if (backupPrice < primaryPrice) {
      parts.push(
        pickLanguageCopy(
          language,
          `${card.restaurant.name} is cheaper but scores ${scoreDiff} lower.`,
          `${card.restaurant.name} 更便宜，但评分低 ${scoreDiff} 分。`
        )
      );
    } else if (
      card.restaurant.review_signals?.noise_level === "quiet" &&
      primaryCard.restaurant.review_signals?.noise_level !== "quiet"
    ) {
      parts.push(
        pickLanguageCopy(
          language,
          `${card.restaurant.name} is quieter but trades some overall score (−${scoreDiff}).`,
          `${card.restaurant.name} 更安静，但整体评分低 ${scoreDiff} 分。`
        )
      );
    } else if (card.restaurant.rating > primaryCard.restaurant.rating) {
      parts.push(
        pickLanguageCopy(
          language,
          `${card.restaurant.name} has stronger public ratings but a lower composite score (−${scoreDiff}).`,
          `${card.restaurant.name} 大众评分更高，但综合评分低 ${scoreDiff} 分。`
        )
      );
    } else {
      parts.push(
        pickLanguageCopy(
          language,
          `${card.restaurant.name} is the next-best alternative (−${scoreDiff}).`,
          `${card.restaurant.name} 是次优备选（评分低 ${scoreDiff} 分）。`
        )
      );
    }
  });

  return parts.join(" ");
}

function buildWeekendTripTradeoffSummary(
  packages: Array<{ label: string; total: number; flightLabel: string; hotelLabel: string }>,
  language: OutputLanguage
): string {
  if (packages.length < 2) return "";
  const primary = packages[0];
  const backups = packages.slice(1);
  const primaryStr = pickLanguageCopy(
    language,
    `${primary.label} is the default: ${primary.flightLabel} + ${primary.hotelLabel} (~$${Math.round(primary.total)}).`,
    `${primary.label} 是默认方案：${primary.flightLabel} + ${primary.hotelLabel}（约 $${Math.round(primary.total)}）。`
  );
  const backupStrs = backups.map((b) => {
    const diff = b.total - primary.total;
    const sign = diff >= 0 ? "+" : "−";
    const absDiff = Math.abs(Math.round(diff));
    return pickLanguageCopy(
      language,
      `${b.label} costs ${sign}$${absDiff} vs. the default (${b.flightLabel} + ${b.hotelLabel}).`,
      `${b.label} 比默认方案 ${sign}$${absDiff}（${b.flightLabel} + ${b.hotelLabel}）。`
    );
  });
  return [primaryStr, ...backupStrs].join(" ");
}

function buildDateNightGoal(
  intent: RestaurantIntent,
  stage: DateNightStage
): string {
  const budget =
    intent.budget_total != null
      ? `around $${intent.budget_total} total`
      : intent.budget_per_person != null
      ? `around $${intent.budget_per_person}/person`
      : "within a comfortable dinner budget";
  const location =
    intent.neighborhood ?? intent.near_location ?? intent.location ?? "the right area";
  const stageLabel =
    stage === "first_date"
      ? "for a first date"
      : stage === "anniversary"
      ? "for an anniversary dinner"
      : "for a date night";
  return `Find a dinner plan ${stageLabel} in ${location} ${budget}, with enough confidence that the user can approve a single option quickly.`;
}

function buildDateNightBrief(
  intent: DateNightIntent,
  primaryCard: RecommendationCard,
  cityLabel: string,
  language: OutputLanguage
): string[] {
  const partySize = intent.party_size ?? 2;
  const brief: string[] = [
    pickLanguageCopy(
      language,
      `${formatStageLabel(intent.stage, "en")} strategy with ${partySize} seat${partySize === 1 ? "" : "s"} in mind.`,
      `这套${formatStageLabel(intent.stage, "zh")}按 ${partySize} 个座位来安排。`
    ),
  ];

  if (intent.budget_total != null) {
    brief.push(
      pickLanguageCopy(
        language,
        `Budget target: about $${intent.budget_total} total.`,
        `预算目标：总共约 $${intent.budget_total}。`
      )
    );
  } else if (intent.budget_per_person != null) {
    brief.push(
      pickLanguageCopy(
        language,
        `Budget target: about $${intent.budget_per_person} per person.`,
        `预算目标：人均约 $${intent.budget_per_person}。`
      )
    );
  }

  if (intent.noise_level && intent.noise_level !== "any") {
    brief.push(
      pickLanguageCopy(
        language,
        `Noise target: ${intent.noise_level}.`,
        `环境目标：${intent.noise_level}。`
      )
    );
  }

  brief.push(
    pickLanguageCopy(
      language,
      `Main option tuned around ${primaryCard.restaurant.name} in ${primaryCard.restaurant.address || cityLabel}.`,
      `主方案围绕 ${primaryCard.restaurant.name} 来设计，地点在 ${primaryCard.restaurant.address || cityLabel}。`
    )
  );

  if (intent.follow_up_preference !== "none") {
    brief.push(
      intent.follow_up_preference === "open"
        ? pickLanguageCopy(
            language,
            "Kept enough room in the plan for a possible second stop after dinner.",
            "晚餐后还预留了继续去第二站的空间。"
          )
        : pickLanguageCopy(
            language,
            `Optimized for a ${intent.follow_up_preference} follow-up after dinner.`,
            `已经按晚餐后的${formatFollowUpLabel(intent.follow_up_preference, language)}做了预留。`
          )
    );
  }

  return brief.slice(0, 4);
}

function buildDateNightActions(
  refinements: string[],
  language: OutputLanguage,
  primaryOption?: PlanOption
): PlanAction[] {
  const openLinkActions = mapLinksToOpenLinkActions(primaryOption?.secondary_actions ?? []);

  const actions: PlanAction[] = [
    ...openLinkActions,
    {
      id: "share-plan",
      type: "share_plan",
      label: pickLanguageCopy(language, "Share plan", "分享方案"),
      description: pickLanguageCopy(
        language,
        "Copy a shareable link for this decision package.",
        "复制这套方案的分享链接。"
      ),
    },
    {
      id: "send-for-vote",
      type: "send_for_vote",
      label: pickLanguageCopy(language, "Send to friends", "发给朋友投票"),
      description: pickLanguageCopy(
        language,
        "Let your group vote on the options.",
        "让朋友们投票选出最喜欢的方案。"
      ),
    },
    {
      id: "request-changes",
      type: "request_changes",
      label: pickLanguageCopy(language, "Needs tweaks", "需要调整"),
      description: pickLanguageCopy(
        language,
        "Record that this plan was close but not final.",
        "记录这个方案已经接近了，但还不是最终版。"
      ),
    },
  ];

  refinements.slice(0, 2).forEach((prompt, index) => {
    actions.push({
      id: `refine-${index}`,
      type: "refine",
      label: prompt,
      description: pickLanguageCopy(
        language,
        "Ask Onegent to rerun the plan with this refinement.",
        "让 Onegent 按这个方向重新跑一版。"
      ),
      prompt,
    });
  });

  return actions;
}

function buildDateNightOption(
  card: RecommendationCard,
  intent: DateNightIntent,
  fallbackReason: string | undefined,
  label: string,
  userMessage: string,
  language: OutputLanguage
): PlanOption {
  const timingNote = buildDateNightTimingNote(intent, card, language);
  const primaryAction: PlanLinkAction | undefined = card.opentable_url
    ? { id: "reserve", label: pickLanguageCopy(language, "Reserve", "预订"), url: card.opentable_url }
    : card.restaurant.url
    ? { id: "open-site", label: pickLanguageCopy(language, "Open restaurant", "打开餐厅主页"), url: card.restaurant.url }
    : undefined;

  const secondaryActions: PlanLinkAction[] = [
    {
      id: "open-map",
      label: pickLanguageCopy(language, "Open map", "打开地图"),
      url: buildGoogleMapsUrl(card),
    },
  ];
  // When there's no direct OpenTable booking link, add a pre-filled availability search
  if (!card.opentable_url) {
    secondaryActions.push({
      id: "check-availability",
      label: pickLanguageCopy(language, "Check availability on OpenTable", "在OpenTable查询可用性"),
      url: buildOpenTableUrl({
        restaurantName: card.restaurant.name,
        covers: intent.party_size ?? 2,
      }),
    });
  }
  const calendarUrl = buildGoogleCalendarUrl(card, intent, timingNote, userMessage, language);
  if (calendarUrl) {
    secondaryActions.push({
      id: "add-calendar",
      label: pickLanguageCopy(language, "Add to calendar", "加入日历"),
      url: calendarUrl,
    });
  }

  return {
    id: card.restaurant.id,
    label,
    option_category: "restaurant",
    title: card.restaurant.name,
    subtitle: [
      card.restaurant.cuisine || pickLanguageCopy(language, "Restaurant", "餐厅"),
      card.restaurant.price || "",
      formatNoiseLabel(card.restaurant.review_signals?.noise_level, language),
    ]
      .filter(Boolean)
      .join(" | "),
    summary: card.why_recommended,
    why_this_now: buildDateNightWhyThisNow(card, intent, language),
    best_for: card.best_for || pickLanguageCopy(language, "Reliable date-night fit", "稳妥的约会选择"),
    estimated_total:
      card.estimated_total ||
      card.restaurant.price ||
      pickLanguageCopy(language, "See menu pricing", "以菜单价格为准"),
    timing_note: timingNote,
    risks: collectDateNightRisks(card, intent, language),
    tradeoffs: buildDateNightTradeoffs(card, intent, language),
    highlights: [
      pickLanguageCopy(
        language,
        `Best for: ${card.best_for || "date-night reliability"}.`,
        `最适合：${card.best_for || "稳妥的约会场景"}。`
      ),
      pickLanguageCopy(language, `Timing: ${timingNote}`, `时间建议：${timingNote}`),
      card.watch_out ? pickLanguageCopy(language, `Watch-out: ${card.watch_out}`, `注意：${card.watch_out}`) : "",
    ].filter(Boolean),
    primary_action: primaryAction,
    secondary_actions: secondaryActions,
    evidence_card_id: card.restaurant.id,
    score: card.score,
    fallback_reason: fallbackReason,
  };
}

function buildWeekendTripActions(
  intent: WeekendTripIntent,
  language: OutputLanguage,
  primaryOption?: PlanOption
): PlanAction[] {
  const budgetTarget = intent.budget_total
    ? `$${intent.budget_total}`
    : pickLanguageCopy(language, "the current package", "当前方案");

  const openLinkActions = mapLinksToOpenLinkActions(primaryOption?.secondary_actions ?? []);

  return [
    ...openLinkActions,
    {
      id: "export-brief",
      type: "export_brief",
      label: pickLanguageCopy(language, "Export trip brief", "导出行程摘要"),
      description: pickLanguageCopy(language, "Download a markdown summary of this trip package.", "下载这套旅行方案的 Markdown 摘要。"),
    },
    {
      id: "share-plan",
      type: "share_plan",
      label: pickLanguageCopy(language, "Share trip brief", "分享行程摘要"),
      description: pickLanguageCopy(language, "Copy a shareable link for this trip package.", "复制这套旅行方案的分享链接。"),
    },
    {
      id: "send-for-vote",
      type: "send_for_vote",
      label: pickLanguageCopy(language, "Send to friends", "发给朋友投票"),
      description: pickLanguageCopy(language, "Let your group vote on the trip options.", "让朋友们投票选出最喜欢的方案。"),
    },
    {
      id: "watch-price",
      type: "watch_price",
      label: pickLanguageCopy(language, "Watch prices", "价格提醒"),
      description: pickLanguageCopy(language, "Get notified if hotel or flight prices drop.", "当酒店或机票价格下降时提醒我。"),
    },
    {
      id: "refine-cheaper",
      type: "refine",
      label: pickLanguageCopy(language, "Make it cheaper", "再便宜一点"),
      description: pickLanguageCopy(language, "Rerun the trip with a lower-cost target.", "按更低的预算目标重新生成一版。"),
      prompt: pickLanguageCopy(language, `Make this weekend trip cheaper than ${budgetTarget} while keeping it smooth.`, `在尽量保持顺滑体验的前提下，把这次周末旅行做得比 ${budgetTarget} 更便宜。`),
    },
    {
      id: "refine-smoother",
      type: "refine",
      label: pickLanguageCopy(language, "Make it smoother", "更省心一点"),
      description: pickLanguageCopy(language, "Prefer easier timing and fewer friction points.", "优先更顺的时间衔接和更少的折腾。"),
      prompt: pickLanguageCopy(language, "Keep the same destination, but prioritize less travel friction and easier timing.", "目的地不变，但优先更少折腾、时间更顺的方案。"),
    },
    {
      id: "request-changes",
      type: "request_changes",
      label: pickLanguageCopy(language, "Needs tweaks", "需要调整"),
      description: pickLanguageCopy(language, "Record that this package was close but not final.", "记录这套方案已经接近了，但还不是最终版。"),
    },
  ];
}

function buildWeekendTripOption(params: {
  id: string;
  label: string;
  scenarioIntent: WeekendTripIntent;
  flight: FlightRecommendationCard;
  hotel: HotelRecommendationCard;
  restaurant?: RecommendationCard;
  card?: CreditCardRecommendationCard;
  fallbackReason?: string;
  outputLanguage: OutputLanguage;
}): PlanOption {
  const total = estimateTripTotal(params.flight, params.hotel);
  const destination =
    params.scenarioIntent.destination_city ??
    params.flight.flight.arrival_city ??
    params.hotel.hotel.name;
  const timingNote = buildWeekendTripTimingNote(params.flight, params.hotel, params.outputLanguage);
  const stopLabel =
    params.flight.flight.stops === 0
      ? pickLanguageCopy(params.outputLanguage, "nonstop", "直飞")
      : pickLanguageCopy(
          params.outputLanguage,
          `${params.flight.flight.stops} stop${params.flight.flight.stops > 1 ? "s" : ""}`,
          `${params.flight.flight.stops} 次中转`
        );
  const cardLine = params.card
    ? pickLanguageCopy(
        params.outputLanguage,
        `${params.card.card.name} is the cleanest card fit if you want to book this trip with one new rewards card.`,
        `如果你想用一张新的奖励卡来订这趟旅行，${params.card.card.name} 是最顺手的选择。`
      )
    : pickLanguageCopy(
        params.outputLanguage,
        "No clear card edge surfaced for this package.",
        "这套方案目前没有特别明显的用卡优势。"
      );

  // 3b-1: Pre-filled booking URLs — land on filtered results, not homepages.
  const hotelBookingUrl = (() => {
    const intent = params.scenarioIntent;
    if (intent.destination_city && intent.start_date) {
      return buildBookingComUrl({
        city: intent.destination_city,
        checkin: intent.start_date,
        checkout: intent.end_date,
        adults: intent.travelers,
      });
    }
    return params.hotel.hotel.booking_link;
  })();

  const flightBookingUrl = (() => {
    const intent = params.scenarioIntent;
    const flight = params.flight.flight;
    // Prefer IATA codes from the actual flight result — they land more reliably
    // in Kayak's path-style URL than city names. Fall back to city names if IATA unavailable.
    const origin =
      flight.departure_airport?.match(/^[A-Z]{3}$/)
        ? flight.departure_airport
        : (intent.departure_city ?? flight.departure_airport ?? flight.departure_city);
    const dest =
      flight.arrival_airport?.match(/^[A-Z]{3}$/)
        ? flight.arrival_airport
        : (intent.destination_city ?? flight.arrival_airport ?? flight.arrival_city);
    if (origin && dest) {
      const sharedOpts = {
        origin,
        dest,
        date: intent.start_date,
        returnDate: flight.is_round_trip !== false ? intent.end_date : undefined,
        passengers: intent.travelers,
        cabinClass: intent.cabin_class as GoogleFlightsOpts["cabinClass"],
      };
      return buildKayakFlightsUrl(sharedOpts);
    }
    return flight.booking_link;
  })();

  const secondaryActions: PlanLinkAction[] = [
    {
      id: "open-flight",
      label: pickLanguageCopy(params.outputLanguage, "Open flight", "查看航班"),
      url: flightBookingUrl,
    },
  ];
  const calendarUrl = buildWeekendTripCalendarUrl(
    params.scenarioIntent,
    params.flight,
    params.hotel,
    params.outputLanguage
  );
  if (calendarUrl) {
    secondaryActions.push({
      id: "add-calendar",
      label: pickLanguageCopy(params.outputLanguage, "Add trip to calendar", "加入日历"),
      url: calendarUrl,
    });
  }

  return {
    id: params.id,
    label: params.label,
    option_category: "trip",
    title: pickLanguageCopy(
      params.outputLanguage,
      `Fly to ${destination} + stay at ${params.hotel.hotel.name}`,
      `飞到 ${destination}，住在 ${params.hotel.hotel.name}`
    ),
    subtitle: [
      `${params.flight.flight.airline} ${params.flight.flight.departure_time}-${params.flight.flight.arrival_time}`,
      params.hotel.hotel.star_rating
        ? pickLanguageCopy(
            params.outputLanguage,
            `${params.hotel.hotel.star_rating} star`,
            `${params.hotel.hotel.star_rating} 星`
          )
        : "",
      params.hotel.hotel.neighborhood || params.hotel.hotel.address,
    ]
      .filter(Boolean)
      .join(" | "),
    summary: buildWeekendTripSummary(
      params.scenarioIntent,
      params.flight,
      params.hotel,
      params.outputLanguage
    ),
    why_this_now: pickLanguageCopy(
      params.outputLanguage,
      `This package balances ${params.flight.why_recommended.toLowerCase()} with a hotel that scores well for ${params.hotel.best_for.toLowerCase()}.`,
      `这套方案把“${params.flight.why_recommended}”和“${params.hotel.best_for}”这两个优点组合到了一起。`
    ),
    best_for: describeWeekendTripAudience(
      params.scenarioIntent,
      params.id,
      params.outputLanguage
    ),
    estimated_total: `$${Math.round(total)}`,
    timing_note: timingNote,
    risks: buildWeekendTripRisks(params.flight, params.hotel, params.outputLanguage),
    tradeoffs: buildWeekendTripTradeoffs(
      params.flight,
      params.hotel,
      params.outputLanguage,
      params.card
    ),
    highlights: [
      pickLanguageCopy(
        params.outputLanguage,
        `${params.flight.flight.airline} ${params.flight.flight.departure_airport} -> ${params.flight.flight.arrival_airport}, ${params.flight.flight.duration}, ${stopLabel}.`,
        `${params.flight.flight.airline}：${params.flight.flight.departure_airport} -> ${params.flight.flight.arrival_airport}，飞行时长 ${params.flight.flight.duration}，${stopLabel}。`
      ),
      pickLanguageCopy(
        params.outputLanguage,
        `${params.hotel.hotel.name}: ${params.hotel.price_summary || `$${params.hotel.hotel.price_per_night}/night`} near ${params.hotel.location_summary}.`,
        `${params.hotel.hotel.name}：${params.hotel.price_summary || `$${params.hotel.hotel.price_per_night}/晚`}，靠近 ${params.hotel.location_summary}。`
      ),
      ...(params.restaurant
        ? [
            pickLanguageCopy(
              params.outputLanguage,
              `${params.restaurant.restaurant!.name} • ${params.restaurant.restaurant!.cuisine} • ${params.restaurant.restaurant!.price ?? "$$"} — ${params.restaurant.why_recommended}.`,
              `${params.restaurant.restaurant!.name} · ${params.restaurant.restaurant!.cuisine} · ${params.restaurant.restaurant!.price ?? "$$"} — ${params.restaurant.why_recommended}。`
            ),
          ]
        : []),
      cardLine,
    ],
    primary_action: {
      id: "open-hotel",
      label: pickLanguageCopy(params.outputLanguage, "Open hotel", "查看酒店"),
      url: hotelBookingUrl,
    },
    secondary_actions: secondaryActions,
    evidence_card_id: params.flight.flight.id,
    score: computeWeekendTripScore(params.flight, params.hotel, total),
    fallback_reason: params.fallbackReason,
  };
}

function chooseWeekendTripPriority(
  intent: WeekendTripIntent
): Array<"stable" | "value" | "experience"> {
  if (intent.trip_pace === "easy") return ["stable", "value", "experience"];
  if (intent.hotel_style === "luxury" || intent.hotel_style === "boutique") {
    return ["experience", "stable", "value"];
  }
  if ((intent.budget_total ?? 0) > 0 && (intent.budget_total ?? 0) < 750) {
    return ["value", "stable", "experience"];
  }
  return ["stable", "experience", "value"];
}

function buildWeekendTripBrief(
  intent: WeekendTripIntent,
  primary: PlanOption,
  language: OutputLanguage
): string[] {
  const brief: string[] = [
    pickLanguageCopy(
      language,
      `${intent.travelers ?? 1} traveler${intent.travelers === 1 ? "" : "s"} heading to ${intent.destination_city ?? "the destination"} for ${intent.nights ?? 2} night${intent.nights === 1 ? "" : "s"}.`,
      `${intent.travelers ?? 1} 位旅客，去 ${intent.destination_city ?? "目的地"} 玩 ${intent.nights ?? 2} 晚。`
    ),
  ];
  if (intent.budget_total) {
    brief.push(
      pickLanguageCopy(
        language,
        `Budget target: around $${intent.budget_total} total.`,
        `预算目标：总共约 $${intent.budget_total}。`
      )
    );
  }
  brief.push(
    pickLanguageCopy(
      language,
      `Trip pace: ${intent.trip_pace}.`,
      `旅行节奏：${intent.trip_pace}。`
    )
  );
  if (intent.planning_assumptions.length > 0) {
    brief.push(
      pickLanguageCopy(
        language,
        `Planning assumption: ${intent.planning_assumptions[0]}`,
        `当前假设：${intent.planning_assumptions[0]}`
      )
    );
  }
  brief.push(
    pickLanguageCopy(
      language,
      `Main package total: ${primary.estimated_total}.`,
      `主方案总价：${primary.estimated_total}。`
    )
  );
  return brief.slice(0, 4);
}

function buildDateNightWhyThisNow(
  card: RecommendationCard,
  intent: DateNightIntent,
  language: OutputLanguage
): string {
  const quietNote =
    intent.wants_quiet_buffer && card.restaurant.review_signals?.noise_level === "quiet"
      ? pickLanguageCopy(language, "It keeps the conversation easy.", "它能让聊天更轻松。")
      : "";
  const paceNote = card.restaurant.review_signals?.service_pace
    ? pickLanguageCopy(
        language,
        `Service pace looks ${card.restaurant.review_signals.service_pace}.`,
        `服务节奏看起来是 ${card.restaurant.review_signals.service_pace}。`
      )
    : "";

  return [
    card.best_for || pickLanguageCopy(language, "Date-night fit.", "适合约会场景。"),
    quietNote,
    paceNote,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildDateNightTradeoffs(
  card: RecommendationCard,
  intent: DateNightIntent,
  language: OutputLanguage
): string[] {
  const tradeoffs = new Set<string>();
  if (card.watch_out) tradeoffs.add(card.watch_out);
  if (card.not_great_if) tradeoffs.add(card.not_great_if);
  if (card.restaurant.price === "$$$$") {
    tradeoffs.add(
      pickLanguageCopy(
        language,
        "This is the pricier option in the shortlist.",
        "这是候选里偏贵的一个。"
      )
    );
  }
  if (
    intent.wants_quiet_buffer &&
    card.restaurant.review_signals?.noise_level === "moderate"
  ) {
    tradeoffs.add(
      pickLanguageCopy(
        language,
        "It will work, but it is not the calmest room in the set.",
        "它可以用，但不是这组里最安静的。"
      )
    );
  }
  return Array.from(tradeoffs).slice(0, 3);
}

function collectDateNightRisks(
  card: RecommendationCard,
  intent: DateNightIntent,
  language: OutputLanguage
): string[] {
  const risks = new Set<string>();
  if (card.watch_out) risks.add(card.watch_out);
  card.restaurant.review_signals?.red_flags?.forEach((flag) => risks.add(flag));

  const waitTime = card.restaurant.review_signals?.wait_time;
  if (waitTime && !/no wait/i.test(waitTime)) {
    risks.add(
      pickLanguageCopy(
        language,
        `Potential wait risk: ${waitTime}.`,
        `排队风险：${waitTime}。`
      )
    );
  }
  if (
    intent.wants_quiet_buffer &&
    card.restaurant.review_signals?.noise_level === "moderate"
  ) {
    risks.add(
      pickLanguageCopy(
        language,
        "Noise may climb later in the evening, so earlier seating is safer.",
        "越晚越有可能变吵，所以更早一点入座会更稳。"
      )
    );
  }
  if (risks.size === 0) {
    risks.add(
      pickLanguageCopy(
        language,
        "Prime dinner hours can still tighten availability quickly.",
        "黄金晚餐时段的可订性还是会收紧得很快。"
      )
    );
  }
  return Array.from(risks).slice(0, 3);
}

function describeDateNightFallback(
  card: RecommendationCard,
  primaryCard: RecommendationCard,
  index: number,
  language: OutputLanguage
): string {
  const cardPriceRank = normalizePrice(card.restaurant.price);
  const primaryPriceRank = normalizePrice(primaryCard.restaurant.price);
  if (cardPriceRank < primaryPriceRank) {
    return pickLanguageCopy(
      language,
      "Use this if you want to lower the spend without restarting the search.",
      "如果你想把花费压下来，又不想重开搜索，就选这个。"
    );
  }
  if (
    card.restaurant.review_signals?.noise_level === "quiet" &&
    primaryCard.restaurant.review_signals?.noise_level !== "quiet"
  ) {
    return pickLanguageCopy(
      language,
      "Use this if a quieter room matters more than the default choice.",
      "如果你比起默认方案更在意安静氛围，就选这个。"
    );
  }
  if (card.restaurant.rating > primaryCard.restaurant.rating) {
    return pickLanguageCopy(
      language,
      "Use this if you want the stronger consensus option.",
      "如果你更想要大众评价更稳的选择，就选这个。"
    );
  }
  return pickLanguageCopy(
    language,
    `Use this as backup ${index + 1} if the main option is unavailable.`,
    `如果主方案没位子，就把它当备选 ${index + 1}。`
  );
}

function buildDateNightTimingNote(
  intent: DateNightIntent,
  card: RecommendationCard,
  language: OutputLanguage
): string {
  if (intent.time_hint && intent.detected_date_text) {
    return pickLanguageCopy(
      language,
      `${intent.detected_date_text} around ${intent.time_hint}.`,
      `${intent.detected_date_text}，大概 ${intent.time_hint} 左右。`
    );
  }
  if (intent.time_hint) {
    return pickLanguageCopy(language, `Aim for ${intent.time_hint}.`, `建议定在 ${intent.time_hint}。`);
  }
  if (
    intent.wants_quiet_buffer ||
    card.restaurant.review_signals?.noise_level === "quiet"
  ) {
    return pickLanguageCopy(
      language,
      "Aim for a 7:15-7:45 pm seating to keep the room calmer.",
      "建议安排在晚上 7:15-7:45 入座，整体会更安静。"
    );
  }
  if (card.restaurant.review_signals?.noise_level === "loud") {
    return pickLanguageCopy(
      language,
      "Earlier seating is safer here if conversation matters.",
      "如果你更在意聊天体验，这家更适合早点入座。"
    );
  }
  return pickLanguageCopy(
    language,
    "A 7:30-8:00 pm seating should balance energy and conversation.",
    "晚上 7:30-8:00 入座，一般能比较平衡氛围和聊天体验。"
  );
}

function buildGoogleMapsUrl(card: RecommendationCard): string {
  const query = `${card.restaurant.name} ${card.restaurant.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query.trim()
  )}`;
}

function buildGoogleCalendarUrl(
  card: RecommendationCard,
  intent: DateNightIntent,
  timingNote: string,
  userMessage: string,
  language: OutputLanguage
): string | undefined {
  const date = resolveDateContext(intent.detected_date_text);
  if (!date) return undefined;
  const { hours, minutes } = resolveTimeContext(intent.time_hint);
  const start = new Date(date);
  start.setHours(hours, minutes, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set(
    "text",
    pickLanguageCopy(language, `Date night at ${card.restaurant.name}`, `在 ${card.restaurant.name} 的约会`)
  );
  url.searchParams.set(
    "details",
    pickLanguageCopy(
      language,
      `${timingNote}\n\nWhy this plan: ${card.why_recommended}\n\nOriginal request: ${userMessage}`,
      `${timingNote}\n\n为什么推荐它：${card.why_recommended}\n\n原始需求：${userMessage}`
    )
  );
  url.searchParams.set("location", card.restaurant.address);
  url.searchParams.set("dates", `${formatGoogleDate(start)}/${formatGoogleDate(end)}`);
  url.searchParams.set("ctz", Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago");
  return url.toString();
}

function buildWeekendTripCalendarUrl(
  intent: WeekendTripIntent,
  flight: FlightRecommendationCard,
  hotel: HotelRecommendationCard,
  language: OutputLanguage
): string | undefined {
  if (!intent.start_date || !intent.end_date) return undefined;
  const start = new Date(`${intent.start_date}T09:00:00`);
  const end = new Date(`${intent.end_date}T18:00:00`);
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set(
    "text",
    pickLanguageCopy(
      language,
      `Weekend trip to ${intent.destination_city ?? hotel.hotel.name}`,
      `去 ${intent.destination_city ?? hotel.hotel.name} 的周末旅行`
    )
  );
  url.searchParams.set(
    "details",
    pickLanguageCopy(
      language,
      `Flight: ${flight.flight.airline} ${flight.flight.departure_airport} to ${flight.flight.arrival_airport}, ${flight.flight.duration}.\nHotel: ${hotel.hotel.name}.\n`,
      `航班：${flight.flight.airline}，${flight.flight.departure_airport} 到 ${flight.flight.arrival_airport}，飞行时长 ${flight.flight.duration}。\n酒店：${hotel.hotel.name}。\n`
    )
  );
  url.searchParams.set("location", hotel.hotel.address);
  url.searchParams.set("dates", `${formatGoogleDate(start)}/${formatGoogleDate(end)}`);
  url.searchParams.set("ctz", Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago");
  return url.toString();
}

function buildWeekendTripSummary(
  intent: WeekendTripIntent,
  flight: FlightRecommendationCard,
  hotel: HotelRecommendationCard,
  language: OutputLanguage
): string {
  const destination = intent.destination_city ?? hotel.hotel.name;
  return pickLanguageCopy(
    language,
    `This package gets you to ${destination} with ${flight.why_recommended.toLowerCase()} and pairs it with ${hotel.hotel.name}, which scored well for ${hotel.best_for.toLowerCase()}.`,
    `这套方案会把你带到 ${destination}，航班部分主打“${flight.why_recommended}”，酒店部分则是 ${hotel.hotel.name}，它在“${hotel.best_for}”这件事上表现不错。`
  );
}

function describeWeekendTripAudience(
  intent: WeekendTripIntent,
  optionId: string,
  language: OutputLanguage
): string {
  if (optionId === "stable") {
    return pickLanguageCopy(language, "Travelers who want the lowest odds of itinerary friction.", "适合想把行程出错概率压到最低的人。");
  }
  if (optionId === "value") {
    return pickLanguageCopy(language, "Travelers who want to protect budget without collapsing quality.", "适合想控制预算，但又不想明显牺牲质量的人。");
  }
  if (intent.hotel_style === "luxury" || intent.hotel_style === "boutique") {
    return pickLanguageCopy(language, "Travelers who care more about staying well than saving every dollar.", "适合更在意住得好，而不是把每一美元都省下来的旅客。");
  }
  return pickLanguageCopy(language, "Travelers who want the nicest-feeling weekend in the current budget range.", "适合想在当前预算里拿到最好整体体验的人。");
}

/** Standard hotel check-in time in minutes since midnight (15:00). */
const STANDARD_CHECKIN_MINUTES = 15 * 60;

/**
 * Parse "HH:MM" or "H:MM" to minutes since midnight.
 * Returns null if the format is unrecognisable.
 */
function parseTimeToMinutes(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function buildWeekendTripTimingNote(
  flight: FlightRecommendationCard,
  hotel: HotelRecommendationCard,
  language: OutputLanguage
): string {
  const hotelAnchor =
    hotel.hotel.price_per_night > 0
      ? pickLanguageCopy(language, `${hotel.hotel.name} is the lodging anchor.`, `${hotel.hotel.name} 会作为这次入住的核心落点。`)
      : pickLanguageCopy(language, "Hotel timing should still be verified before booking.", "酒店的入住时间仍然需要在预订前再确认一次。");

  const arrivalMinutes = parseTimeToMinutes(flight.flight.arrival_time);
  if (arrivalMinutes !== null) {
    const gapMinutes = STANDARD_CHECKIN_MINUTES - arrivalMinutes;
    if (arrivalMinutes >= 22 * 60) {
      // Late-night arrival
      return pickLanguageCopy(
        language,
        `${flight.flight.departure_time} outbound, ${flight.flight.arrival_time} arrival — late-night landing. Confirm late check-in with the hotel. ${hotelAnchor}`,
        `${flight.flight.departure_time} 出发、${flight.flight.arrival_time} 抵达 — 深夜到达，需提前和酒店确认深夜入住政策。${hotelAnchor}`
      );
    }
    if (gapMinutes > 0) {
      // Arriving before standard check-in
      const gapH = Math.round(gapMinutes / 60);
      const gapLabel = gapH >= 1
        ? pickLanguageCopy(language, `${gapH}h before check-in`, `比标准入住时间早 ${gapH} 小时`)
        : pickLanguageCopy(language, `${gapMinutes}min before check-in`, `比标准入住时间早 ${gapMinutes} 分钟`);
      return pickLanguageCopy(
        language,
        `${flight.flight.departure_time} outbound, ${flight.flight.arrival_time} arrival — ${gapLabel}. ${hotelAnchor}`,
        `${flight.flight.departure_time} 出发、${flight.flight.arrival_time} 抵达 — ${gapLabel}。${hotelAnchor}`
      );
    }
    // Arrival after check-in time — clean handoff
    return pickLanguageCopy(
      language,
      `${flight.flight.departure_time} outbound, ${flight.flight.arrival_time} arrival — after standard check-in, room should be ready on landing. ${hotelAnchor}`,
      `${flight.flight.departure_time} 出发、${flight.flight.arrival_time} 抵达 — 正好在标准入住时间之后，落地即可入住。${hotelAnchor}`
    );
  }

  // Fallback when arrival_time is unparseable
  return pickLanguageCopy(
    language,
    `${flight.flight.departure_time} outbound and ${flight.flight.arrival_time} arrival keep the handoff into hotel check-in relatively clean. ${hotelAnchor}`,
    `${flight.flight.departure_time} 出发、${flight.flight.arrival_time} 抵达，这样衔接酒店入住会比较顺。${hotelAnchor}`
  );
}

function buildWeekendTripRisks(
  flight: FlightRecommendationCard,
  hotel: HotelRecommendationCard,
  language: OutputLanguage
): string[] {
  const risks = new Set<string>();
  if (flight.flight.stops > 0) {
    risks.add(
      pickLanguageCopy(
        language,
        `${flight.flight.stops} stop${flight.flight.stops > 1 ? "s" : ""} adds delay risk.`,
        `${flight.flight.stops} 次中转会额外带来延误风险。`
      )
    );
  }

  // Check-in gap feasibility (3a-3)
  const arrivalMinutes = parseTimeToMinutes(flight.flight.arrival_time);
  if (arrivalMinutes !== null) {
    const gapMinutes = STANDARD_CHECKIN_MINUTES - arrivalMinutes;
    if (arrivalMinutes >= 22 * 60) {
      risks.add(
        pickLanguageCopy(
          language,
          "Late-night arrival — confirm late check-in policy before booking.",
          "深夜抵达，预订前需确认酒店深夜入住政策。"
        )
      );
    } else if (gapMinutes > 3 * 60) {
      risks.add(
        pickLanguageCopy(
          language,
          "Early arrival — room won't be ready at landing. Use hotel luggage storage as the bridge.",
          "抵达时间较早，房间不会立刻准备好，建议先寄存行李。"
        )
      );
    } else if (gapMinutes > 0 && gapMinutes < 2 * 60) {
      risks.add(
        pickLanguageCopy(
          language,
          "Tight check-in window — room may not be ready right at arrival. Request early check-in in advance.",
          "入住窗口偏紧，建议提前申请早入住。"
        )
      );
    }
  }

  if (hotel.watch_out) risks.add(hotel.watch_out);
  if (hotel.not_great_if) risks.add(hotel.not_great_if);
  if (flight.group === "cheapest") {
    risks.add(
      pickLanguageCopy(language, "Lowest fare options can degrade fastest if inventory shifts.", "最低价票如果库存波动，最容易先失效。")
    );
  }
  if (risks.size === 0) {
    risks.add(
      pickLanguageCopy(language, "Pricing and inventory can move quickly once you start booking.", "一旦开始预订，价格和库存都有可能很快变化。")
    );
  }
  return Array.from(risks).slice(0, 3);
}

function buildWeekendTripTradeoffs(
  flight: FlightRecommendationCard,
  hotel: HotelRecommendationCard,
  language: OutputLanguage,
  card?: CreditCardRecommendationCard
): string[] {
  const tradeoffs = new Set<string>();
  if (flight.group !== "direct") {
    tradeoffs.add(
      pickLanguageCopy(language, "You save money or expand options, but not with the simplest routing.", "它能帮你省钱或拓宽选择，但路线不是最省心的。")
    );
  }
  if (hotel.hotel.star_rating >= 4.5 && hotel.hotel.price_per_night > 0) {
    tradeoffs.add(
      pickLanguageCopy(language, "The hotel quality is strong, but it does more of the budget work.", "酒店质量很强，但也会吃掉更大一部分预算。")
    );
  }
  if (card && card.card.annual_fee > 0) {
    tradeoffs.add(
      pickLanguageCopy(language, `${card.card.name} has a $${card.card.annual_fee} annual fee, so it only makes sense if you will use it beyond this trip.`, `${card.card.name} 有 $${card.card.annual_fee} 年费，所以只有在你打算把它用到这次旅行之后时才更划算。`)
    );
  }
  if (tradeoffs.size === 0) {
    tradeoffs.add(
      pickLanguageCopy(language, "This is the balanced package, not the absolute cheapest or fanciest.", "这是一个偏均衡的方案，不是最便宜也不是最豪华。")
    );
  }
  return Array.from(tradeoffs).slice(0, 3);
}

function estimateTripTotal(
  flight: FlightRecommendationCard,
  hotel: HotelRecommendationCard
): number {
  return (flight.flight.price || 0) + (hotel.hotel.total_price || 0);
}

function computeWeekendTripScore(
  flight: FlightRecommendationCard,
  hotel: HotelRecommendationCard,
  total: number
): number {
  const flightScoreBase =
    flight.group === "direct" ? 9 : flight.group === "one_stop" ? 7.5 : flight.group === "cheapest" ? 7 : 6.5;
  const hotelScoreBase = hotel.score || Math.min(10, hotel.hotel.rating);
  const pricePenalty = total > 1200 ? 0.8 : total > 900 ? 0.4 : 0;
  return Math.round((flightScoreBase * 0.4 + hotelScoreBase * 0.6 - pricePenalty) * 10) / 10;
}

function pickStableFlight(flights: FlightRecommendationCard[]): FlightRecommendationCard {
  return flights.find((flight) => flight.group === "direct") ?? flights.find((flight) => flight.group === "one_stop") ?? flights[0];
}

function pickValueFlight(
  flights: FlightRecommendationCard[],
  avoidId?: string
): FlightRecommendationCard {
  const sorted = [...flights].sort((a, b) => a.flight.price - b.flight.price);
  return sorted.find((flight) => flight.flight.id !== avoidId) ?? sorted[0];
}

function pickExperienceFlight(
  flights: FlightRecommendationCard[],
  avoidIds: Set<string>
): FlightRecommendationCard {
  const direct = flights.filter((flight) => flight.group === "direct");
  return direct.find((flight) => !avoidIds.has(flight.flight.id)) ?? flights.find((flight) => !avoidIds.has(flight.flight.id)) ?? flights[0];
}

function pickStableHotel(hotels: HotelRecommendationCard[]): HotelRecommendationCard {
  return hotels[0];
}

function pickValueHotel(
  hotels: HotelRecommendationCard[],
  avoidId?: string
): HotelRecommendationCard {
  const sorted = [...hotels].sort((a, b) => a.hotel.total_price - b.hotel.total_price);
  return sorted.find((hotel) => hotel.hotel.id !== avoidId) ?? sorted[0];
}

function pickExperienceHotel(
  hotels: HotelRecommendationCard[],
  avoidIds: Set<string>
): HotelRecommendationCard {
  const sorted = [...hotels].sort(
    (a, b) => (b.hotel.rating || b.score) - (a.hotel.rating || a.score) || b.score - a.score
  );
  return sorted.find((hotel) => !avoidIds.has(hotel.hotel.id)) ?? sorted[0];
}

function pickCardForSpend(
  cards: CreditCardRecommendationCard[],
  totalSpend: number
): CreditCardRecommendationCard | undefined {
  const sorted = [...cards].sort((a, b) => {
    const aReach = totalSpend >= a.card.signup_bonus_spend_requirement ? 1 : 0;
    const bReach = totalSpend >= b.card.signup_bonus_spend_requirement ? 1 : 0;
    return bReach - aReach || b.marginal_value - a.marginal_value;
  });
  return sorted[0];
}

function inferDateNightStage(message: string): DateNightStage {
  const lower = message.toLowerCase();
  if (/first date/.test(lower) || /第一次约会|第一次见面/.test(message)) return "first_date";
  if (/anniversary|birthday dinner|proposal/.test(lower) || /纪念日|生日晚餐|表白/.test(message)) return "anniversary";
  if (/surprise/.test(lower) || /惊喜/.test(message)) return "surprise";
  if (/wife|husband|partner|boyfriend|girlfriend|fiance|fiancee/.test(lower) || /老婆|老公|对象|女朋友|男朋友/.test(message)) {
    return "steady_relationship";
  }
  if (/date|dating|romantic/.test(lower) || /约会|浪漫/.test(message)) return "casual_date";
  return "unknown";
}

function inferFollowUpPreference(message: string): DateNightFollowUp {
  const lower = message.toLowerCase();
  if (/dessert|ice cream/.test(lower) || /甜品|冰淇淋/.test(message)) return "dessert";
  if (/cocktail|bar|wine|drinks/.test(lower) || /酒吧|鸡尾酒|喝一杯/.test(message)) return "cocktail";
  if (/walk|stroll/.test(lower) || /散步/.test(message)) return "walk";
  if (/just dinner|only dinner/.test(lower) || /只吃饭|只吃晚饭/.test(message)) return "none";
  return "open";
}

function inferDecisionStyle(message: string): DateNightDecisionStyle {
  const lower = message.toLowerCase();
  if (/safe|steady|don't want to mess up|reliable/.test(lower) || /稳一点|稳妥|别出错|靠谱/.test(message)) return "safe";
  if (/impress|special|fancy|wow/.test(lower) || /高级|特别|惊艳|有氛围/.test(message)) return "impressive";
  if (/playful|fun|lively/.test(lower) || /好玩|活泼|热闹/.test(message)) return "playful";
  if (/relaxed|easy|casual/.test(lower) || /轻松|随意|不要太正式/.test(message)) return "relaxed";
  return "romantic";
}

function resolveDateContext(dateText?: string): Date | null {
  if (!dateText) return null;
  const lower = dateText.toLowerCase();
  const today = new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return new Date(`${lower}T00:00:00`);
  if (lower.includes("tomorrow")) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow;
  }
  if (lower.includes("tonight") || lower.includes("today")) return today;

  const weekday = Object.keys(WEEKDAY_INDEX).find((day) => lower.includes(day));
  if (!weekday) return null;
  return getNextWeekday(today, WEEKDAY_INDEX[weekday], lower.includes("next "));
}

function resolveTimeContext(timeHint?: string): { hours: number; minutes: number } {
  if (!timeHint) return { hours: 19, minutes: 30 };
  const normalized = timeHint.toLowerCase();
  const withMinutes = normalized.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (withMinutes) {
    return normalizeTime(Number(withMinutes[1]), Number(withMinutes[2]), withMinutes[3]);
  }
  const hourOnly = normalized.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (hourOnly) return normalizeTime(Number(hourOnly[1]), 0, hourOnly[2]);
  if (/early/.test(normalized)) return { hours: 19, minutes: 15 };
  if (/late/.test(normalized)) return { hours: 20, minutes: 15 };
  return { hours: 19, minutes: 30 };
}

function normalizeTime(
  hours: number,
  minutes: number,
  meridiem?: string
): { hours: number; minutes: number } {
  let normalizedHours = hours;
  if (meridiem === "pm" && normalizedHours < 12) normalizedHours += 12;
  if (meridiem === "am" && normalizedHours === 12) normalizedHours = 0;
  return { hours: normalizedHours, minutes };
}

function getNextWeekday(
  from: Date,
  weekday: number,
  forceNextWeek: boolean
): Date {
  const next = new Date(from);
  const diff = (weekday - from.getDay() + 7) % 7 || 7;
  next.setDate(from.getDate() + (forceNextWeek ? diff + 7 : diff));
  return next;
}

function inferTimeHint(message: string): string | undefined {
  const lower = message.toLowerCase();
  const withMinutes = lower.match(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/);
  if (withMinutes) return withMinutes[0];
  const hourOnly = lower.match(/\b\d{1,2}\s*(am|pm)\b/);
  if (hourOnly) return hourOnly[0];
  if (/early dinner/.test(lower)) return "7:00 pm";
  if (/late dinner/.test(lower)) return "8:30 pm";
  if (/dinner/.test(lower) || EVENING_ZH_REGEX.test(message)) return "7:30 pm";
  if (NOON_ZH_REGEX.test(message)) return "12:30 pm";
  if (MORNING_ZH_REGEX.test(message)) return "9:00 am";
  return undefined;
}

function inferDateText(message: string): string | undefined {
  const lower = message.toLowerCase();
  const isoDate = lower.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) return isoDate[0];
  if (lower.includes("tonight") || /今晚/.test(message)) return "tonight";
  if (lower.includes("tomorrow") || /明天/.test(message)) return "tomorrow";
  if (lower.includes("today") || /今天/.test(message)) return "today";

  const weekday = Object.keys(WEEKDAY_INDEX).find((day) => lower.includes(day));
  if (weekday) {
    if (lower.includes(`next ${weekday}`)) return `next ${weekday}`;
    if (lower.includes(`this ${weekday}`)) return `this ${weekday}`;
    return weekday;
  }

  const chineseWeekday = CHINESE_WEEKDAY_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => message.includes(alias))
  );
  if (!chineseWeekday) return undefined;
  const alias = chineseWeekday.aliases.find((item) => message.includes(item));
  if (!alias) return chineseWeekday.english;
  const suffix = alias.slice(-1);
  if (
    message.includes(`下${alias}`) ||
    message.includes(`下周${suffix}`) ||
    message.includes(`下星期${suffix}`) ||
    message.includes(`下礼拜${suffix}`)
  ) {
    return `next ${chineseWeekday.english}`;
  }
  return chineseWeekday.english;
}

function formatStageLabel(
  stage: DateNightStage,
  language: OutputLanguage
): string {
  if (language === "zh") {
    switch (stage) {
      case "first_date":
        return "首次约会";
      case "anniversary":
        return "纪念日晚餐";
      case "steady_relationship":
        return "稳定关系约会";
      case "surprise":
        return "惊喜约会";
      default:
        return "约会夜";
    }
  }
  switch (stage) {
    case "first_date":
      return "First-date";
    case "anniversary":
      return "Anniversary";
    case "steady_relationship":
      return "Steady-date";
    case "surprise":
      return "Surprise-date";
    default:
      return "Date-night";
  }
}

function formatFollowUpLabel(
  followUp: DateNightFollowUp,
  language: OutputLanguage
): string {
  if (language === "zh") {
    switch (followUp) {
      case "dessert":
        return "甜品第二站";
      case "cocktail":
        return "酒吧续摊";
      case "walk":
        return "散步";
      case "none":
        return "只吃晚餐";
      default:
        return "后续安排";
    }
  }
  switch (followUp) {
    case "dessert":
      return "dessert stop";
    case "cocktail":
      return "cocktail stop";
    case "walk":
      return "walk";
    case "none":
      return "dinner only";
    default:
      return "open follow-up";
  }
}

function formatNoiseLabel(
  noiseLevel: string | undefined,
  language: OutputLanguage
): string {
  if (!noiseLevel || noiseLevel === "unknown") return "";
  if (language === "zh") {
    if (noiseLevel === "quiet") return "安静";
    if (noiseLevel === "moderate") return "中等热闹";
    if (noiseLevel === "loud") return "偏吵";
  }
  return `${noiseLevel} room`;
}

function formatGoogleDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function normalizePrice(price?: string): number {
  return price?.length ?? 0;
}

function inferConfidence(
  score: number,
  backupCount: number
): "high" | "medium" | "low" {
  if (score >= 8.5 && backupCount >= 1) return "high";
  if (score >= 7) return "medium";
  return "low";
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function runCityTripPlanner(params: {
  scenarioIntent: CityTripIntent;
  hotelRecommendations: HotelRecommendationCard[];
  restaurantRecommendations: RecommendationCard[];
  barRecommendations: RecommendationCard[];
  outputLanguage: OutputLanguage;
}): DecisionPlan | null {
  const { scenarioIntent: intent, hotelRecommendations, restaurantRecommendations, barRecommendations, outputLanguage: lang } = params;

  const moduleResults: ModuleResults = {
    hotels: hotelRecommendations,
    flights: [],
    restaurants: restaurantRecommendations,
    bars: barRecommendations,
    creditCards: [],
  };

  const config = buildCityTripEngineConfig(intent, lang);

  return runModularPlanner({ results: moduleResults, config, outputLanguage: lang });
}

/**
 * Returns per-venue score adjustments derived from historical outcomes.
 *
 * STUB: always returns {} until ENABLE_SCORE_ADJUSTMENTS env var is set.
 * Enable after ≥30 days AND ≥100 rows in plan_outcomes — see TODOS.md for
 * the learning loop activation task.
 *
 *   venue_id → adjustment (positive boosts, negative penalizes)
 *   e.g. { "place_abc123": 0.8, "place_xyz": -0.3 }
 */
export async function getScoreAdjustments(
  scenario: ScenarioType,
  _city: string
): Promise<Record<string, number>> {
  if (!process.env.ENABLE_SCORE_ADJUSTMENTS) return {};

  try {
    // For each outcome, find the matching PlanOption in the plan_json (primary or backup)
    // and extract its evidence_card_id — the stable external venue ID (hotel.id, restaurant.id, etc).
    // Score each outcome with a signed weight, decayed by recency (30-day half-life).
    // Venues with ≥3 outcomes get an adjustment in [-1, 1]:
    //   +1 = all positive, -1 = all negative, 0 = balanced.
    const rows = await sql<{ venue_id: string; adjustment: number }>`
      WITH option_venues AS (
        SELECT
          po.outcome_type,
          po.created_at,
          CASE
            WHEN dp.plan_json->'primary_plan'->>'id' = po.option_id
              THEN dp.plan_json->'primary_plan'->>'evidence_card_id'
            ELSE (
              SELECT bu->>'evidence_card_id'
              FROM jsonb_array_elements(dp.plan_json->'backup_plans') AS bu
              WHERE bu->>'id' = po.option_id
              LIMIT 1
            )
          END AS venue_id
        FROM plan_outcomes po
        JOIN decision_plans dp ON dp.id = po.plan_id
        WHERE dp.scenario = ${scenario}
          AND po.option_id IS NOT NULL
          AND po.outcome_type IN ('went', 'partner_approved', 'rated_positive', 'skipped', 'rated_negative')
      ),
      venue_stats AS (
        SELECT
          venue_id,
          SUM(
            CASE WHEN outcome_type IN ('went', 'partner_approved', 'rated_positive') THEN 1.0 ELSE 0.0 END
            * EXP(-EXTRACT(EPOCH FROM NOW() - created_at) / (30.0 * 86400))
          ) AS weighted_pos,
          SUM(
            CASE WHEN outcome_type IN ('skipped', 'rated_negative') THEN 1.0 ELSE 0.0 END
            * EXP(-EXTRACT(EPOCH FROM NOW() - created_at) / (30.0 * 86400))
          ) AS weighted_neg,
          COUNT(*) AS total
        FROM option_venues
        WHERE venue_id IS NOT NULL
        GROUP BY venue_id
        HAVING COUNT(*) >= 3
      )
      SELECT
        venue_id,
        CASE
          WHEN weighted_pos + weighted_neg = 0 THEN 0.0
          ELSE (weighted_pos - weighted_neg) / (weighted_pos + weighted_neg)
        END AS adjustment
      FROM venue_stats
    `;

    const result: Record<string, number> = {};
    for (const row of rows.rows) {
      if (row.venue_id && row.adjustment !== null) {
        result[row.venue_id] = row.adjustment;
      }
    }
    return result;
  } catch {
    return {};
  }
}
