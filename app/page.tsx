"use client";

import { useRef, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import RecommendationCard from "@/components/RecommendationCard";
import HotelCard from "@/components/HotelCard";
import FlightCard from "@/components/FlightCard";
import InlineJobCard, { type TravelDocRequest } from "@/components/booking/InlineJobCard";
import CreditCardCard from "@/components/CreditCardCard";
import LaptopCard from "@/components/LaptopCard";
import SmartphoneCard from "@/components/SmartphoneCard";
import HeadphoneCard from "@/components/HeadphoneCard";
import ActivityCard from "@/components/ActivityCard";
import ScenarioPlanView from "@/components/ScenarioPlanView";
import FeedbackPromptCard from "@/components/FeedbackPromptCard";
import DateRangePicker from "@/components/DateRangePicker";
import { CITIES_SORTED } from "@/lib/cities";
import { useChat, LOADING_STEPS } from "@/app/hooks/useChat";
import { useSubscriptions } from "@/app/hooks/useSubscriptions";
import { subscribeToPushNotifications } from "@/app/hooks/usePushSubscribe";
import { WATCH_CATEGORY_META } from "@/lib/watchTypes";
import { buildPlanFeedbackCopy } from "@/lib/outputCopy";
import type { MapPin } from "@/components/MapView";
import { useLocation } from "@/app/hooks/useLocation";
import { useFavorites } from "@/app/hooks/useFavorites";
import { usePreferences, formatProfileForPrompt } from "@/app/hooks/usePreferences";
import { useVoiceInput } from "@/app/hooks/useVoiceInput";
import { useAuth } from "@/app/hooks/useAuth";
import { PlanAction, PlanLinkAction, RecommendationCard as CardType, PostExperienceFeedback, FeedbackRecord } from "@/lib/types";
import type { FeedbackPromptItem } from "@/app/api/feedback-prompts/route";
import DecisionRoomModal from "@/components/DecisionRoomModal";
import ConfirmCard, { type CommitResponse } from "@/components/ConfirmCard";
import TripPackageCard from "@/components/TripPackageCard";
import type { TripPackage } from "@/lib/types";
import type { TripIntentState } from "@/lib/agent/trip-intent-state";
import { useLanguage } from "@/app/hooks/useLanguage";
import GlobalNav from "@/components/GlobalNav";
import {
  looksLikeRecommendationAsk,
  getFallbackQuickPicks,
  type ConversationalNLUResult,
  type QuickPick,
} from "@/lib/conversational-nlu";
import type { ChatMessage } from "@/lib/llm-client";
import { loadAgentModelConfig } from "@/lib/agent-model-config";
import { useRouter } from "next/navigation";

// Leaflet is not SSR-compatible
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const DEFAULT_EXAMPLES = [
  "Romantic dinner for two, ~$80/person, quiet, no chains, Manhattan",
  "4-star hotel in Chicago downtown, $200/night, check in Friday, 2 nights, business trip",
];

const HERO_TAGLINES = [
  {
    headline: ["Your AI guide", "to the city."],
    sub: "Restaurants, hotels, and more — curated for you.",
  },
  {
    headline: ["Tell me where", "you want to be."],
    sub: "I'll find exactly the right place.",
  },
  {
    headline: ["Discover places", "worth remembering."],
    sub: "Powered by AI. Guided by taste.",
  },
  {
    headline: ["Every city has", "hidden gems."],
    sub: "Onegent helps you find them.",
  },
];

const DIETARY_OPTIONS = ["Vegetarian", "Vegan", "Gluten-free", "Shellfish-free", "Halal", "Kosher"];
const NOISE_OPTIONS: Array<{ value: "quiet" | "moderate" | "lively"; label: string }> = [
  { value: "quiet", label: "Quiet" },
  { value: "moderate", label: "Moderate" },
  { value: "lively", label: "Lively" },
];

const WEIGHT_LABELS: Record<string, string> = {
  budget_match: "Budget match",
  scene_match: "Scene fit",
  review_quality: "Review quality",
  location_convenience: "Location",
  preference_match: "Preference match",
};

export default function Home() {
  const { profile, updateProfile, learnFromFavorite, learnFromSearch, resetProfile, learnedWeights, learnWeightsFromFeedback, learnFromFeedback, learnFromAgentResponse, updateDiscoveredPreference, removeDiscoveredPreference } =
    usePreferences();
  const profileContext = formatProfileForPrompt(profile);
  const { userId } = useAuth();
  const { aiInstruction: languageInstruction, t } = useLanguage();
  const th = t.home;
  const tn = t.nav;

  const location = useLocation();
  const subs = useSubscriptions();
  const chat = useChat({
    cityId: location.cityId,
    gpsCoords: location.gpsCoords,
    isNearMe: location.isNearMe,
    nearLocation: location.nearLocation,
    profileContext,
    languageInstruction,
    learnedWeights,
    userId,
    onSubscriptionIntent: (intent) => {
      if (intent.action === "subscribe") subs.addSubscription(intent);
      else if (intent.action === "unsubscribe") subs.removeSubscription(intent);
      // "list" is handled by the chat message sentinel
    },
    onAgentResponse: (requirements, userMessage) => {
      learnFromAgentResponse(requirements, userMessage);
    },
  });
  const { favorites, toggleFavorite } = useFavorites(learnFromFavorite);
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef("");
  const isComposingRef = useRef(false);

  // P1-15 unified NLU routing state — sits alongside the old chat.messages
  // thread. Confirm card + quick picks render below the last assistant bubble.
  const [pendingConfirm, setPendingConfirm] = useState<{
    nlu: ConversationalNLUResult;
    message: string;
    kind: "room" | "plan" | "trip";
  } | null>(null);
  const [pendingQuickPicks, setPendingQuickPicks] = useState<QuickPick[] | null>(null);
  // Phase 1-E: trip packaging result. "planning" while /api/chat/trip/plan runs
  // (10-15s for hotel+flight pipelines); "ready" once the TripPackage lands.
  const [tripFlow, setTripFlow] = useState<
    | { phase: "planning" }
    | {
        phase: "ready";
        pkg: TripPackage;
        errors?: { hotel?: string | null; flight?: string | null; restaurant?: string | null; activity?: string | null };
      }
    | { phase: "error"; message: string }
    | null
  >(null);
  const [nluPending, setNluPending] = useState(false);
  // Tracks the plan ID that triggered a refine action, for parent_plan_id lineage
  const refinedFromPlanIdRef = useRef<string | null>(null);
  const [prefModalOpen, setPrefModalOpen] = useState(false);
  const [editingPrefId, setEditingPrefId] = useState<string | null>(null);
  const [editingPrefValue, setEditingPrefValue] = useState("");

  // Phase 5.3: Auth
  const auth = useAuth();
  const [upgradePromptShown, setUpgradePromptShown] = useState(false);
  const [planFeedbackMessage, setPlanFeedbackMessage] = useState<string | null>(null);
  const [pendingFeedbackPrompts, setPendingFeedbackPrompts] = useState<FeedbackPromptItem[]>([]);

  // Phase 5.2: Voice input
  const { isListening, isSupported: voiceSupported, startListening, stopListening } = useVoiceInput(
    (transcript) => {
      chat.setInput(transcript);
      chatInputRef.current = transcript;
      // Small delay so the input value is set before we fire the unified NLU route.
      setTimeout(() => {
        void sendCurrentInput();
      }, 100);
    }
  );

  // Phase 4.3: Compare state
  const [compareSelection, setCompareSelection] = useState<(CardType | null)[]>([null, null]);
  const [compareOpen, setCompareOpen] = useState(false);

  // Phase 7: Hotel date picker state
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [hotelDates, setHotelDates] = useState<{ checkIn: string; checkOut: string } | null>(null);

  // Hero tagline rotation (start at 0 for SSR, randomize on mount to avoid hydration mismatch)
  const [heroIdx, setHeroIdx] = useState(0);
  const [heroVisible, setHeroVisible] = useState(true);
  const [decisionRoomOpen, setDecisionRoomOpen] = useState(false);
  const [decisionRoomQuery, setDecisionRoomQuery] = useState("");
  const [recentJobs, setRecentJobs] = useState<{ id: string; trip_label: string; status: string; created_at: string }[]>([]);
  // Inline booking task cards rendered below results
  const [inlineItems, setInlineItems] = useState<{ type: "job"; jobId: string }[]>([]);
  // When set, the next chat message is intercepted as a travel-doc reply
  const [pendingTravelDoc, setPendingTravelDoc] = useState<TravelDocRequest | null>(null);
  // Timestamp of last successful travel doc save — blocks re-trigger for 10s
  const travelDocSavedAtRef = useRef<number>(0);
  // NLU conversation history sent to /api/chat/parse. Assistant turns are
  // JSON-stringified so the LLM sees the same protocol it's asked to emit
  // (prevents mid-conversation fallback to plain text). Capped at 20 turns.
  const nluHistoryRef = useRef<ChatMessage[]>([]);

  // Load recent jobs for home page strip
  useEffect(() => {
    const sid = chat.getSessionId();
    if (!sid) return;
    fetch(`/api/booking-jobs?session_id=${encodeURIComponent(sid)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.jobs) setRecentJobs(d.jobs.slice(0, 3)); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 4.6: Call learnWeightsFromFeedback on mount
  useEffect(() => {
    learnWeightsFromFeedback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 3.3c: Feedback loop — called when user rates a restaurant card
  function handleCardFeedback(record: FeedbackRecord) {
    // Update persistent profile (localStorage + cloud) immediately
    learnFromFeedback(record);
    // Persist to DB (fire-and-forget, session-scoped)
    fetch("/api/feedback/inline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: chat.getSessionId(), feedback: record }),
    }).catch(() => {});
  }

  // Phase 5.3: Migrate localStorage data to cloud after sign-in
  useEffect(() => {
    if (auth.isSignedIn) {
      auth.migrateLocalDataToCloud();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isSignedIn]);

  // Phase 3.3b: Promote extracted session preferences into persistent profile
  // When 3.3a's AI extraction updates sessionPreferences, merge new signals
  // into the persistent UserPreferenceProfile (localStorage + cloud) so they
  // survive across sessions. Only writes fields not already explicitly set.
  useEffect(() => {
    const prefs = chat.sessionPreferences;
    if (prefs.refined_from_query_count === 0) return;

    const patch: Parameters<typeof updateProfile>[0] = {};
    if (prefs.noise_preference && !profile.noise_preference)
      patch.noise_preference = prefs.noise_preference;
    if (prefs.budget_ceiling && !profile.typical_budget_per_person)
      patch.typical_budget_per_person = prefs.budget_ceiling;
    if (prefs.exclude_chains && !profile.always_exclude_chains)
      patch.always_exclude_chains = true;
    if (prefs.excluded_cuisines.length > 0) {
      const newDislikes = prefs.excluded_cuisines.filter(
        (c) => !profile.cuisine_dislikes.includes(c)
      );
      if (newDislikes.length > 0)
        patch.cuisine_dislikes = [...profile.cuisine_dislikes, ...newDislikes];
    }

    if (Object.keys(patch).length > 0) updateProfile(patch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.sessionPreferences]);

  // 3c-3: Check for pending post-experience feedback prompts on mount
  useEffect(() => {
    const sessionId = chat.getSessionId();
    fetch(`/api/feedback-prompts?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.prompts?.length) {
          setPendingFeedbackPrompts(data.prompts);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.visibleCards]);

  // 新 task 卡片加入时延迟滚动，等卡片 DOM 渲染完再到底
  useEffect(() => {
    if (inlineItems.length === 0) return;
    const t = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
    return () => clearTimeout(t);
  }, [inlineItems.length]);

  useEffect(() => {
    setPlanFeedbackMessage(null);
  }, [chat.decisionPlan?.id]);

  useEffect(() => {
    chatInputRef.current = chat.input;
  }, [chat.input]);

  const hasMessages = chat.messages.length > 0;
  const lastUserQuery =
    [...chat.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const hasCategoryResults =
    chat.allCards.length > 0 ||
    chat.allHotelCards.length > 0 ||
    chat.allFlightCards.length > 0 ||
    chat.allCreditCardCards.length > 0 ||
    chat.allLaptopCards.length > 0 ||
    chat.allSmartphoneCards.length > 0 ||
    chat.allHeadphoneCards.length > 0 ||
    chat.allActivityCards.length > 0;
  // Concert event plans have map-able venue pins
  const concertVenuePins: MapPin[] = (() => {
    if (chat.resultMode !== "scenario_plan" || !chat.decisionPlan) return [];
    const plan = chat.decisionPlan;
    if (plan.scenario !== "concert_event") return [];
    const opts = [plan.primary_plan, ...(plan.backup_plans ?? [])].filter(Boolean);
    return opts
      .filter((o) => o.venue_lat != null && o.venue_lng != null)
      .map((o, i) => ({
        id: o.id,
        name: o.title,
        lat: o.venue_lat!,
        lng: o.venue_lng!,
        rank: i + 1,
        subtitle: o.subtitle ?? "",
      }));
  })();

  const isConcertMapMode =
    chat.resultMode === "scenario_plan" &&
    chat.viewMode === "map" &&
    concertVenuePins.length > 0;

  const isMapMode =
    (chat.resultMode === "category_cards" && chat.viewMode === "map" && hasCategoryResults) ||
    isConcertMapMode;

  // Unified map pins for restaurants, hotels, and concert venues
  const mapPins: MapPin[] = isConcertMapMode
    ? concertVenuePins
    : chat.resultCategory === "hotel"
    ? chat.allHotelCards
        .filter((c) => c.hotel.lat != null && c.hotel.lng != null)
        .map((c, i) => ({
          id: c.hotel.id,
          name: c.hotel.name,
          lat: c.hotel.lat!,
          lng: c.hotel.lng!,
          rank: i + 1,
          subtitle: c.hotel.price_per_night > 0 ? `$${c.hotel.price_per_night}/night` : "",
          rating: c.hotel.rating,
        }))
    : chat.allCards
        .filter((c) => c.restaurant.lat != null && c.restaurant.lng != null)
        .map((c, i) => ({
          id: c.restaurant.id,
          name: c.restaurant.name,
          lat: c.restaurant.lat!,
          lng: c.restaurant.lng!,
          rank: i + 1,
          subtitle: c.restaurant.cuisine ?? "",
          rating: c.restaurant.rating,
        }));

  // Hero tagline rotation — cycle every 4.5s with fade transition
  useEffect(() => {
    if (hasMessages) return;
    // Randomize starting index on client only (avoids SSR hydration mismatch)
    setHeroIdx(Math.floor(Math.random() * HERO_TAGLINES.length));
    const id = setInterval(() => {
      setHeroVisible(false);
      setTimeout(() => {
        setHeroIdx((i) => (i + 1) % HERO_TAGLINES.length);
        setHeroVisible(true);
      }, 500);
    }, 4500);
    return () => clearInterval(id);
  }, [hasMessages]);

  // Phase 4.3: Compare helpers
  function toggleCompare(card: CardType) {
    setCompareSelection((prev) => {
      const existingIdx = prev.findIndex((c) => c?.restaurant.id === card.restaurant.id);
      if (existingIdx >= 0) {
        // Remove from compare
        const next = [...prev];
        next[existingIdx] = null;
        return next;
      }
      // Add to first empty slot
      const emptyIdx = prev.findIndex((c) => c === null);
      if (emptyIdx >= 0) {
        const next = [...prev];
        next[emptyIdx] = card;
        return next;
      }
      // Replace slot 1 (keep slot 0)
      return [prev[0], card];
    });
  }

  function updateChatInput(value: string) {
    chatInputRef.current = value;
    chat.setInput(value);
  }

  function parseTravelDocs(text: string): { dob?: string; passport?: string } {
    const dobMatch = text.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
    const passportMatch = text.match(/\b([A-Za-z]{1,2}\d{6,9})\b/);
    return {
      dob: dobMatch ? dobMatch[1].replace(/\//g, "-") : undefined,
      passport: passportMatch ? passportMatch[1].toUpperCase() : undefined,
    };
  }

  async function handleTravelDocReply(text: string, req: TravelDocRequest) {
    // Show user's message in chat
    chat.injectUserMessage(text);
    chat.setInput("");
    chatInputRef.current = "";

    const { dob, passport } = parseTravelDocs(text);

    if (!dob || !passport) {
      chat.injectAssistantMessage(
        "I couldn't find a valid date of birth (YYYY-MM-DD) and passport number in your message. Could you try again? For example: \"2001-09-05, passport EJ2676174\""
      );
      return; // keep pendingTravelDoc active so they can retry
    }

    // Save to profile
    try {
      const saveRes = await fetch(`/api/user/booking-profiles/${req.profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_of_birth: dob, passport_number: passport }),
      });
      if (!saveRes.ok) {
        chat.injectAssistantMessage("Sorry, I couldn't save your travel documents. Please try again.");
        return;
      }
    } catch {
      chat.injectAssistantMessage("Network error saving your documents. Please try again.");
      return;
    }

    // Clear pending context and record save time (10s cooldown blocks accidental re-sends)
    setPendingTravelDoc(null);
    travelDocSavedAtRef.current = Date.now();

    // Restart the booking job
    await fetch(`/api/booking-jobs/${req.jobId}/start`, { method: "POST" }).catch(() => {});

    chat.injectAssistantMessage(
      `Got it — travel documents saved. Retrying your flight booking now…`
    );
  }

  async function sendCurrentInput() {
    const text = chatInputRef.current.trim();
    if (!text || chat.loading || isListening || nluPending) return;

    // If we're waiting for travel doc info, intercept the message
    if (pendingTravelDoc) {
      handleTravelDocReply(text, pendingTravelDoc);
      return;
    }

    // Within 10s of a successful save, silently drop messages that look like
    // travel doc info (accidental double-sends after the first succeeded)
    const secsSinceSave = (Date.now() - travelDocSavedAtRef.current) / 1000;
    if (secsSinceSave < 10 && parseTravelDocs(text).passport) {
      chat.injectAssistantMessage("Your travel documents are already saved — no need to resend.");
      chat.setInput("");
      chatInputRef.current = "";
      return;
    }

    // P1-15 unified entry: every user utterance is first routed through
    // /api/chat/parse. Based on the NLU intent we either create a Decision
    // Room (confirm card), pass-through to the old search (create_plan), or
    // just show a conversational reply (chitchat / clarify).
    chatInputRef.current = "";
    chat.setInput("");
    setPendingConfirm(null);
    setPendingQuickPicks(null);

    // Echo user message immediately so the UX stays snappy during the NLU call.
    chat.injectUserMessage(text);
    setNluPending(true);

    try {
      const cfg = loadAgentModelConfig();
      const historyToSend = nluHistoryRef.current.slice();
      const res = await fetch("/api/chat/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: historyToSend,
          userModel: cfg.conversational,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; result: ConversationalNLUResult }
        | null;

      // Network / NLU failure → fall back to the old restaurant search pipeline
      // so the user still gets results rather than a dead chat.
      if (!data || !data.ok) {
        learnFromSearch(text);
        chat.sendMessage(text, undefined, { skipUserPush: true });
        return;
      }

      const nlu = data.result;

      // Record this turn into the NLU history *after* a successful parse.
      // Assistant content is the slim NLU JSON so follow-up turns see state
      // (scenario, collected_constraints, missing_fields) not just rendered text.
      nluHistoryRef.current.push({ role: "user", content: text });
      nluHistoryRef.current.push({
        role: "assistant",
        content: JSON.stringify({
          intent: nlu.intent,
          scenario: nlu.scenario,
          party_type: nlu.party_type,
          member_names: nlu.member_names,
          collected_constraints: nlu.collected_constraints,
          missing_fields: nlu.missing_fields,
          confirm_ready: nlu.confirm_ready,
          assistant_reply: nlu.assistant_reply,
        }),
      });
      if (nluHistoryRef.current.length > 20) {
        nluHistoryRef.current = nluHistoryRef.current.slice(-20);
      }

      // Trip scenario runs through a dedicated package planner (not the legacy
      // search). Surface a ConfirmCard so the user can review what we captured
      // before we spend 10-15s running hotel+flight pipelines in parallel.
      if (nlu.intent === "create_plan" && nlu.confirm_ready && nlu.scenario === "trip") {
        if (nlu.assistant_reply) chat.injectAssistantMessage(nlu.assistant_reply);
        setPendingConfirm({ nlu, message: text, kind: "trip" });
        return;
      }

      // create_plan + confirm_ready → pass the raw user query to the legacy
      // search pipeline; it already renders RecommendationCards etc. for
      // restaurant / hotel / flight / activity solo cases.
      if (nlu.intent === "create_plan" && nlu.confirm_ready) {
        learnFromSearch(text);
        const hint =
          nlu.scenario === "restaurant" ||
          nlu.scenario === "hotel" ||
          nlu.scenario === "flight" ||
          nlu.scenario === "activity"
            ? nlu.scenario
            : undefined;
        chat.sendMessage(text, undefined, { skipUserPush: true, categoryHint: hint });
        return;
      }

      // Everything else: inject the assistant reply as a bubble. Optionally
      // render a confirm card (create_room confirm_ready) or quick-pick chips
      // (any missing-fields clarify).
      if (nlu.assistant_reply) {
        chat.injectAssistantMessage(nlu.assistant_reply);
      }

      if (nlu.intent === "create_room" && nlu.confirm_ready) {
        setPendingConfirm({ nlu, message: text, kind: "room" });
      } else if (nlu.intent === "create_plan" && nlu.confirm_ready) {
        // Safety net — shouldn't reach here given the early return above.
        setPendingConfirm({ nlu, message: text, kind: "plan" });
      } else if (nlu.suggested_quick_picks && nlu.suggested_quick_picks.length > 0) {
        setPendingQuickPicks(nlu.suggested_quick_picks);
      } else if (looksLikeRecommendationAsk(text)) {
        // Safety net: user clearly asked for a recommendation ("随便 / 你推荐一下")
        // but the LLM forgot to produce quick_picks. Inject hardcoded defaults
        // based on the detected scenario so the user still gets tappable buttons.
        const fallback = getFallbackQuickPicks(nlu.scenario);
        if (fallback) setPendingQuickPicks(fallback);
      }
    } catch {
      // Parse call blew up — don't swallow the user query, fall back to old search.
      learnFromSearch(text);
      chat.sendMessage(text, undefined, { skipUserPush: true });
    } finally {
      setNluPending(false);
    }
  }

  function handleQuickPick(value: string) {
    setPendingQuickPicks(null);
    chatInputRef.current = value;
    chat.setInput(value);
    void sendCurrentInput();
  }

  function handleConfirmCommitted(payload: CommitResponse) {
    setPendingConfirm(null);
    // Room created or plan dispatched — current NLU thread is finished; clear
    // the history so the next utterance starts a fresh conversation.
    nluHistoryRef.current = [];
    if (payload.kind === "room" && payload.url) {
      router.push(payload.url);
      return;
    }
    if (payload.kind === "trip" && payload.trip_state) {
      void runTripPlanner(payload.trip_state, payload.search_query ?? "");
      return;
    }
    if (payload.kind === "trip_clarify") {
      // Defensive backend response — surface the clarification inline so the
      // user can fill in the missing bits and re-commit.
      chat.injectAssistantMessage(
        payload.message ?? "I need a couple more details before I can package this trip."
      );
      return;
    }
    if (payload.kind === "plan") {
      const query = payload.search_query ?? "";
      if (query) {
        learnFromSearch(query);
        chat.sendMessage(query, undefined, { skipUserPush: true });
      }
    }
  }

  async function runTripPlanner(state: TripIntentState, searchQuery: string) {
    setTripFlow({ phase: "planning" });
    chat.injectAssistantMessage(
      searchQuery
        ? `Packaging your trip — hitting hotel + flight in parallel. This usually takes 10-15s…`
        : `Packaging your trip — this usually takes 10-15s…`
    );
    try {
      const res = await fetch("/api/chat/trip/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip_state: state }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        trip_package?: TripPackage;
        errors?: { hotel?: string | null; flight?: string | null; restaurant?: string | null; activity?: string | null };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.trip_package) {
        setTripFlow({
          phase: "error",
          message: data.error ?? "Trip planner failed. Try again in a minute.",
        });
        chat.injectAssistantMessage(
          `Trip planner hit a snag: ${data.error ?? "unknown error"}. Try a different date or city?`
        );
        return;
      }
      setTripFlow({
        phase: "ready",
        pkg: data.trip_package,
        errors: data.errors,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setTripFlow({ phase: "error", message });
      chat.injectAssistantMessage(`Trip planner hit a snag: ${message}`);
    }
  }

  function handleConfirmEdit() {
    setPendingConfirm(null);
    chat.injectAssistantMessage("No problem — what would you like to change?");
  }

  function isComparing(card: CardType) {
    return compareSelection.some((c) => c?.restaurant.id === card.restaurant.id);
  }

  // Phase 4.5: Updated share button — also generate base64 share URL
  function handleShare() {
    // Existing: copy URL with query param
    chat.shareResults(lastUserQuery);

    // Also generate base64 share URL for top 3
    if (chat.allCards.length > 0) {
      const top3 = chat.allCards.slice(0, 3).map((c) => ({
        name: c.restaurant.name,
        rank: c.rank,
        why_recommended: c.why_recommended,
        score: c.score,
      }));
      const token = btoa(JSON.stringify(top3));
      // Update URL to shareable share page
      const shareUrl = `${window.location.origin}/share/${token}`;
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
  }

  async function handlePlanAction(action: PlanAction) {
    if (action.type === "share_plan") {
      chat.trackDecisionPlanEvent({
        type: "action_clicked",
        action_id: action.id,
        option_id: chat.decisionPlan?.primary_plan.id,
        query: lastUserQuery,
      });

      if (!chat.decisionPlan) throw new Error("No plan to share");

      const res = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: chat.decisionPlan,
          session_id: chat.getSessionId(),
          query_text: lastUserQuery,
          parent_plan_id: refinedFromPlanIdRef.current ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      refinedFromPlanIdRef.current = null;

      const shareUrl = `${window.location.origin}/plan/${chat.decisionPlan.id}`;
      await navigator.clipboard.writeText(shareUrl);

      setPlanFeedbackMessage(
        buildPlanFeedbackCopy(chat.decisionPlan?.output_language, "shared")
      );
      return;
    }

    if (action.type === "send_for_vote") {
      chat.trackDecisionPlanEvent({
        type: "action_clicked",
        action_id: action.id,
        option_id: chat.decisionPlan?.primary_plan.id,
        query: lastUserQuery,
      });

      if (!chat.decisionPlan) throw new Error("No plan to share for vote");

      // Mark vote_mode on the plan before saving
      const voteModePlan = { ...chat.decisionPlan, vote_mode: true };
      const res = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: voteModePlan,
          session_id: chat.getSessionId(),
          query_text: lastUserQuery,
          parent_plan_id: refinedFromPlanIdRef.current ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);

      const voteUrl = `${window.location.origin}/plan/${voteModePlan.id}?vote=true`;
      await navigator.clipboard.writeText(voteUrl);

      setPlanFeedbackMessage(
        chat.decisionPlan.output_language === "zh"
          ? "Vote link copied — send it to your friend!"
          : "Vote link copied — send it to your friends!"
      );
      return;
    }

    if (action.type === "watch_price") {
      if (!chat.decisionPlan) throw new Error("No plan to watch");

      // Request push notification permission to deliver price drop alerts
      subscribeToPushNotifications(chat.getSessionId(), userId).catch(() => {});

      // Save the plan first so it persists
      const saveRes = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: chat.decisionPlan,
          session_id: chat.getSessionId(),
          query_text: lastUserQuery,
          parent_plan_id: refinedFromPlanIdRef.current ?? undefined,
        }),
      });
      if (!saveRes.ok) throw new Error(`Save failed: ${saveRes.status}`);

      // Build a price watch item from the primary plan's estimated total
      const primary = chat.decisionPlan.primary_plan;
      const rawTotal = primary.estimated_total ?? "";
      const priceNum = parseFloat(rawTotal.replace(/[^0-9.]/g, "")) || 0;

      if (priceNum > 0) {
        const watchItem = {
          item_type: chat.decisionPlan.scenario === "big_purchase" ? "hotel" : "hotel" as const,
          item_key: primary.id,
          item_label: primary.title,
          last_known_price: priceNum,
        };
        // Fire-and-forget — don't block UI on this
        fetch(`/api/plan/${chat.decisionPlan.id}/price-watch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: chat.getSessionId(),
            items: [watchItem],
          }),
        }).catch(() => {});
      }

      const lang = chat.decisionPlan.output_language;
      setPlanFeedbackMessage(
        lang === "zh"
          ? "Watching prices — you'll get a push notification if prices drop more than 10%"
          : "Watching prices — you'll get a push notification if prices drop more than 10%"
      );
      return;
    }

    if (action.type === "export_brief") {
      if (!chat.decisionPlan) throw new Error("No plan to export");

      // Save the plan so the brief route can read it from DB
      const res = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: chat.decisionPlan,
          session_id: chat.getSessionId(),
          query_text: lastUserQuery,
          parent_plan_id: refinedFromPlanIdRef.current ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);

      window.open(`/api/plan/${chat.decisionPlan.id}/brief`, "_blank");
      return;
    }

    if (action.type === "swap_backup" && action.option_id) {
      chat.trackDecisionPlanEvent({
        type: "backup_promoted",
        option_id: action.option_id,
        action_id: action.id,
        query: lastUserQuery,
      });
      chat.swapDecisionPlanOption(action.option_id);
      setPlanFeedbackMessage(
        buildPlanFeedbackCopy(chat.decisionPlan?.output_language, "promoted")
      );
      return;
    }

    if (action.type === "approve_plan") {
      chat.trackDecisionPlanEvent({
        type: "plan_approved",
        action_id: action.id,
        option_id: chat.decisionPlan?.primary_plan.id,
        query: lastUserQuery,
      });
      setPlanFeedbackMessage(
        buildPlanFeedbackCopy(chat.decisionPlan?.output_language, "approved")
      );
      return;
    }

    if (action.type === "request_changes") {
      chat.trackDecisionPlanEvent({
        type: "feedback_negative",
        action_id: action.id,
        option_id: chat.decisionPlan?.primary_plan.id,
        query: lastUserQuery,
      });
      setPlanFeedbackMessage(
        buildPlanFeedbackCopy(chat.decisionPlan?.output_language, "needs_changes")
      );
      return;
    }

    if (action.type === "refine" && action.prompt) {
      chat.trackDecisionPlanEvent({
        type: "action_clicked",
        action_id: action.id,
        option_id: chat.decisionPlan?.primary_plan.id,
        query: lastUserQuery,
        metadata: { prompt: action.prompt },
      });
      // Store current plan ID so it can be passed as parent_plan_id when the refined plan is saved
      refinedFromPlanIdRef.current = chat.decisionPlan?.id ?? null;
      setPlanFeedbackMessage(
        buildPlanFeedbackCopy(
          chat.decisionPlan?.output_language,
          "refining",
          action.label
        )
      );
      learnFromSearch(action.prompt);
      // G-3: pass pinned_plan_id so agent can do module-level refine
      chat.sendMessage(action.prompt, refinedFromPlanIdRef.current ?? undefined);
    }
  }

  async function handleFeedbackResponse(
    promptId: number,
    planId: string,
    feedback: PostExperienceFeedback
  ) {
    setPendingFeedbackPrompts((prev) => prev.filter((p) => p.id !== promptId));
    fetch("/api/feedback-prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt_id: promptId,
        plan_id: planId,
        session_id: chat.getSessionId(),
        feedback,
      }),
    }).catch(() => {});
  }

  function handlePlanLinkClick(action: PlanLinkAction, optionId: string) {
    chat.trackDecisionPlanEvent({
      type: "action_clicked",
      action_id: action.id,
      option_id: optionId,
      query: lastUserQuery,
      metadata: { label: action.label, url: action.url },
    });
  }

  // Phase 4.3: request_id is available in complete event; track it
  // (We track it via suggestedRefinements being set when complete arrives)
  // We pass requestId=undefined for now (it's in the SSE data but not surfaced here)

  // Shared filter/view bar rendered in both list and map contexts
  const filterViewBar =
    ((chat.resultCategory === "restaurant" && chat.allCards.length > 0) ||
      (chat.resultCategory === "hotel" && chat.allHotelCards.length > 0)) && (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {/* View toggle */}
        <div
          className="flex gap-1 rounded-xl p-1"
          style={{
            backgroundColor: "var(--card)",
            border: "0.5px solid var(--border)",
          }}
        >
          {(["list", "map"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => chat.setViewMode(mode)}
              aria-pressed={chat.viewMode === mode}
              className="px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize"
              style={{
                backgroundColor:
                  chat.viewMode === mode ? "var(--gold)" : "transparent",
                color:
                  chat.viewMode === mode ? "#fff" : "var(--text-secondary)",
                fontFamily: "var(--font-dm-sans)",
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Share button */}
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 text-xs rounded-xl px-3 py-1.5 transition-colors"
          style={{
            color: "var(--text-secondary)",
            border: "0.5px solid var(--border)",
            fontFamily: "var(--font-dm-sans)",
            backgroundColor: "var(--card)",
          }}
        >
          ↗ Share
        </button>
      </div>

      {/* Filter chips — hidden in map mode */}
      {!isMapMode && (
        <div className="flex gap-2 flex-wrap">
          {chat.priceOptions.map((price) => (
            <button
              key={price}
              onClick={() =>
                chat.setActivePrice(
                  chat.activePrice === price ? null : price
                )
              }
              aria-pressed={chat.activePrice === price}
              style={{
                backgroundColor:
                  chat.activePrice === price ? "var(--gold)" : "var(--card)",
                color:
                  chat.activePrice === price ? "#fff" : "var(--text-secondary)",
                border: `0.5px solid ${chat.activePrice === price ? "var(--gold)" : "var(--border)"}`,
                fontFamily: "var(--font-dm-sans)",
                borderRadius: "20px",
                padding: "5px 12px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {price}
            </button>
          ))}
          {chat.cuisineOptions.map((cuisine) => (
            <button
              key={cuisine}
              onClick={() =>
                chat.setActiveCuisine(
                  chat.activeCuisine === cuisine ? null : cuisine
                )
              }
              aria-pressed={chat.activeCuisine === cuisine}
              style={{
                backgroundColor:
                  chat.activeCuisine === cuisine
                    ? "var(--gold)"
                    : "var(--card)",
                color:
                  chat.activeCuisine === cuisine
                    ? "#fff"
                    : "var(--text-secondary)",
                border: `0.5px solid ${chat.activeCuisine === cuisine ? "var(--gold)" : "var(--border)"}`,
                fontFamily: "var(--font-dm-sans)",
                borderRadius: "20px",
                padding: "5px 12px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {cuisine}
            </button>
          ))}
        </div>
      )}

      {/* Phase 4.3: Suggested refinement chips — hidden in map mode */}
      {!isMapMode && chat.suggestedRefinements.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {chat.suggestedRefinements.map((refinement) => (
            <button
              key={refinement}
              onClick={() => {
                learnFromSearch(refinement);
                chat.sendMessage(refinement);
              }}
              style={{
                backgroundColor: "var(--card-2)",
                color: "var(--text-secondary)",
                border: "0.5px solid var(--border)",
                fontFamily: "var(--font-dm-sans)",
                borderRadius: "20px",
                padding: "5px 12px",
                fontSize: "12px",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
              }}
            >
              {refinement}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <main
      className="flex flex-col"
      style={{ height: "100dvh", backgroundColor: "var(--bg)", overflow: "hidden" }}
    >
      {/* GPS Error Toast */}
      {location.gpsError && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm shadow-lg"
          style={{
            backgroundColor: "#FDF6EC",
            border: "1px solid #E8A020",
            color: "#8B5E14",
            fontFamily: "var(--font-dm-sans)",
          }}
        >
          {location.gpsError}
        </div>
      )}

      {/* Share Toast */}
      {chat.shareToast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm shadow-lg"
          style={{
            backgroundColor: "var(--text-primary)",
            color: "var(--bg)",
            fontFamily: "var(--font-dm-sans)",
          }}
        >
          Link copied to clipboard
        </div>
      )}

      {/* ─── Taste Profile Modal ──────────────────── */}
      {false && prefModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPrefModalOpen(false);
              setEditingPrefId(null);
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl overflow-y-auto"
            style={{
              backgroundColor: "var(--card)",
              maxHeight: "85dvh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 20px 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: "var(--font-playfair)",
                    fontSize: "20px",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "2px",
                  }}
                >
                  Taste Profile
                </h2>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: "var(--text-muted)" }}>
                  {(profile.discovered ?? []).length > 0
                    ? `${(profile.discovered ?? []).length} signals discovered from your conversations`
                    : "Discovered automatically as you chat"}
                </p>
              </div>
              <button
                onClick={() => { setPrefModalOpen(false); setEditingPrefId(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: "20px", lineHeight: 1, padding: "4px" }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "16px 20px 20px", overflowY: "auto", flex: 1 }}>

              {/* Empty state */}
              {(profile.discovered ?? []).length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "32px 16px",
                    backgroundColor: "var(--card-2)",
                    borderRadius: "12px",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>✨</div>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    Start chatting — we&apos;ll build your taste profile automatically
                  </p>
                  <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
                    Ask about restaurants, hotels, flights, gifts...
                  </p>
                </div>
              )}

              {/* Preference Map by category */}
              {(["dining", "travel", "hotels", "shopping", "general"] as const).map((cat) => {
                const catEmoji: Record<string, string> = { dining: "🍽", travel: "✈️", hotels: "🏨", shopping: "🛍", general: "⭐" };
                const catLabel: Record<string, string> = { dining: "Dining", travel: "Travel", hotels: "Hotels", shopping: "Shopping", general: "General" };
                const items = (profile.discovered ?? []).filter((p) => p.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} style={{ marginBottom: "18px" }}>
                    <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                      {catEmoji[cat]} {catLabel[cat]}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {items.map((pref) => {
                        const isEditing = editingPrefId === pref.id;
                        const confidence = pref.seen_count >= 3 ? "green" : pref.seen_count >= 2 ? "#f59e0b" : "var(--text-muted)";
                        return (
                          <div
                            key={pref.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: isEditing ? "3px 6px" : "4px 10px",
                              borderRadius: "20px",
                              border: `0.5px solid ${pref.user_confirmed ? "var(--gold)" : "var(--border)"}`,
                              backgroundColor: pref.user_confirmed ? "rgba(var(--gold-rgb, 180,120,60),0.1)" : "var(--card-2)",
                            }}
                          >
                            {/* Confidence dot */}
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: confidence, flexShrink: 0, display: "inline-block" }} />

                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingPrefValue}
                                onChange={(e) => setEditingPrefValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && editingPrefValue.trim()) {
                                    updateDiscoveredPreference(pref.id, { value: editingPrefValue.trim(), user_confirmed: true });
                                    setEditingPrefId(null);
                                  } else if (e.key === "Escape") {
                                    setEditingPrefId(null);
                                  }
                                }}
                                style={{
                                  fontFamily: "var(--font-dm-sans)",
                                  fontSize: "12px",
                                  color: "var(--text-primary)",
                                  background: "none",
                                  border: "none",
                                  outline: "none",
                                  width: "120px",
                                }}
                              />
                            ) : (
                              <span
                                title={`${pref.label}: ${pref.value}\nSeen ${pref.seen_count}x · from ${pref.source}`}
                                style={{ fontFamily: "var(--font-dm-sans)", fontSize: "12px", color: "var(--text-primary)", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              >
                                {pref.label}: <span style={{ color: "var(--text-secondary)" }}>{pref.value}</span>
                              </span>
                            )}

                            {/* Edit button */}
                            {!isEditing && (
                              <button
                                onClick={() => { setEditingPrefId(pref.id); setEditingPrefValue(pref.value); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0 2px", fontSize: "11px", lineHeight: 1 }}
                                title="Edit"
                              >
                                ✏️
                              </button>
                            )}
                            {isEditing && (
                              <button
                                onClick={() => {
                                  if (editingPrefValue.trim()) {
                                    updateDiscoveredPreference(pref.id, { value: editingPrefValue.trim(), user_confirmed: true });
                                  }
                                  setEditingPrefId(null);
                                }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--gold)", padding: "0 2px", fontSize: "11px", fontWeight: 600 }}
                              >
                                ✓
                              </button>
                            )}

                            {/* Remove button */}
                            <button
                              onClick={() => removeDiscoveredPreference(pref.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0 2px", fontSize: "10px", lineHeight: 1 }}
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Divider before manual settings */}
              {(profile.discovered ?? []).length > 0 && (
                <div style={{ height: "0.5px", backgroundColor: "var(--border)", margin: "4px 0 18px" }} />
              )}

              {/* Dietary restrictions — manual */}
              <div style={{ marginBottom: "16px" }}>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                  🥗 Dietary restrictions
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {DIETARY_OPTIONS.map((d) => {
                    const active = profile.dietary_restrictions.includes(d);
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          const next = active
                            ? profile.dietary_restrictions.filter((x) => x !== d)
                            : [...profile.dietary_restrictions, d];
                          updateProfile({ dietary_restrictions: next });
                        }}
                        style={{
                          padding: "4px 12px",
                          borderRadius: "20px",
                          border: `0.5px solid ${active ? "var(--gold)" : "var(--border)"}`,
                          backgroundColor: active ? "var(--gold)" : "var(--card-2)",
                          color: active ? "#fff" : "var(--text-secondary)",
                          cursor: "pointer",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: "12px",
                        }}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div
              style={{
                padding: "12px 20px 16px",
                borderTop: "0.5px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: "var(--text-muted)" }}>
                {(profile.discovered ?? []).length > 0
                  ? `Updated ${new Date(profile.updated_at).toLocaleDateString()}`
                  : "No signals yet"}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                {(profile.discovered ?? []).length > 0 && (
                  <button
                    onClick={() => {
                      updateProfile({ discovered: [] });
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "0.5px solid var(--border)",
                      backgroundColor: "transparent",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "12px",
                    }}
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => { setPrefModalOpen(false); setEditingPrefId(null); }}
                  style={{
                    padding: "6px 16px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "var(--gold)",
                    color: "#fff",
                    cursor: "pointer",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "12px",
                    fontWeight: 500,
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Compare Bottom Sheet (Phase 4.3) ──────────────────── */}
      {compareOpen && compareSelection.some((c) => c !== null) && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCompareOpen(false);
          }}
        >
          <div
            className="w-full max-w-2xl rounded-t-2xl overflow-y-auto"
            style={{
              backgroundColor: "var(--card)",
              maxHeight: "70dvh",
              padding: "20px 16px",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                style={{
                  fontFamily: "var(--font-playfair)",
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Compare
              </h3>
              <button
                onClick={() => setCompareOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontSize: "20px",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {compareSelection.map((card, idx) =>
                card ? (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: "var(--card-2)",
                      borderRadius: "12px",
                      border: "0.5px solid var(--border)",
                      padding: "14px",
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "var(--font-playfair)",
                        fontSize: "15px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        marginBottom: "4px",
                      }}
                    >
                      {card.restaurant.name}
                    </p>
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        marginBottom: "12px",
                      }}
                    >
                      {card.restaurant.cuisine} · {card.restaurant.price}
                    </p>
                    {card.scoring && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {(["scene_match", "budget_match", "review_quality", "location_convenience", "preference_match"] as const).map((key) => {
                          const val = card.scoring![key];
                          const pct = Math.round((val / 10) * 100);
                          return (
                            <div key={key}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                                <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "10px", color: "var(--text-secondary)" }}>
                                  {WEIGHT_LABELS[key]}
                                </span>
                                <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "10px", color: "var(--gold)" }}>
                                  {val.toFixed(1)}
                                </span>
                              </div>
                              <div style={{ height: "3px", backgroundColor: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", backgroundColor: "var(--gold)", borderRadius: "2px" }} />
                              </div>
                            </div>
                          );
                        })}
                        <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: "12px", fontWeight: 600, color: "var(--gold)", marginTop: "4px" }}>
                          Score {card.scoring.weighted_total.toFixed(1)}
                        </p>
                      </div>
                    )}
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        lineHeight: 1.5,
                        marginTop: "8px",
                      }}
                    >
                      {card.why_recommended}
                    </p>
                  </div>
                ) : (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: "var(--card-2)",
                      borderRadius: "12px",
                      border: "0.5px dashed var(--border)",
                      padding: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "12px",
                    }}
                  >
                    Click "Compare" on a card to add it here
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Nav ─────────────────────────────────────────────── */}
      <GlobalNav active="home" />

      {/* Phase 5.3: Upgrade prompt toast (shown after 3rd favorite when not signed in) */}
      {upgradePromptShown && !auth.isSignedIn && (
        <div
          style={{
            position: "fixed",
            bottom: "80px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "var(--card)",
            border: "0.5px solid var(--gold)",
            borderRadius: "12px",
            padding: "10px 16px",
            zIndex: 100,
            boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
            maxWidth: "320px",
            width: "calc(100% - 32px)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "13px",
              color: "var(--text-primary)",
              flex: 1,
            }}
          >
            Save to cloud — access your favorites from any device
          </span>
          <button
            onClick={() => { auth.signIn(); setUpgradePromptShown(false); }}
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: "12px",
              color: "#fff",
              backgroundColor: "var(--gold)",
              border: "none",
              borderRadius: "8px",
              padding: "4px 10px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {tn.signIn}
          </button>
          <button
            onClick={() => setUpgradePromptShown(false)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: "16px", padding: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* ─── Map Mode ───────────────────────────────────────── */}
      {isMapMode && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            className="flex-shrink-0 px-4 py-2 border-b"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
            }}
          >
            {filterViewBar}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <MapView
              pins={mapPins}
              center={location.mapCenter}
              label={chat.resultCategory === "hotel" ? "Hotel" : "Restaurant"}
              flightCards={chat.resultCategory === "flight" ? chat.allFlightCards : undefined}
            />
          </div>
        </div>
      )}

      {/* ─── List Mode ──────────────────────────────────────── */}
      {!isMapMode && (
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
          <div className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto w-full px-4 md:px-6 lg:px-8 py-6">

            {!hasMessages ? (
              /* Welcome / Hero State */
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                {/* City name embedded in headline */}
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <h2
                    style={{
                      fontFamily: "var(--font-playfair)",
                      fontSize: "clamp(28px, 5vw, 42px)",
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      lineHeight: 1.15,
                      marginBottom: 12,
                      opacity: heroVisible ? 1 : 0,
                      transform: heroVisible ? "translateY(0)" : "translateY(-10px)",
                      transition: "opacity 0.5s ease, transform 0.5s ease",
                    }}
                  >
                    {th.taglines[heroIdx].headline[0]}<br />
                    {th.taglines[heroIdx].headline[1]}
                  </h2>

                  {/* City selector */}
                  <button
                    onClick={() => location.setLocationOpen((o) => !o)}
                    style={{
                      fontFamily: "var(--font-playfair)",
                      fontSize: "clamp(20px, 3.5vw, 30px)",
                      fontWeight: 700,
                      color: location.cityId || location.isNearMe ? "var(--gold)" : "var(--text-secondary)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      borderBottom: "2px solid transparent",
                      transition: "border-color 0.15s, opacity 0.15s",
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: "0.25em",
                      opacity: heroVisible ? 1 : 0,
                      transform: heroVisible ? "translateY(0)" : "translateY(-10px)",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderBottomColor = "var(--gold)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderBottomColor = "transparent"; }}
                  >
                    {location.isNearMe
                      ? "Near Me"
                      : location.cityId
                        ? (CITIES_SORTED.find(c => c.id === location.cityId)?.label ?? "your city")
                        : "your city"}
                    <span style={{ fontSize: "0.4em", verticalAlign: "middle", opacity: 0.5 }}>▾</span>
                  </button>

                  {/* City dropdown */}
                  {location.locationOpen && (
                    <>
                      <div onClick={() => location.setLocationOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
                      <div
                        role="listbox"
                        aria-label="City selection"
                        style={{
                          position: "absolute", left: "50%", transform: "translateX(-50%)",
                          top: "calc(100% + 8px)", zIndex: 50,
                          backgroundColor: "var(--card)", border: "0.5px solid var(--border)",
                          borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
                          maxHeight: 280, overflowY: "auto", minWidth: 200,
                          textAlign: "left",
                        }}
                      >
                        {location.supportsGps && (
                          <button
                            role="option"
                            aria-selected={location.isNearMe}
                            onMouseDown={() => { location.suppressNextBlur(); location.requestGps(); location.setLocationOpen(false); location.updateLocationInput(""); }}
                            style={{
                              display: "block", width: "100%", textAlign: "left",
                              padding: "10px 16px", background: "none",
                              border: "none", borderBottom: "0.5px solid var(--border)",
                              fontFamily: "var(--font-dm-sans)", fontSize: 13,
                              color: "var(--gold)", cursor: "pointer",
                            }}
                          >
                            ⊕ Use My Location
                          </button>
                        )}
                        {CITIES_SORTED.map((c) => (
                          <button
                            key={c.id}
                            role="option"
                            aria-selected={c.id === location.cityId}
                            onMouseDown={() => { location.suppressNextBlur(); location.handleCitySelect(c.id); location.setLocationOpen(false); location.updateLocationInput(""); }}
                            style={{
                              display: "block", width: "100%", textAlign: "left",
                              padding: "9px 16px", background: "none", border: "none",
                              fontFamily: "var(--font-dm-sans)", fontSize: 13,
                              color: c.id === location.cityId ? "var(--gold)" : "var(--text-primary)",
                              fontWeight: c.id === location.cityId ? 600 : 400,
                              cursor: "pointer",
                            }}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: "15px",
                    lineHeight: 1.7,
                    maxWidth: "340px",
                    marginBottom: "40px",
                    fontFamily: "var(--font-dm-sans)",
                    opacity: heroVisible ? 1 : 0,
                    transform: heroVisible ? "translateY(0)" : "translateY(-10px)",
                    transition: "opacity 0.5s ease 0.06s, transform 0.5s ease 0.06s",
                  }}
                >
                  {th.taglines[heroIdx].sub}
                </p>

                {/* Scenario quick-start cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%", maxWidth: 440, marginBottom: 24 }}>
                  {th.scenarios.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => { learnFromSearch(s.msg); chat.sendMessage(s.msg); }}
                      style={{
                        textAlign: "left", borderRadius: 14, padding: "14px 14px",
                        backgroundColor: "var(--card)", border: "0.5px solid var(--border)",
                        cursor: "pointer", transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
                    >
                      <div style={{ fontSize: 22, marginBottom: 6 }}>{s.emoji}</div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontWeight: 700, fontSize: 13, color: "var(--text-primary)", marginBottom: 2 }}>{s.label}</div>
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary)" }}>{s.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Example prompts */}
                <div className="flex flex-col gap-2 w-full max-w-sm">
                  {th.examples.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => {
                        learnFromSearch(ex);
                        chat.sendMessage(ex);
                      }}
                      className="text-left rounded-2xl px-4 py-3 transition-all"
                      style={{
                        backgroundColor: "var(--card)",
                        border: "0.5px solid var(--border)",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: "13px",
                        lineHeight: 1.5,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                      }}
                    >
                      &quot;{ex}&quot;
                    </button>
                  ))}
                </div>

                {/* Decision Rooms entry — multi-party booking (Phase 1) */}
                <div style={{ width: "100%", maxWidth: 440, marginTop: 28 }}>
                  <Link
                    href="/rooms"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "14px 16px",
                      borderRadius: 14,
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      textDecoration: "none",
                      transition: "border-color 120ms",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                    }}
                  >
                    <span style={{ fontSize: 22, lineHeight: 1 }}>🗣️</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontFamily: "var(--font-dm-sans)", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                        Decision Rooms
                      </p>
                      <p style={{ margin: "2px 0 0", fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--text-secondary)" }}>
                        Decide together — dinner, hotel, trips
                      </p>
                    </div>
                    <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--gold)", flexShrink: 0 }}>
                      Open →
                    </span>
                  </Link>
                </div>

                {/* Recent tasks strip */}
                {recentJobs.length > 0 && (
                  <div style={{ width: "100%", maxWidth: 440, marginTop: 28 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {th.recentTrips}
                      </p>
                      <a href="/tasks" style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--gold)", textDecoration: "none" }}>
                        {th.viewAll}
                      </a>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {recentJobs.map((job) => {
                        const statusMeta: Record<string, { dot: string; label: string }> = {
                          pending:    { dot: "#aaa",      label: th.pending },
                          running:    { dot: "#C9A84C",   label: th.inProgress },
                          done:       { dot: "#22c55e",   label: th.completed },
                          partial:    { dot: "#f59e0b",   label: th.partial },
                          failed:     { dot: "#ef4444",   label: th.failed },
                        };
                        const sm = statusMeta[job.status] ?? statusMeta.pending;
                        return (
                          <a key={job.id} href="/tasks" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, backgroundColor: "var(--card)", border: "0.5px solid var(--border)" }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: sm.dot, flexShrink: 0 }} />
                            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.trip_label}</span>
                            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-secondary)", flexShrink: 0 }}>{sm.label}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* New-product notification banners (from subscriptions) */}
                {subs.newMatches.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {subs.newMatches.map((match) => {
                      const meta = WATCH_CATEGORY_META[match.subscription.watch_category];
                      return (
                        <div
                          key={match.subscription.id}
                          style={{
                            background: "var(--card)",
                            border: "1px solid var(--gold)",
                            borderLeft: "3px solid var(--gold)",
                            borderRadius: "10px",
                            padding: "12px 14px",
                            fontFamily: "var(--font-dm-sans)",
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--gold)", marginBottom: "6px" }}>
                            {meta.emoji} New {meta.label} announcement — {match.subscription.label}
                          </div>
                          {match.products.map((p) => (
                            <div key={p.id} style={{ fontSize: "13px", color: "var(--text-primary)", marginBottom: "4px" }}>
                              <span style={{ fontWeight: 500 }}>{p.name}</span>
                              {p.extracted_specs.cpu && <span style={{ color: "var(--text-secondary)", marginLeft: "6px" }}>{p.extracted_specs.cpu}</span>}
                              {p.extracted_specs.price_usd && <span style={{ color: "var(--text-secondary)", marginLeft: "6px" }}>${p.extracted_specs.price_usd}</span>}
                              <a href={p.source_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "8px", color: "var(--gold)", fontSize: "12px" }}>Source →</a>
                            </div>
                          ))}
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "6px" }}>
                            We&apos;re gathering full review data — check back soon for complete recommendations.
                          </div>
                          <button
                            onClick={subs.clearNewMatches}
                            style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                          >
                            Dismiss
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Message Thread */}
                {chat.messages.map((msg, i) => (
                  <div key={i}>
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div
                          className="px-4 py-3 max-w-xs"
                          style={{
                            backgroundColor: "var(--text-primary)",
                            color: "var(--bg)",
                            borderRadius: "18px 18px 4px 18px",
                            fontFamily: "var(--font-dm-sans)",
                            fontSize: "14px",
                            lineHeight: 1.5,
                          }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ) : msg.content === "__LIST_SUBSCRIPTIONS__" ? (
                      /* Subscription list view */
                      <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: "13px" }}>
                        {subs.subscriptions.length === 0 ? (
                          <p style={{ color: "var(--text-secondary)" }}>You&apos;re not watching anything yet. Try: &quot;Tell me when Apple releases a new MacBook&quot;.</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <p style={{ color: "var(--text-secondary)", marginBottom: "4px" }}>You&apos;re watching {subs.subscriptions.length} release{subs.subscriptions.length > 1 ? "s" : ""}:</p>
                            {subs.subscriptions.map((sub) => {
                              const meta = WATCH_CATEGORY_META[sub.watch_category];
                              return (
                                <div key={sub.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", borderRadius: "8px", padding: "8px 12px" }}>
                                  <span style={{ color: "var(--text-primary)" }}>{meta.emoji} {sub.label}</span>
                                  <button
                                    onClick={() => subs.removeSubscription({ action: "unsubscribe", watch_category: sub.watch_category, brands: sub.brands, keywords: sub.keywords, label: sub.label, category: "subscription" })}
                                    style={{ fontSize: "11px", color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <p
                          style={{
                            color: "var(--text-secondary)",
                            fontSize: "13px",
                            fontFamily: "var(--font-dm-sans)",
                            paddingTop: "4px",
                            paddingBottom: "4px",
                          }}
                        >
                          {msg.content}
                        </p>
                        {/* Inline hotel cards for this message */}
                        {msg.hotelCards && msg.hotelCards.length > 0 && (
                          <div className="flex flex-col gap-3">
                            {msg.hotelCards.map((card, ci) => (
                              <HotelCard
                                key={card.hotel.id}
                                card={card}
                                index={ci}
                                checkIn={chat.hotelDates?.check_in}
                                checkOut={chat.hotelDates?.check_out}
                                guests={chat.hotelDates?.guests}
                                onJobCreated={(jobId) => setInlineItems((prev) => [...prev, { type: "job", jobId }])}
                              />
                            ))}
                          </div>
                        )}
                        {/* Inline flight cards for this message */}
                        {msg.flightCards && msg.flightCards.length > 0 && (
                          <div className="flex flex-col gap-3">
                            {msg.flightCards.map((card, ci) => (
                              <FlightCard
                                key={card.flight.id}
                                card={card}
                                index={ci}
                                bookingContext={chat.flightBookingContext}
                                onJobCreated={(jobId) => setInlineItems((prev) => [...prev, { type: "job", jobId }])}
                              />
                            ))}
                          </div>
                        )}
                        {/* Inline activity cards for this message */}
                        {msg.activityCards && msg.activityCards.length > 0 && (
                          <div className="flex flex-col gap-3">
                            {msg.activityCards.map((card, ci) => (
                              <ActivityCard
                                key={`${card.activity.id}-${card.group}`}
                                card={card}
                                index={ci}
                                onJobCreated={(jobId) => setInlineItems((prev) => [...prev, { type: "job", jobId }])}
                              />
                            ))}
                          </div>
                        )}
                        {/* Inline restaurant cards for this message */}
                        {msg.cards && msg.cards.length > 0 && (
                          <>
                            <div className="flex flex-col gap-3">
                              {msg.cards.map((card, ci) => (
                                <RecommendationCard
                                  key={card.restaurant?.id ?? ci}
                                  card={card}
                                  index={ci}
                                  isFavorite={favorites.has(card.restaurant?.id ?? "")}
                                  onToggleFavorite={() => {
                                    const isAdding = !favorites.has(card.restaurant?.id ?? "");
                                    toggleFavorite(card.restaurant?.id ?? "", card);
                                    if (isAdding && !auth.isSignedIn && !upgradePromptShown) {
                                      const newCount = favorites.size + 1;
                                      if (newCount >= 3) setUpgradePromptShown(true);
                                    }
                                  }}
                                  nearLocationLabel={location.nearLocation || undefined}
                                  currentQuery={lastUserQuery}
                                  onCompare={() => {
                                    toggleCompare(card);
                                    setCompareOpen(true);
                                  }}
                                  isComparing={isComparing(card)}
                                  onFeedback={handleCardFeedback}
                                />
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                setDecisionRoomQuery(
                                  lastUserQuery ||
                                    msg.cards?.[0]?.restaurant?.name ||
                                    "dinner tonight"
                                );
                                setDecisionRoomOpen(true);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                marginTop: "4px",
                                padding: "9px 16px",
                                borderRadius: "12px",
                                border: "1.5px solid #e5e7eb",
                                background: "#fff",
                                color: "#374151",
                                fontSize: "13px",
                                fontWeight: 500,
                                cursor: "pointer",
                                width: "100%",
                                justifyContent: "center",
                                fontFamily: "var(--font-dm-sans, system-ui)",
                              }}
                            >
                              <span style={{ fontSize: "15px" }}>🤝</span>
                              Plan this with someone
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* P1-15: NLU pending indicator — shown while /api/chat/parse is in flight */}
                {nluPending && (
                  <div
                    style={{
                      color: "var(--text-secondary)",
                      fontSize: "13px",
                      fontFamily: "var(--font-dm-sans)",
                      fontStyle: "italic",
                      padding: "4px 2px",
                    }}
                  >
                    Thinking…
                  </div>
                )}

                {/* P1-15: Quick-pick chips — rendered when NLU asked a clarifying question */}
                {pendingQuickPicks && pendingQuickPicks.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 4 }}>
                    {pendingQuickPicks.map((pick) => (
                      <button
                        key={`qp-${pick.value}`}
                        type="button"
                        onClick={() => handleQuickPick(pick.value)}
                        disabled={chat.loading || nluPending}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "0.5px solid var(--border)",
                          backgroundColor: "var(--card)",
                          color: "var(--text-primary)",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        {pick.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* P1-15: Inline confirm card — drives Decision Room creation */}
                {pendingConfirm && (
                  <ConfirmCard
                    kind={pendingConfirm.kind}
                    nlu={pendingConfirm.nlu}
                    message={pendingConfirm.message}
                    onConfirmed={handleConfirmCommitted}
                    onEdit={handleConfirmEdit}
                  />
                )}

                {/* Stage 1 trip flow: planning spinner + TripPackageCard */}
                {tripFlow?.phase === "planning" && (
                  <div
                    style={{
                      border: "1px solid var(--border, #e5e7eb)",
                      borderRadius: 14,
                      padding: 12,
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 13,
                      color: "var(--text-secondary, #555)",
                      backgroundColor: "var(--card-2, #f7f7f7)",
                    }}
                  >
                    Packaging your trip… running hotel + flight pipelines in parallel.
                  </div>
                )}
                {tripFlow?.phase === "ready" && (
                  <TripPackageCard
                    pkg={tripFlow.pkg}
                    sessionId={chat.getSessionId()}
                    errors={tripFlow.errors}
                    onBooked={() => setTripFlow(null)}
                  />
                )}
                {tripFlow?.phase === "error" && (
                  <div
                    style={{
                      border: "1px solid var(--border, #e5e7eb)",
                      borderRadius: 14,
                      padding: 12,
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: 13,
                      color: "#c0392b",
                    }}
                  >
                    Trip planner failed: {tripFlow.message}
                  </div>
                )}

                {/* 4-Step Loading Progress */}
                {chat.loading && (
                  <div
                    className="rounded-2xl p-5 space-y-4"
                    style={{
                      backgroundColor: "var(--card)",
                      border: "0.5px solid var(--border)",
                    }}
                  >
                    {LOADING_STEPS.map((step, i) => {
                      const done = i < chat.loadingStep;
                      const active = i === chat.loadingStep;
                      const pct = done ? 100 : active ? 55 : 0;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span
                            style={{
                              width: "52px",
                              fontSize: "11px",
                              fontFamily: "var(--font-dm-sans)",
                              color: "var(--text-muted)",
                              flexShrink: 0,
                            }}
                          >
                            {i + 1}&thinsp;/&thinsp;4
                          </span>
                          <div
                            className="flex-1 h-1 rounded-full overflow-hidden"
                            style={{ backgroundColor: "var(--bg)" }}
                          >
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: "var(--gold)",
                              }}
                            />
                          </div>
                          <span
                            className={active ? "animate-pulse-gold" : ""}
                            style={{
                              fontSize: "12px",
                              fontFamily: "var(--font-dm-sans)",
                              color: done
                                ? "var(--gold)"
                                : active
                                ? "var(--text-primary)"
                                : "var(--text-muted)",
                              minWidth: "170px",
                            }}
                          >
                            {done ? "✓ " : ""}
                            {step}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Hotel date picker trigger */}
                {chat.allHotelCards.length > 0 && (
                  <button
                    onClick={() => setDatePickerOpen(true)}
                    style={{
                      alignSelf: "flex-start",
                      padding: "6px 14px",
                      borderRadius: "20px",
                      border: "0.5px solid var(--gold)",
                      backgroundColor: "transparent",
                      color: "var(--gold)",
                      fontFamily: "var(--font-dm-sans)",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    📅 {hotelDates ? `${hotelDates.checkIn} → ${hotelDates.checkOut}` : "Select dates"}
                  </button>
                )}

                {/* Filter / View Bar */}
                {filterViewBar}

                {/* 3c-3: Post-experience feedback prompts */}
                {pendingFeedbackPrompts.map((prompt) => (
                  <FeedbackPromptCard
                    key={prompt.id}
                    promptId={prompt.id}
                    planId={prompt.plan_id}
                    sessionId={chat.getSessionId()}
                    venueName={prompt.venue_name}
                    scenario={prompt.scenario}
                    onDismiss={() =>
                      setPendingFeedbackPrompts((prev) =>
                        prev.filter((p) => p.id !== prompt.id)
                      )
                    }
                    onRespond={handleFeedbackResponse}
                  />
                ))}

                {/* Map toggle for concert events with venue coords */}
                {concertVenuePins.length > 0 && (
                  <div
                    className="flex gap-1 rounded-xl p-1 self-start"
                    style={{ backgroundColor: "var(--card)", border: "0.5px solid var(--border)" }}
                  >
                    {(["list", "map"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => chat.setViewMode(mode)}
                        aria-pressed={chat.viewMode === mode}
                        className="px-3 py-1 rounded-lg text-xs font-medium transition-all capitalize"
                        style={{
                          backgroundColor: chat.viewMode === mode ? "var(--gold)" : "transparent",
                          color: chat.viewMode === mode ? "#fff" : "var(--text-secondary)",
                          fontFamily: "var(--font-dm-sans)",
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                )}

                {/* Scenario Plan Results (hidden when concert map view is active) */}
                {chat.resultMode === "scenario_plan" && chat.decisionPlan && !isConcertMapMode && (
                  <ScenarioPlanView
                    plan={chat.decisionPlan}
                    planFeedbackMessage={planFeedbackMessage}
                    onAction={handlePlanAction}
                    onLinkClick={handlePlanLinkClick}
                    trackDecisionPlanEvent={chat.trackDecisionPlanEvent}
                    swapDecisionPlanOption={chat.swapDecisionPlanOption}
                    setPlanFeedbackMessage={setPlanFeedbackMessage}
                    lastUserQuery={lastUserQuery}
                  />
                )}

                {/* Inline booking task cards — below results, newest at bottom */}
                {inlineItems.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {inlineItems.map((item) =>
                      item.type === "job" ? (
                        <InlineJobCard
                          key={item.jobId}
                          jobId={item.jobId}
                          onDeleted={(id) => setInlineItems((prev) => prev.filter((i) => i.jobId !== id))}
                          onNeedsTravelDocs={(req) => {
                            setPendingTravelDoc(req);
                            chat.injectAssistantMessage(
                              "To book this flight, I need your travel documents. Could you please share your **date of birth** (YYYY-MM-DD) and **passport number**? For example: \"2001-09-05, passport EJ2676174\""
                            );
                          }}
                        />
                      ) : null
                    )}
                  </div>
                )}

                {/* Credit Card Results */}
                {chat.resultCategory === "credit_card" && chat.allCreditCardCards.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "0 2px 4px",
                      }}
                    >
                      Ranked by annual net gain vs your current card portfolio · Rates as of last verification date
                    </div>
                    {chat.allCreditCardCards.map((card, i) => (
                      <CreditCardCard key={card.card.id} card={card} index={i} />
                    ))}
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "4px 2px 0",
                        fontStyle: "italic",
                      }}
                    >
                      This tool provides information for reference only and does not constitute financial advice. Confirm current terms at the issuer&apos;s website before applying.
                    </div>
                  </div>
                )}

                {/* Laptop Results */}
                {chat.resultCategory === "laptop" && chat.allLaptopCards.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "0 2px 4px",
                      }}
                    >
                      Ranked by weighted signal score for your use case · Specs from Wirecutter, NotebookCheck, The Verge · Prices are MSRP
                    </div>
                    {chat.laptopDbGapWarning && (
                      <div
                        style={{
                          background: "var(--card)",
                          border: "1px solid #E8A020",
                          borderLeft: "3px solid #E8A020",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: "13px",
                          color: "var(--text-primary)",
                          lineHeight: "1.5",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "#E8A020", marginRight: "6px" }}>⚠ Data gap:</span>
                        {chat.laptopDbGapWarning}
                      </div>
                    )}
                    {chat.allLaptopCards.map((card, i) => (
                      <LaptopCard key={card.device.id} card={card} index={i} />
                    ))}
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "4px 2px 0",
                        fontStyle: "italic",
                      }}
                    >
                      Recommendations are based on static review data and may not reflect the latest models or price changes. Always verify specs and pricing before purchase.
                    </div>
                  </div>
                )}

                {/* Smartphone Results */}
                {chat.resultCategory === "smartphone" && chat.allSmartphoneCards.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "0 2px 4px",
                      }}
                    >
                      Ranked by weighted signal score for your use case · Data from GSMA, GSMArena, The Verge · Prices are MSRP
                    </div>
                    {chat.deviceDbGapWarning && (
                      <div
                        style={{
                          background: "var(--card)",
                          border: "1px solid #E8A020",
                          borderLeft: "3px solid #E8A020",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: "13px",
                          color: "var(--text-primary)",
                          lineHeight: "1.5",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "#E8A020", marginRight: "6px" }}>⚠ Data gap:</span>
                        {chat.deviceDbGapWarning}
                      </div>
                    )}
                    {chat.allSmartphoneCards.map((card, i) => (
                      <SmartphoneCard key={card.device.id} card={card} index={i} />
                    ))}
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "4px 2px 0",
                        fontStyle: "italic",
                      }}
                    >
                      Recommendations are based on static review data and may not reflect the latest models or price changes. Always verify specs and pricing before purchase.
                    </div>
                  </div>
                )}

                {/* Headphone Results */}
                {chat.resultCategory === "headphone" && chat.allHeadphoneCards.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "0 2px 4px",
                      }}
                    >
                      Ranked by weighted signal score for your use case · Data from Rtings, The Verge, SoundGuys · Prices are MSRP
                    </div>
                    {chat.deviceDbGapWarning && (
                      <div
                        style={{
                          background: "var(--card)",
                          border: "1px solid #E8A020",
                          borderLeft: "3px solid #E8A020",
                          borderRadius: "8px",
                          padding: "10px 14px",
                          fontFamily: "var(--font-dm-sans)",
                          fontSize: "13px",
                          color: "var(--text-primary)",
                          lineHeight: "1.5",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "#E8A020", marginRight: "6px" }}>⚠ Data gap:</span>
                        {chat.deviceDbGapWarning}
                      </div>
                    )}
                    {chat.allHeadphoneCards.map((card, i) => (
                      <HeadphoneCard key={card.device.id} card={card} index={i} />
                    ))}
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-dm-sans)",
                        padding: "4px 2px 0",
                        fontStyle: "italic",
                      }}
                    >
                      Recommendations are based on static review data and may not reflect the latest models or price changes. Always verify specs and pricing before purchase.
                    </div>
                  </div>
                )}

                {/* Degraded empty-filter state */}
                {chat.resultMode === "category_cards" &&
                  chat.visibleCards.length > 0 &&
                  chat.displayCards.length === 0 && (
                    <div
                      className="rounded-2xl p-6 text-center"
                      style={{
                        backgroundColor: "var(--card)",
                        border: "0.5px solid var(--border)",
                      }}
                    >
                      <p
                        style={{
                          color: "var(--text-secondary)",
                          fontSize: "14px",
                          fontFamily: "var(--font-dm-sans)",
                          marginBottom: "12px",
                        }}
                      >
                        No exact matches — showing closest results instead.
                      </p>
                      <div className="flex gap-2 justify-center flex-wrap">
                        {chat.activePrice && (
                          <button
                            onClick={() => chat.setActivePrice(null)}
                            style={{
                              border: "0.5px solid var(--gold)",
                              color: "var(--gold)",
                              fontFamily: "var(--font-dm-sans)",
                              borderRadius: "20px",
                              padding: "5px 14px",
                              fontSize: "12px",
                              cursor: "pointer",
                              background: "none",
                            }}
                          >
                            Clear price filter
                          </button>
                        )}
                        {chat.activeCuisine && (
                          <button
                            onClick={() => chat.setActiveCuisine(null)}
                            style={{
                              border: "0.5px solid var(--gold)",
                              color: "var(--gold)",
                              fontFamily: "var(--font-dm-sans)",
                              borderRadius: "20px",
                              padding: "5px 14px",
                              fontSize: "12px",
                              cursor: "pointer",
                              background: "none",
                            }}
                          >
                            Clear cuisine filter
                          </button>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}

      {/* ─── Bottom Input Bar ─────────────────────────────────── */}
      <div
        className="flex-shrink-0 border-t px-4 py-3 z-10"
        style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto flex gap-2 items-center">
          {/* New chat button — only show when there's conversation history */}
          {hasMessages && (
            <button
              onClick={() => { chat.clearChat(); setInlineItems([]); setPendingTravelDoc(null); }}
              title="Start a new conversation"
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                border: "0.5px solid var(--border)", backgroundColor: "var(--card)",
                color: "var(--text-secondary)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
          <input
            type="text"
            value={isListening ? "" : chat.input}
            onChange={(e) => updateChatInput(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              updateChatInput(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (isComposingRef.current || e.nativeEvent.isComposing) {
                  return;
                }
                chatInputRef.current = e.currentTarget.value;
                e.preventDefault();
                sendCurrentInput();
              }
            }}
            placeholder={
              isListening
                ? "Listening..."
                : pendingTravelDoc
                ? "e.g. 2001-09-05, passport EJ2676174"
                : hasMessages
                ? "Refine: 'more quiet', 'cheaper options'..."
                : "Describe what you're looking for..."
            }
            aria-label="Search for restaurants"
            className="flex-1 outline-none px-4 py-2.5"
            style={{
              backgroundColor: "var(--bg)",
              border: `0.5px solid ${isListening ? "var(--gold)" : "var(--border)"}`,
              borderRadius: "24px",
              color: "var(--text-primary)",
              fontFamily: "var(--font-dm-sans)",
              fontSize: "13px",
              transition: "border-color 0.2s",
            }}
            disabled={chat.loading || isListening}
          />
          {/* Phase 5.2: Mic button — hidden when voice not supported */}
          {voiceSupported && (
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={chat.loading}
              aria-label={isListening ? "Stop listening" : "Start voice input"}
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "50%",
                backgroundColor: isListening ? "var(--gold)" : "var(--text-primary)",
                color: isListening ? "#fff" : "var(--gold)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                border: "none",
                cursor: chat.loading ? "not-allowed" : "pointer",
                opacity: chat.loading ? 0.4 : 1,
                transition: "background-color 0.2s, transform 0.2s",
                transform: isListening ? "scale(1.08)" : "scale(1)",
                boxShadow: isListening ? "0 0 0 4px rgba(201,168,76,0.25)" : "none",
              }}
            >
              {isListening ? (
                // Animated pulse when listening
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="9" y="2" width="6" height="14" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                  <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="9" y="2" width="6" height="14" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                  <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          )}
          <button
            onClick={sendCurrentInput}
            disabled={chat.loading || !chat.input.trim()}
            aria-label="Send"
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              backgroundColor: "var(--gold)",
              color: "#fff",
              fontSize: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              opacity: chat.loading || !chat.input.trim() ? 0.4 : 1,
              cursor:
                chat.loading || !chat.input.trim() ? "not-allowed" : "pointer",
              transition: "opacity 0.2s",
              border: "none",
            }}
          >
            ↑
          </button>
        </div>
      </div>

      {/* Date Range Picker for hotel searches */}
      {datePickerOpen && (
        <DateRangePicker
          checkIn={hotelDates?.checkIn}
          checkOut={hotelDates?.checkOut}
          onSelect={(checkIn, checkOut) => {
            setHotelDates({ checkIn, checkOut });
            const dateText = `Check in ${checkIn}, check out ${checkOut}`;
            chat.sendMessage(dateText);
          }}
          onClose={() => setDatePickerOpen(false)}
        />
      )}

      {/* Decision Room Modal */}
      {decisionRoomOpen && (
        <DecisionRoomModal
          isOpen={decisionRoomOpen}
          onClose={() => setDecisionRoomOpen(false)}
          initiatorQuery={decisionRoomQuery}
          cityId={location.cityId ?? "losangeles"}
          userId={auth.userId}
        />
      )}
    </main>
  );
}

