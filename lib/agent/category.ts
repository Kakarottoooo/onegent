import { CategoryType, MultilingualQueryContext } from "../types";
import { minimaxChat } from "../minimax";

export async function detectCategory(
  message: string,
  queryContext?: MultilingualQueryContext
): Promise<CategoryType> {
  if (queryContext?.category_hint && queryContext.category_hint !== "unknown") {
    return queryContext.category_hint;
  }

  const lower = message.toLowerCase();
  const creditCardKeywords = [
    "credit card", "credit cards", "cash back", "cashback", "rewards card",
    "points card", "travel card", "which card", "best card", "card recommendation",
    "what card", "recommend a card", "suggest a card", "get a card", "apply for",
    "signup bonus", "sign-up bonus", "annual fee", "no annual fee",
    "spend on", "i spend", "monthly spend", "per month", "spending profile",
    "rewards points", "earn points", "points on", "miles on",
    "chase sapphire", "amex gold", "amex platinum", "venture x", "capital one",
    "no cards currently", "no card", "first card", "open to business cards",
    "prefer points", "prefer cash", "prefer travel rewards",
    "信用卡", "哪张卡", "积分卡", "返现卡", "推荐卡", "开卡奖励",
  ];

  // Spending-context signals: if user describes their monthly spend breakdown
  // AND asks for a recommendation, it's almost certainly a credit card query
  const hasSpendingContext = /\$[\d,]+\s*(\/month|per month|a month|monthly)/.test(lower)
    || /\d+[k]?\s*(\/month|per month|a month)/.test(lower)
    || lower.includes("monthly spend") || lower.includes("i spend about");
  const hasCardRecommendationAsk = lower.includes("recommend") || lower.includes("what should")
    || lower.includes("which") || lower.includes("suggest") || lower.includes("best")
    || lower.includes("what card") || lower.includes("open to");

  if (hasSpendingContext && hasCardRecommendationAsk) return "credit_card";

  const flightKeywords = [
    "flight", "flights", "fly", "flying", "plane", "airline", "airport",
    "ticket", "tickets", "one way", "round trip", "roundtrip", "nonstop",
    "economy class", "business class", "first class", "layover", "stopover",
    "depart", "departing", "arrive", "arriving", "boarding",
    "机票", "航班", "飞机", "起飞", "降落", "经济舱", "商务舱",
  ];
  const hotelKeywords = [
    "hotel", "motel", "inn", "resort", "lodge", "hostel", "airbnb",
    "check in", "check-in", "check out", "check-out", "nights", "night stay",
    "stay at", "book a room", "accommodation", "suite", "booking",
    "酒店", "旅馆", "住", "入住", "退房", "晚", "客房",
  ];
  const restaurantKeywords = [
    "restaurant", "restaurants", "dinner", "lunch", "brunch", "breakfast",
    "book a table", "table for", "reservation", "eat out", "dining",
    "steakhouse", "sushi", "omakase", "tasting menu", "western food",
  ];
  const laptopKeywords = [
    "laptop", "notebooks", "notebook computer", "macbook", "thinkpad", "chromebook",
    "ultrabook", "gaming laptop", "business laptop", "laptop recommendation",
    "which laptop", "best laptop", "what laptop", "recommend a laptop", "suggest a laptop",
    "looking for a laptop", "need a laptop", "buy a laptop", "purchase a laptop",
    "software development laptop", "video editing laptop", "coding laptop",
    "work from home laptop", "wfh laptop", "college laptop", "student laptop",
    "light laptop", "portable laptop", "budget laptop", "laptop under",
    // use-case descriptions without explicit device name
    "photo editing", "photo edit", "video editing", "note-taking", "note taking", "notetaking",
    "college student", "for school", "for college", "for uni", "for university",
    "for coding", "for programming", "for development", "for gaming",
    "笔记本", "笔记本电脑", "电脑推荐", "哪款电脑", "苹果电脑", "游戏本",
    "轻薄本", "商务本", "编程用什么电脑", "剪辑用什么电脑",
  ];

  // Subscription detection — must come before other categories
  const subscriptionKeywords = [
    "tell me when", "let me know when", "notify me", "notify me when",
    "alert me", "alert me when", "keep me posted", "keep me updated",
    "watch for", "monitor for", "subscribe", "track releases",
    "when.*release", "when.*announce", "when.*come out", "when.*launch",
    "新品提醒", "发布提醒", "出了告诉我", "新款提醒",
  ];
  const hasSubscriptionTrigger = subscriptionKeywords.some((kw) =>
    kw.includes(".*") ? new RegExp(kw).test(lower) : lower.includes(kw)
  );
  // Also detect unsubscribe / list
  const hasUnsubscribe = lower.includes("stop notif") || lower.includes("unsubscribe") || lower.includes("取消订阅");
  const hasListSubs = (lower.includes("what am i") && lower.includes("watch")) ||
    lower.includes("my subscriptions") || lower.includes("show subscriptions") ||
    lower.includes("我的订阅");
  if (hasSubscriptionTrigger || hasUnsubscribe || hasListSubs) return "subscription";

  // Credit card check first to avoid collision with "travel card" → hotel
  if (creditCardKeywords.some((kw) => lower.includes(kw))) return "credit_card";

  // Smartphone keywords
  const smartphoneKeywords = [
    "phone", "smartphone", "iphone", "galaxy", "pixel phone", "android phone",
    "mobile phone", "cell phone", "which phone", "best phone", "new phone",
    "recommend a phone", "buy a phone", "upgrade my phone",
    "galaxy s", "galaxy a", "nothing phone", "oneplus", "xperia",
    "手机", "苹果手机", "安卓手机", "换手机", "买手机", "推荐手机",
  ];
  // Headphone keywords
  const headphoneKeywords = [
    "headphone", "headphones", "earbuds", "earphones", "airpods", "buds",
    "noise canceling", "noise cancelling", "noise-cancelling", "anc headphone",
    "over-ear", "in-ear", "wireless headphone", "wired headphone",
    "wh-1000xm", "wf-1000xm", "quietcomfort", "momentum wireless",
    "which headphones", "best headphones", "recommend headphones",
    "耳机", "无线耳机", "降噪耳机", "入耳式", "头戴式",
  ];

  const hasStrongHotelKeyword =
    (hotelKeywords.some((kw) => lower.includes(kw)) &&
      /\bhotel\b|\bmotel\b|\binn\b|\bresort\b|\blodge\b|\bhostel\b|\bairbnb\b|\bcheck in\b|\bcheck-in\b|\bcheck out\b|\bcheck-out\b|\bbook a room\b|\baccommodation\b|\bsuite\b|\broom\b/.test(lower)) ||
    /住宿|酒店|旅馆|宾馆|民宿|入住|退房|客房|房间|大床房|双床房|住几晚/.test(message);
  const hasRestaurantKeyword =
    restaurantKeywords.some((kw) => lower.includes(kw)) ||
    /餐厅|饭店|吃饭|晚餐|午餐|早餐|约会|西餐|日料|火锅|订位|订座|聚餐/.test(message);

  // Activity keywords — ticketed events (concerts, theater, sports, comedy). Must come
  // before restaurant/hotel/flight to catch "music ticket" / "see Hamilton" queries.
  const activityKeywords = [
    "concert", "concerts", "live music", "gig", "festival", "music festival",
    "broadway", "musical", "theater show", "theatre show", "opera",
    "comedy show", "stand up", "stand-up", "standup",
    "sports game", "nba game", "nfl game", "mlb game", "nhl game", "soccer match",
    "buy tickets", "get tickets", "see taylor swift", "see coldplay",
    "see hamilton", "see wicked", "see lion king", "see lakers", "see yankees",
    "音乐会", "演唱会", "百老汇", "歌剧", "话剧", "音乐剧", "球赛", "比赛", "脱口秀", "相声",
    "门票", "看秀", "看演出", "看比赛",
  ];
  if (activityKeywords.some((kw) => lower.includes(kw) || message.includes(kw))) {
    return "activity";
  }
  if (headphoneKeywords.some((kw) => lower.includes(kw))) return "headphone";
  if (smartphoneKeywords.some((kw) => lower.includes(kw))) return "smartphone";
  // Laptop check before flight/hotel to avoid collision
  if (laptopKeywords.some((kw) => lower.includes(kw))) return "laptop";
  if (flightKeywords.some((kw) => lower.includes(kw))) return "flight";
  if (hasRestaurantKeyword && !hasStrongHotelKeyword) return "restaurant";
  if (hasStrongHotelKeyword && !hasRestaurantKeyword) return "hotel";
  if (hasRestaurantKeyword) return "restaurant";

  // No keyword matched — ask LLM to classify rather than blindly defaulting to restaurant
  try {
    const raw = await minimaxChat({
      system: `You are a query classifier. Given a user message, reply with exactly one word — the category it belongs to:
- "laptop"     : asking for a laptop, computer, notebook recommendation
- "smartphone" : asking for a phone, iPhone, Android phone recommendation
- "headphone"  : asking for headphones, earbuds, earphones recommendation
- "credit_card": asking for a credit card recommendation
- "flight"     : asking about flights or plane tickets
- "hotel"      : asking about hotel or accommodation
- "restaurant" : asking about food, dining, eating out, or a restaurant

Reply with only the single word. No explanation.`,
      messages: [{ role: "user", content: message }],
      max_tokens: 5,
    });
    const category = raw.trim().toLowerCase().replace(/[^a-z_]/g, "") as CategoryType;
    if (["laptop", "smartphone", "headphone", "credit_card", "flight", "hotel", "restaurant"].includes(category)) {
      return category;
    }
  } catch {
    // ignore, fall through to default
  }
  return "restaurant";
}
