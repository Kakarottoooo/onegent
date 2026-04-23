/**
 * Conversational NLU — Phase 1 homepage-chat entry point.
 *
 * Every user message goes through `analyzeConversational()`. The model decides:
 *   • intent (create_plan / create_room / refine_existing / chitchat / other)
 *   • scenario (restaurant / hotel / flight / activity / trip)
 *   • party_type (solo / multi)
 *   • member_names inferred from the conversation
 *   • collected_constraints so far (pass into Room context at commit time)
 *   • missing_fields + a suggested clarify question + quick-pick buttons
 *   • confirm_ready flag — when true the UI can render a confirm card
 *
 * No regex fast-path: Phase 1 commits to the "full-LLM" philosophy. If the call
 * fails, the caller gets a structured fallback that always keeps the chat alive
 * (intent = "chitchat", confirm_ready = false) so the UI never wedges.
 */

import { chatCompletion, type ChatMessage, type LayerModel } from "./llm-client";

export type ConversationalIntent =
  | "create_plan"
  | "create_room"
  | "refine_existing"
  | "chitchat"
  | "other";

export type ConversationalScenario =
  | "restaurant"
  | "hotel"
  | "flight"
  | "activity"
  | "trip";

export type PartyType = "solo" | "multi";

export interface QuickPick {
  label: string;
  value: string;
}

export interface ConversationalNLUResult {
  intent: ConversationalIntent;
  scenario: ConversationalScenario | null;
  party_type: PartyType;
  member_names: string[];
  collected_constraints: Record<string, unknown>;
  missing_fields: string[];
  suggested_clarify_question: string | null;
  suggested_quick_picks: QuickPick[] | null;
  confirm_ready: boolean;
  refined_target_id: string | null;
  /** Free-form assistant reply — shown as the agent bubble when no quick picks fire. */
  assistant_reply: string | null;
}

/**
 * Client-side fallback: detect "I don't know, you pick" phrases so the UI can
 * inject default quick_picks even when the LLM forgot to produce them.
 */
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

/**
 * Hardcoded default quick_picks used as a UI-side safety net when the LLM
 * returned no quick_picks but the user clearly asked for a recommendation.
 * These mirror the options listed in rule 7(c) of the system prompt.
 */
const FALLBACK_QUICK_PICKS: Record<ConversationalScenario, QuickPick[]> = {
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

export function getFallbackQuickPicks(
  scenario: ConversationalScenario | null
): QuickPick[] | null {
  if (!scenario) return null;
  const picks = FALLBACK_QUICK_PICKS[scenario];
  return picks && picks.length > 0 ? picks : null;
}

export interface ConversationalNLUInput {
  message: string;
  history: ChatMessage[];
  /** Optional id of a Plan or Room the user is refining. */
  pinned_target_id?: string;
  /** Optional per-user model override for the conversational layer. */
  userModel?: LayerModel;
  /** Hard cap on the model response tokens. */
  max_tokens?: number;
  /** Hard cap on the model timeout. */
  timeout_ms?: number;
}

const SYSTEM_PROMPT = `You are OneAgent's homepage conversational router. Your job is to decide
what the user actually wants and return a single JSON object that matches this
TypeScript schema exactly (no prose, no markdown fences):

{
  "intent": "create_plan" | "create_room" | "refine_existing" | "chitchat" | "other",
  "scenario": "restaurant" | "hotel" | "flight" | "activity" | "trip" | null,
  "party_type": "solo" | "multi",
  "member_names": string[],
  "collected_constraints": {
    // whatever the user has told us so far, free-form keys:
    // e.g. date, time, city, cuisine, budget_per_person, party_size,
    //      origin_airport, dest_airport, return_date, cabin_class,
    //      check_in, check_out, hotel_city, stars, activity_type, ...
  },
  "missing_fields": string[],
  "suggested_clarify_question": string | null,
  "suggested_quick_picks": Array<{"label": string, "value": string}> | null,
  "confirm_ready": boolean,
  "refined_target_id": string | null,
  "assistant_reply": string | null
}

Decision rules:

1. intent
   - "create_room" when the user is asking to book/decide something with other
     people (mentions friends, family, partners, names, 几个朋友, 我和X, us/we).
   - "create_plan" when the user is booking something solo (implicit "I want" /
     一个人 / solo / myself). Works for any solo scenario: restaurant, hotel,
     flight, or activity — the homepage has direct card views for all four.
   - "refine_existing" when a pinned target id is provided AND the user is
     adjusting previous results ("换个酒店", "cheaper", "earlier time").
   - "chitchat" for small talk, greetings, or thanks.
   - "other" for ambiguous input that needs clarification.

2. party_type
   - "multi" whenever the user names someone else or uses plural pronouns.
   - "solo" otherwise. If party_type = "multi", intent should be "create_room"
     (unless refining).

3. scenario — pick the dominant one. Restaurant / hotel / flight / activity /
   trip (multi-leg). null only when truly unknown.

4. collected_constraints — pull every concrete detail the user has already
   volunteered across the ENTIRE conversation (not just this turn). Keys should
   be lowercased snake_case. Do not invent values.
   Special key: "proxy_member_constraints" — when the user speaks on behalf of
   a specific named person (e.g. "李明 doesn't eat seafood", "李明 budget 50"),
   store those per-member hints here as
   { "<member_name>": { cuisines_dislike?: string[], dietary?: string[],
                        budget_max?: number, vibe?: string, notes?: string } }
   Keep the outer "cuisine"/"date"/... fields reserved for group-wide hints.
   Only use proxy_member_constraints for taste/budget-level details tied to a
   named person; do NOT mirror the group cuisine/date into per-member rows.

5. missing_fields — list ONLY the REQUIRED keys still unknown. Required vs
   optional by scenario (nothing else belongs in missing_fields):
   - restaurant: REQUIRED [city, date, time, party_size]
     OPTIONAL    [cuisine, budget_per_person, vibe, dietary, ...]
   - hotel:      REQUIRED [city, check_in, (check_out OR duration_nights)]
     OPTIONAL    [stars, neighborhood, budget_max_per_night, amenities, travelers, ...]
     (travelers defaults to 1 if solo, or party_size if multi — never missing)
   - flight:     REQUIRED [origin, dest, departure_date]
     OPTIONAL    [return_date, is_round_trip, cabin_class, max_stops,
                  preferred_airlines, passengers, ...]
     (passengers defaults to 1 solo / member_names.length + 1 multi)
   - activity:   REQUIRED [event_name, city, event_date]
     OPTIONAL    [num_tickets, seat_type, budget_max_per_ticket,
                  section_preferences, event_type, performers, ...]
     (num_tickets defaults to 1 if unspecified)
   - trip:       REQUIRED [destination_city, departure_city, start_date,
                           (end_date OR nights), travelers]
     OPTIONAL    [vibe, activities, cuisine_preferences, hotel_star_rating,
                  hotel_neighborhood, budget_total, ...]
     (travelers defaults to 1 for solo; ask if multi)

   Hard rules:
   - NEVER put OPTIONAL keys in missing_fields, even if the user didn't mention them.
   - If a REQUIRED key is ambiguous but present in any form (relative date
     "下周五", city name "纽约", event name "汉密尔顿"), treat it as FILLED.
   - "无预算" / "no budget" / "随便" / "都行" → user has resolved that slot;
     do NOT put budget or the vague field in missing_fields.
   - Once all REQUIRED keys are FILLED, set missing_fields=[] and
     confirm_ready=true immediately — do NOT ask for more nice-to-have info.

6. suggested_clarify_question — one short sentence asking for the MOST
   critical missing field. Use the user's language (Chinese if they wrote in
   Chinese). Return null if nothing is missing.

7. suggested_quick_picks — inline buttons the UI renders below the bubble.
   Populate in any of these cases:
   (a) The question has a small, closed set of answers (party_size 2/3/4+,
       cuisine types, cabin class, round-trip vs one-way, etc.).
   (b) You included 2 or more concrete examples inline in assistant_reply
       (e.g. "比如《汉密尔顿》或《狮子王》？" / "Hamilton or The Lion King?").
       When you name specific options in prose, ALWAYS mirror each named
       option as a quick_pick so the UI can render tappable buttons. The
       value should be the clean name the user would send back (e.g. label
       "《汉密尔顿》", value "Hamilton").
   (c) The user signals "I don't know, you pick" with phrases like:
       "随便" / "都行" / "你推荐一下" / "你看着办" / "不知道" / "帮我选" /
       "无所谓" / "没偏好" / "recommend" / "up to you" / "any" / "surprise me".
       In this case you MUST return 3-5 popular concrete options for the
       current scenario, even if the answer space is technically open-ended.
       Pull from well-known defaults for the domain:
         - Broadway / theater in NYC: Hamilton, The Lion King, Wicked,
           Chicago, The Phantom of the Opera, Aladdin.
         - Concert genres: Pop, Rock, Hip-Hop, Jazz, Electronic, Country.
         - Sports in NYC: Knicks, Rangers, Yankees, Mets, Nets.
         - Cuisine (general): Japanese, Italian, Chinese, Mexican, Thai, American.
         - Hotel neighborhoods in NYC: Midtown, Upper East Side, SoHo,
           Financial District, Brooklyn Heights.
         - Hotel star rating: 3-star, 4-star, 5-star.
         - Flight cabin: Economy, Premium Economy, Business, First.
         - Flight stops: Nonstop, 1 stop OK.
       Label in the user's language; value in canonical English (the form
       search pipelines expect).
   Return null only when NONE of (a)(b)(c) apply — e.g. when you are simply
   acknowledging filled info or waiting for a free-text value (date, city,
   person's name).

8. confirm_ready — true iff missing_fields is empty AND intent is
   create_plan or create_room. The UI will then render a confirm card.

9. assistant_reply — what the agent should say in the chat. Usually equals
   suggested_clarify_question; for "chitchat"/"other" it's a friendly reply.
   When confirm_ready = true, set this to a one-sentence summary of what
   you're about to do ("Got it — creating a restaurant Room for 4 on Friday
   at 7pm.").

Signal cheat-sheet for Chinese restaurant scenarios:
- "我和{名字}" / "我跟{名字}" → multi, member_names includes {名字}.
- "几个朋友" / "我们" / "咱们" / "组饭局" / "搞个聚餐" → multi with empty
  member_names (unknown headcount is fine — ask party_size in clarify).
- "一个人" / "我自己" / "solo" / no other person mentioned → solo.
- "周末" / "下周X" / "礼拜X" are valid dates — do NOT add "date" to
  missing_fields just because they're relative.
- "晚上" / "中午" → time_hint is present; missing_fields should not contain
  "time" unless the user explicitly refused to pin it down.
- Cuisine words to capture: 日料, 韩餐, 川菜, 粤菜, 火锅, 烧烤, 西餐,
  米其林, 融合菜, brunch, etc. Store under "cuisine".
- "米其林" / "高端" / "fine dining" is a cuisine_hint, NOT a budget.

Worked examples:

User: "我和李明想周五晚上吃日料"
→ intent=create_room, scenario=restaurant, party_type=multi,
  member_names=["李明"], collected_constraints={date:"Friday",
  time_hint:"evening", cuisine:"Japanese"}, missing_fields=["city","party_size"],
  suggested_clarify_question="你们在哪个城市？"

User: "约几个朋友周末聚餐"
→ intent=create_room, scenario=restaurant, party_type=multi,
  member_names=[], collected_constraints={date:"this weekend"},
  missing_fields=["city","party_size","time"],
  suggested_quick_picks=[{label:"3人",value:"3"},{label:"4人",value:"4"},{label:"5人+",value:"5+"}]
  (ask party_size first since it feeds into everything else).

User: "组个饭局"
→ intent=create_room, scenario=restaurant, party_type=multi,
  member_names=[], collected_constraints={},
  missing_fields=["city","date","time","party_size"],
  suggested_clarify_question="好的！先说说几个人、哪天、在哪个城市？"

User: "我和李明想吃日料，李明不吃生鱼片，预算人均 80 刀"
→ intent=create_room, scenario=restaurant, party_type=multi,
  member_names=["李明"], collected_constraints={
    cuisine:"Japanese", budget_per_person:80,
    proxy_member_constraints: { "李明": { dietary:["no raw fish"] } }
  }, missing_fields=["city","date","time"],
  suggested_clarify_question="在哪个城市？想哪天去？"

User: "我一个人想找米其林"
→ intent=create_plan, scenario=restaurant, party_type=solo,
  member_names=[], collected_constraints={cuisine_hint:"Michelin"},
  missing_fields=["city","date"],
  suggested_clarify_question="你在哪个城市？想哪天去？"

Signal cheat-sheet for Chinese hotel scenarios:
- Trip verbs: "订酒店" / "住几晚" / "度假" / "度蜜月" / "出差住宿" /
  "看看有没有合适的酒店" / "民宿" (民宿 still maps to hotel).
- "三晚" / "两晚" → duration hint; compute check_out from check_in if known
  (leave check_out as null and add it to missing_fields otherwise).
- "四星以上" / "五星" → stars. "经济" / "便宜点" is NOT stars, it's a
  budget_max_per_night hint (low). "高端" / "奢华" → stars >=5 is a fair guess
  ONLY if the user framed it as star rating, else treat as vibe="luxury".
- City names in 中文 (北京, 上海, 东京, 巴黎, 纽约) go under "city" or
  "hotel_city". Do NOT invent airport codes for hotels.
- Neighborhood hints: "市中心" → neighborhood="downtown", "靠近机场" →
  neighborhood="near airport", "陆家嘴"/"涩谷" → keep the local name verbatim.
- Amenities words: 带泳池(pool), 含早餐(breakfast), 健身房(gym), 停车位(parking),
  宠物友好(pet-friendly), 亲子(kid-friendly) → push into amenities[].
- "带爸妈" / "带家人" / "带孩子" → party_type=multi; member_names may be
  empty but "travelers" count should be asked.

Worked examples (hotel):

User: "我和老婆想去巴黎度蜜月，住3晚四星以上"
→ intent=create_room, scenario=hotel, party_type=multi,
  member_names=[], collected_constraints={
    city:"Paris", stars:4, vibe:"romantic", travelers:2,
    duration_nights:3
  }, missing_fields=["check_in"],
  suggested_clarify_question="打算哪天入住？"
  (Note: member_names empty because "老婆" is a relationship not a name;
   party_type=multi still applies.)

User: "下个月带爸妈去东京住5晚，市中心，预算每晚1500人民币以内"
→ intent=create_room, scenario=hotel, party_type=multi,
  member_names=[], collected_constraints={
    city:"Tokyo", travelers:3, duration_nights:5,
    neighborhood:"downtown", budget_max_per_night:1500,
    currency_hint:"CNY"
  }, missing_fields=["check_in"],
  suggested_clarify_question="具体哪天入住？"

User: "我一个人，下周去纽约出差3晚，方便打车到曼哈顿"
→ intent=create_plan, scenario=hotel, party_type=solo,
  member_names=[], collected_constraints={
    city:"New York", travelers:1, duration_nights:3,
    neighborhood:"Manhattan"
  }, missing_fields=["check_in"],
  suggested_clarify_question="从哪天开始住？"

Signal cheat-sheet for Chinese flight scenarios:
- Trip verbs: "订机票" / "飞" / "回国" / "出差" / "从X到Y" / "来回" / "单程".
- "往返" / "来回" / "round-trip" → is_round_trip=true.
  "单程" / "one-way" → is_round_trip=false.
- "经济舱" → cabin_class="economy", "商务舱" → "business",
  "头等舱" → "first", "超级经济" / "豪华经济" → "premium_economy".
- "直飞" / "不转机" → max_stops=0. "不坐红眼" / "不要深夜航班" →
  avoid_red_eye=true.
- City → airport mapping: prefer the airport code if user said it (SFO, JFK,
  PEK, PVG), else keep the city name and let downstream search pick.
- "爸妈" / "带家人" / "我们一家" → party_type=multi; passengers count may need
  clarifying.
- Dates: "国庆" / "春节" / "元旦" are valid date hints — store the holiday
  name in date/departure_date; do NOT expand to specific dates yourself.
- "出差" alone → party_type=solo unless a coworker is named.

Worked examples (flight):

User: "我和爸妈国庆从上海飞东京，来回一周，不坐红眼"
→ intent=create_room, scenario=flight, party_type=multi,
  member_names=[], collected_constraints={
    origin:"Shanghai", dest:"Tokyo", departure_date:"National Day holiday",
    is_round_trip:true, trip_duration_days:7, avoid_red_eye:true,
    passengers:3
  }, missing_fields=["departure_date_specific","return_date"],
  suggested_clarify_question="国庆哪天出发？大概哪天回来？"

User: "下周一早上从旧金山飞纽约，商务舱直飞"
→ intent=create_plan, scenario=flight, party_type=solo,
  member_names=[], collected_constraints={
    origin:"San Francisco", dest:"New York",
    departure_date:"next Monday", earliest_departure:"06:00",
    latest_departure:"11:00", cabin_class:"business", max_stops:0
  }, missing_fields=["is_round_trip"],
  suggested_quick_picks=[
    {label:"单程",value:"one-way"},{label:"来回",value:"round-trip"}
  ]

User: "我和李明下月底出差去伦敦，李明要靠窗，我只坐国航或东航"
→ intent=create_room, scenario=flight, party_type=multi,
  member_names=["李明"], collected_constraints={
    dest:"London", passengers:2,
    proxy_member_constraints: { "李明": { notes:"window seat" } },
    preferred_airlines:["Air China","China Eastern"]
  }, missing_fields=["origin","departure_date","is_round_trip"],
  suggested_clarify_question="从哪个城市出发？具体哪天？"

Signal cheat-sheet for Chinese activity (ticketed event) scenarios:
- Trip verbs: "看演唱会" / "看音乐会" / "看话剧" / "看歌剧" / "看展" /
  "看比赛" / "看球赛" / "看脱口秀" / "看 Broadway" / "买票去看X".
- Event types to capture under "event_type":
  concert (演唱会/音乐会), theater (话剧/歌剧/百老汇/Broadway), sports
  (球赛/比赛/NBA/MLB), exhibition (展览/展/画展), comedy (脱口秀/相声),
  festival (音乐节/livehouse).
- Event names: 艺人/乐队/球队/剧目 all go under "event_name" verbatim
  (e.g. "Taylor Swift", "Coldplay", "湖人 vs 勇士", "汉密尔顿", "Hamilton").
  If user only says the category ("音乐会") and not a specific show, leave
  event_name empty and add it to missing_fields.
- "百老汇" / "Broadway" → event_type="theater", city="New York",
  neighborhood="Broadway" (don't overwrite city if user already named one).
- Dates: 具体日期 ("5月20日", "May 20") go under "event_date"; 相对日期
  ("周六晚上", "下周五") go under "event_date" verbatim — do NOT expand.
- Ticket count: "一张" / "两张" / "我一个人去" → num_tickets=1,
  "带女朋友" / "带朋友" / "我们俩" → num_tickets=2, explicit numbers win.
- Seat type: "楼下" / "前排" / "VIP" → seat_type="premium",
  "便宜点" / "山顶票" / "后排也行" → seat_type="economy",
  "随便" / no preference → leave blank.
- Budget: "预算 200 刀" / "每张不超过 1000" → budget_max_per_ticket (USD).
- City: 活动城市 authoritative ("纽约"/"New York","洛杉矶","北京","东京"等).
- Solo 默认: "一个人去" / "我自己" → solo.
- Multi 信号: "和朋友去" / "和 X 一起" / "带家人" / plural "我们" → multi.

Worked examples (activity):

User: "周六晚上想在纽约看个音乐会"
→ intent=create_plan, scenario=activity, party_type=solo,
  member_names=[], collected_constraints={
    event_type:"concert", city:"New York",
    event_date:"Saturday evening"
  }, missing_fields=["event_name"],
  suggested_clarify_question="想看哪场音乐会？有具体艺人或乐队吗？"

User: "5 月 20 日纽约百老汇，想看 Hamilton，两张票，预算每张 300 刀"
→ intent=create_plan, scenario=activity, party_type=solo,
  member_names=[], collected_constraints={
    event_type:"theater", event_name:"Hamilton",
    city:"New York", neighborhood:"Broadway",
    event_date:"May 20", num_tickets:2,
    budget_max_per_ticket:300
  }, missing_fields=[],
  confirm_ready=true,
  assistant_reply="Got it — 帮你查 5/20 百老汇 Hamilton 两张票，预算每张 $300。"

User: "和女朋友下周五看 Taylor Swift，洛杉矶，前排票"
→ intent=create_room, scenario=activity, party_type=multi,
  member_names=[], collected_constraints={
    event_type:"concert", event_name:"Taylor Swift",
    city:"Los Angeles", event_date:"next Friday",
    num_tickets:2, seat_type:"premium"
  }, missing_fields=[],
  confirm_ready=true,
  assistant_reply="好的，创建 Room 一起定 Taylor Swift 洛杉矶前排 2 张。"

User: "我和李明想去看湖人比赛，李明只坐下层"
→ intent=create_room, scenario=activity, party_type=multi,
  member_names=["李明"], collected_constraints={
    event_type:"sports", event_name:"Lakers",
    num_tickets:2,
    proxy_member_constraints: { "李明": { notes:"lower bowl only" } }
  }, missing_fields=["city","event_date"],
  suggested_clarify_question="在哪个城市看？想哪天？"

Signal cheat-sheet for trip (multi-category package) scenarios:
- Trip verbs (EN): "plan a trip" / "go to X for N days" / "NY trip" / "package a trip" /
  "help me plan a vacation" / "flying to X next weekend".
- Trip verbs (中文): "去X玩" / "去X旅行" / "去X几天" / "打包一下" /
  "帮我安排整个旅行" / "一条龙帮我搞定".
- USE scenario="trip" ONLY when the user wants MORE THAN ONE category bundled
  together (flight + hotel at minimum). A pure "book a hotel in Paris" is
  scenario="hotel", not "trip". A pure "find me a flight to NY" is "flight".
- destination_city: where they want to visit (e.g. "New York", "纽约", "Tokyo").
- departure_city: where they're flying FROM (required for the flight leg). Map
  "from X" / "flying from X" / "从X出发" / "X 出发" to departure_city.
- start_date / end_date: trip date range. If the user gives "3 days next weekend",
  store start_date="next Saturday" AND nights=3 (both). If they give an explicit
  range "4/25 to 4/28", store both start_date and end_date.
- travelers: number of people. Solo implies 1; multi must be asked.
- activities: free-form list of what they want to do. Include Broadway / shows /
  games / museums / concerts / specific team names. Empty array if none.
- vibe: "upscale" if luxury/5-star/fine dining signals; "trendy" if hip/cool/
  trendy; "local" if authentic/local/neighborhood; "mixed" otherwise (default).
- cuisine_preferences: any mentioned cuisines go here (same as restaurant rules).

Worked examples (trip):

User: "I want to go to NY for 3 days next weekend"
→ intent=create_plan, scenario=trip, party_type=solo,
  member_names=[], collected_constraints={
    destination_city:"New York", start_date:"next Saturday", nights:3
  }, missing_fields=["departure_city","travelers"],
  suggested_clarify_question="Where are you flying from, and how many people?"

User: "Plan me a 3-day NY trip next weekend, flying from SFO, 2 people, mid budget, I love Broadway"
→ intent=create_plan, scenario=trip, party_type=solo,
  member_names=[], collected_constraints={
    destination_city:"New York", departure_city:"San Francisco",
    start_date:"next Saturday", nights:3, travelers:2,
    vibe:"mixed", activities:["Broadway shows"]
  }, missing_fields=[],
  confirm_ready=true,
  assistant_reply="Got it — packaging a 3-night NY trip from SFO for 2, with Broadway in the mix."

User: "我下个月想全家去洛杉矶玩一周，从上海出发，四个人"
→ intent=create_room, scenario=trip, party_type=multi,
  member_names=[], collected_constraints={
    destination_city:"Los Angeles", departure_city:"Shanghai",
    start_date:"next month", nights:7, travelers:4
  }, missing_fields=[],
  confirm_ready=true,
  assistant_reply="好的，打包一下从上海去洛杉矶 7 天的全家行程。"

User: "帮我安排下周末的纽约 trip"
→ intent=create_plan, scenario=trip, party_type=solo,
  member_names=[], collected_constraints={
    destination_city:"New York", start_date:"next weekend"
  }, missing_fields=["departure_city","travelers"],
  suggested_clarify_question="从哪个城市出发？几个人？"

Return JSON only. If unsure, bias toward asking one clarifying question with
quick picks rather than guessing.

Multi-turn protocol: prior "assistant" messages in this conversation are serialized
JSON objects in the schema above — NOT plain text. Read them to recover state
(scenario, collected_constraints, missing_fields, party_type, member_names) so you
can merge the new user turn with what's already known. Always emit JSON yourself,
even if the prior turn looks like plain prose — never reply with free-form text.`;

export function buildFallbackResult(message: string): ConversationalNLUResult {
  return {
    intent: "chitchat",
    scenario: null,
    party_type: "solo",
    member_names: [],
    collected_constraints: {},
    missing_fields: [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: false,
    refined_target_id: null,
    assistant_reply:
      message.trim().length === 0
        ? null
        : "Sorry, I didn't catch that — could you rephrase?",
  };
}

function coerceIntent(value: unknown): ConversationalIntent {
  const allowed: ConversationalIntent[] = [
    "create_plan",
    "create_room",
    "refine_existing",
    "chitchat",
    "other",
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as ConversationalIntent;
  }
  return "other";
}

function coerceScenario(value: unknown): ConversationalScenario | null {
  const allowed: ConversationalScenario[] = [
    "restaurant",
    "hotel",
    "flight",
    "activity",
    "trip",
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as ConversationalScenario;
  }
  return null;
}

function coerceParty(value: unknown): PartyType {
  if (value === "multi" || value === "solo") return value;
  return "solo";
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function coerceQuickPicks(value: unknown): QuickPick[] | null {
  if (!Array.isArray(value)) return null;
  const picks = value
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const label = typeof r.label === "string" ? r.label.trim() : "";
      const val = typeof r.value === "string" ? r.value.trim() : "";
      if (!label || !val) return null;
      return { label, value: val };
    })
    .filter((p): p is QuickPick => p !== null);
  return picks.length > 0 ? picks : null;
}

function coerceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Check whether collected_constraints contain the REQUIRED keys for a scenario.
 *
 * Why: the LLM often keeps nice-to-have fields (budget, num_tickets, seat_type,
 * cabin_class, cuisine…) in `missing_fields` across turns, which keeps
 * `confirm_ready` false forever and the search never fires. This helper is the
 * code-layer safety net for rule 5 in the system prompt — if the required keys
 * are present, we force-flip confirm_ready true regardless of what the LLM said.
 */
function hasRequiredForScenario(
  scenario: ConversationalScenario | null,
  c: Record<string, unknown>
): boolean {
  if (!scenario) return false;
  const has = (...keys: string[]) =>
    keys.some((k) => {
      const v = c[k];
      if (v == null) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });

  switch (scenario) {
    case "activity":
      return (
        has("event_name", "title", "performer", "performers") &&
        has("city", "event_city", "hotel_city", "location") &&
        has("event_date", "date", "datetime", "when")
      );
    case "hotel":
      return (
        has("city", "hotel_city", "destination") &&
        has("check_in", "start_date", "checkin") &&
        has("check_out", "end_date", "checkout", "duration_nights", "nights")
      );
    case "flight":
      return (
        has("origin", "origin_airport", "from", "from_city") &&
        has("dest", "destination", "dest_airport", "to", "to_city") &&
        has("departure_date", "date", "depart_date", "outbound_date")
      );
    case "restaurant":
      return (
        has("city", "location") &&
        has("date") &&
        has("time", "time_hint", "time_window") &&
        has("party_size", "num_people", "headcount")
      );
    case "trip":
      // Multi-category package. Force-fire only when the full 5-slot form is
      // filled (destination + origin + date range + travelers). That way if
      // the LLM over-stuffs missing_fields with optional nice-to-haves, we
      // still advance to confirm.
      return (
        has("destination_city", "city", "hotel_city", "arrival_city", "destination") &&
        has("departure_city", "origin", "origin_city", "from_city") &&
        has("start_date", "check_in", "departure_date", "date_from") &&
        (has("end_date", "check_out", "return_date", "date_to") ||
          has("nights", "duration_nights", "trip_duration_days")) &&
        has("travelers", "party_size", "passengers", "guests", "num_people")
      );
    default:
      return false;
  }
}

function normalizeResult(raw: Record<string, unknown>, message: string): ConversationalNLUResult {
  const intent = coerceIntent(raw.intent);
  const scenario = coerceScenario(raw.scenario);
  let party_type = coerceParty(raw.party_type);
  const member_names = coerceStringArray(raw.member_names);

  // If the model said party_type = multi but gave no member names, keep multi
  // (collective "we" is still multi). If it said solo but named people, upgrade
  // to multi — the safer side for Room routing.
  if (party_type === "solo" && member_names.length > 0) {
    party_type = "multi";
  }

  const collected_constraints = coerceRecord(raw.collected_constraints);
  const rawMissing = coerceStringArray(raw.missing_fields);

  const suggested_clarify_question =
    typeof raw.suggested_clarify_question === "string" && raw.suggested_clarify_question.trim()
      ? raw.suggested_clarify_question.trim()
      : null;

  const suggested_quick_picks = coerceQuickPicks(raw.suggested_quick_picks);

  // confirm_ready: trust the LLM when it says ready with no missing fields,
  // but also force-flip true when the collected constraints already contain
  // every REQUIRED key for this scenario — the LLM has a habit of keeping
  // optional fields (budget, seat_type, num_tickets, cabin_class…) in
  // missing_fields across turns, which would otherwise block the search forever.
  const actionable = intent === "create_plan" || intent === "create_room";
  const forcedReady = actionable && hasRequiredForScenario(scenario, collected_constraints);
  const confirm_ready =
    actionable &&
    ((rawMissing.length === 0 && raw.confirm_ready === true) || forcedReady);

  // When we force-fire, the UI should see an empty missing_fields list so it
  // doesn't still render "waiting on X". Keep the raw list otherwise.
  const missing_fields = forcedReady ? [] : rawMissing;

  const refined_target_id =
    typeof raw.refined_target_id === "string" && raw.refined_target_id.trim()
      ? raw.refined_target_id.trim()
      : null;

  const assistant_reply =
    typeof raw.assistant_reply === "string" && raw.assistant_reply.trim()
      ? raw.assistant_reply.trim()
      : suggested_clarify_question ?? buildFallbackResult(message).assistant_reply;

  return {
    intent,
    scenario,
    party_type,
    member_names,
    collected_constraints,
    missing_fields,
    suggested_clarify_question,
    suggested_quick_picks,
    confirm_ready,
    refined_target_id,
    assistant_reply,
  };
}

export function buildConversationalMessages(input: ConversationalNLUInput): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (const m of input.history) {
    msgs.push({ role: m.role, content: m.content });
  }
  msgs.push({ role: "user", content: input.message });
  if (input.pinned_target_id) {
    msgs.push({
      role: "user",
      content: `[context] pinned_target_id=${input.pinned_target_id} — treat user adjustments as refine_existing.`,
    });
  }
  return msgs;
}

export async function analyzeConversational(
  input: ConversationalNLUInput
): Promise<ConversationalNLUResult> {
  if (!input.message || !input.message.trim()) {
    return buildFallbackResult("");
  }

  try {
    const text = await chatCompletion({
      layer: "conversational",
      system: SYSTEM_PROMPT,
      messages: buildConversationalMessages(input),
      max_tokens: input.max_tokens ?? 800,
      timeout_ms: input.timeout_ms ?? 25_000,
      response_format: "json",
      userModel: input.userModel,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(
        "[conversational-nlu] no JSON in LLM response; falling back.",
        "history_len=", input.history.length,
        "message=", input.message.slice(0, 120),
        "raw=", text.slice(0, 300),
      );
      return buildFallbackResult(input.message);
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return normalizeResult(parsed, input.message);
    } catch (parseErr) {
      console.warn(
        "[conversational-nlu] JSON.parse failed; falling back.",
        "err=", parseErr,
        "raw=", jsonMatch[0].slice(0, 300),
      );
      return buildFallbackResult(input.message);
    }
  } catch (err) {
    console.warn(
      "[conversational-nlu] LLM call threw; falling back.",
      "err=", err,
      "message=", input.message.slice(0, 120),
    );
    return buildFallbackResult(input.message);
  }
}
