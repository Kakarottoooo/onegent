"use client";

import { useRef, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import RecommendationCard from "@/components/RecommendationCard";
import HotelCard from "@/components/HotelCard";
import FlightCard from "@/components/FlightCard";
import InlineJobCard, { type TravelDocRequest } from "@/components/booking/InlineJobCard";
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
import ConfirmCard, { type CommitResponse } from "@/components/ConfirmCard";
import TripPackageCard from "@/components/TripPackageCard";
import TripProposalChatCard from "@/components/TripProposalChatCard";
import type { TripPackage } from "@/lib/types";
import type { TripIntentState } from "@/lib/agent/trip-intent-state";
import { useLanguage } from "@/app/hooks/useLanguage";
import GlobalNav from "@/components/GlobalNav";
import Sidebar from "@/components/Sidebar";
import {
  looksLikeRecommendationAsk,
  getFallbackQuickPicks,
} from "@/lib/quick-picks-fallback";
import type {
  ConversationalNLUResult,
  QuickPick,
} from "@/lib/agent/nlu-v2";
import type { ChatMessage } from "@/lib/llm-client";
import { loadAgentModelConfig } from "@/lib/agent-model-config";
import {
  buildRoomReplaySnapshot,
  buildSessionReplaySnapshot,
  type RoomReplaySnapshot,
  type SessionReplaySnapshot,
} from "@/lib/chat-replay";
import { useRouter } from "next/navigation";
import "@/components/chat.css";

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

function HomeInner() {
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
  // Stage 2: homepage chat can be scoped to a Decision Room via ?room_id=<id>.
  // When present, each chat turn mirrors the user's IntentState + messages
  // into the room's private channel (see /api/chat/parse · syncRoomContext).
  // Uses window.location directly to avoid Next.js Suspense-boundary
  // requirements around useSearchParams during SSG/SSR.
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  // Sessions (ChatGPT-style persistent solo threads): ?session_id=<id> makes
  // this homepage mount continue that thread. First user message in a fresh
  // session creates one on the server, and we update the URL then.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Stage 2 · T11: when a trip room has an active proposal, render
  // <TripProposalChatCard> inline in the chat stream. The id comes from the
  // most recent private_message with meta_json.kind='trip_proposal_card'.
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  // True while /api/rooms/[id]/synthesize is in-flight. Drives an inline
  // progress card below the chat so members see the 5-15s pipeline wait
  // as work-in-progress, not a stalled bot.
  const [synthesizing, setSynthesizing] = useState(false);
  // Titles for the context ribbon so the user can tell "which room" / "which
  // chat" they're in without looking at the sidebar.
  const [activeRoomTitle, setActiveRoomTitle] = useState<string | null>(null);
  // Member roster for the active room ribbon — shows avatar chips so the
  // user can SEE who's in the DR rather than trusting the agent's reply.
  const [activeRoomMembers, setActiveRoomMembers] = useState<Array<{
    user_id: string;
    status: string;
    is_creator: boolean;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  }>>([]);
  const [activeSessionTitle, setActiveSessionTitle] = useState<string | null>(null);
  // Bump to trigger a sidebar refetch (after creating a room / new session).
  const [sidebarReloadTick, setSidebarReloadTick] = useState(0);
  const roomReplayCacheRef = useRef<Map<string, RoomReplaySnapshot>>(new Map());
  const sessionReplayCacheRef = useRef<Map<string, SessionReplaySnapshot>>(new Map());
  const roomTitleCacheRef = useRef<Map<string, string>>(new Map());
  // Read query params via Next.js's React-aware hook so the component
  // re-renders when `router.push("/?session_id=X")` (sidebar click) changes
  // the URL. The previous implementation read `window.location.search`
  // directly, which Next.js does NOT track — same-route nav with a
  // changed query param wouldn't re-render this component, so clicking
  // a different sidebar thread left the chat showing the old thread's
  // messages. useSearchParams subscribes correctly. Suspense-wrapped at
  // the export below so prerender doesn't choke.
  const searchParams = useSearchParams();
  const urlRoomId = searchParams.get("room_id");
  const urlSessionId = searchParams.get("session_id");
  useEffect(() => {
    const r = urlRoomId && urlRoomId.trim() ? urlRoomId.trim() : null;
    const s = urlSessionId && urlSessionId.trim() ? urlSessionId.trim() : null;
    setActiveRoomId((prev) => (prev === r ? prev : r));
    setActiveSessionId((prev) => (prev === s ? prev : s));
  }, [urlRoomId, urlSessionId]);

  // When the user actively SWITCHES between existing threads (sidebar click,
  // back button, etc.) we want the new thread's content to appear in a SINGLE
  // render — no flash of the empty homepage between clearChat and the
  // replay effect's repopulation. So this effect handles the switch
  // synchronously when the new context is already cached, and only
  // falls back to clear-then-fetch when there's nothing to restore from.
  // Do NOT clear when a brand-new session is created mid-turn (from
  // "none" → "session:X") — the user just typed a message and got a
  // reply; those must stay on screen.
  const lastContextRef = useRef<string>("");
  useEffect(() => {
    const ctx = activeRoomId
      ? `room:${activeRoomId}`
      : activeSessionId
        ? `session:${activeSessionId}`
        : "none";
    const prev = lastContextRef.current;
    const isRealSwitch =
      prev !== "" && // initial render, nothing to compare against
      prev !== ctx &&
      prev !== "none"; // "none → session:X" is session creation, not a switch
    if (isRealSwitch) {
      // Evict the previous thread first so its replay-set flag doesn't
      // wedge a future return-visit. (Switching A→B→A would leave A
      // blank if its flag stayed set.) Encoded prev as "room:X" /
      // "session:X" above; parse it back.
      if (prev.startsWith("session:")) {
        replayedSessionIds.current.delete(prev.slice("session:".length));
      } else if (prev.startsWith("room:")) {
        replayedRoomIds.current.delete(prev.slice("room:".length));
      }

      // Try the SYNCHRONOUS cached path first. If we have a snapshot
      // for the new context, replaceMessages directly — the render
      // commits with the new content in one shot, no empty-state flash.
      // The replay effect below sees the flag set and bails, so nothing
      // double-fires.
      let restored = false;
      if (activeSessionId) {
        const cached = sessionReplayCacheRef.current.get(activeSessionId);
        if (cached) {
          chat.replaceMessages(cached.messages);
          setActiveSessionTitle(cached.title);
          nluHistoryRef.current = cached.nluHistory;
          lastNluStateRef.current = cached.lastNluState;
          replayedSessionIds.current.add(activeSessionId);
          restored = true;
        }
      } else if (activeRoomId) {
        const cached = roomReplayCacheRef.current.get(activeRoomId);
        if (cached) {
          chat.replaceMessages(cached.messages);
          setActiveProposalId(cached.proposalId);
          nluHistoryRef.current = cached.nluHistory;
          replayedRoomIds.current.add(activeRoomId);
          restored = true;
        }
      }

      if (!restored) {
        // Cold cache: clear and let the replay effect fetch from DB.
        // First-visit flash is unavoidable until we wire a loading
        // state, but switches BACK to a previously-visited thread are
        // now flash-free thanks to the cached path above.
        chat.clearChat();
        nluHistoryRef.current = [];
        lastNluStateRef.current = null;
      }
    }
    lastContextRef.current = ctx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, activeSessionId]);
  // popstate fires on back/forward — force a re-render so the reads above pick
  // up the new URL. router.push/replace already triggers React re-render on
  // their own, but the browser buttons don't reach React without this.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setSidebarReloadTick((n) => n + 1);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Stage 2 chat continuity: when the page loads (or activeRoomId changes
  // because the user opened ?room_id=<id>), pull this user's private message
  // history from the server and replay it into the chat thread so refreshing,
  // closing and re-opening, or following an invite link doesn't lose the
  // ongoing conversation. Only runs once per room (replayedRoomIds ref guard).
  // Clear + (lazy-fetch) the room title when active room changes. Kept
  // separate from the message-replay effect so the title updates even if
  // history replay is skipped (e.g. already populated chat).
  useEffect(() => {
    if (!activeRoomId) {
      setActiveRoomTitle(null);
      setActiveRoomMembers([]);
      setActiveProposalId(null);
      return;
    }
    const cachedTitle = roomTitleCacheRef.current.get(activeRoomId) ?? null;
    setActiveRoomTitle(cachedTitle);
    setActiveProposalId(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${activeRoomId}`);
        // Stale URL ↔ deleted/inaccessible room: kick the user back to / so
        // they don't keep firing synthesize/parse with a zombie room id.
        // 404 = room doesn't exist; 403 = user isn't a member (e.g. room
        // was deleted and membership cleaned up, or they left/declined).
        if (res.status === 404 || res.status === 403) {
          if (!cancelled) {
            setActiveRoomId(null);
            replayedRoomIds.current.delete(activeRoomId);
            router.replace("/");
          }
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          room?: { title?: string };
          members?: Array<{
            user_id: string;
            status: string;
            is_creator: boolean;
            display_name: string | null;
            username: string | null;
            avatar_url: string | null;
          }>;
        };
        if (!cancelled && data.room?.title) {
          roomTitleCacheRef.current.set(activeRoomId, data.room.title);
          setActiveRoomTitle(data.room.title);
        }
        if (!cancelled && Array.isArray(data.members)) {
          setActiveRoomMembers(data.members);
        }
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRoomId, router]);

  // Reset session title when active session clears.
  useEffect(() => {
    if (!activeSessionId) setActiveSessionTitle(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (activeRoomId) {
      if (activeRoomTitle) roomTitleCacheRef.current.set(activeRoomId, activeRoomTitle);
      if (chat.messages.length === 0 && !activeProposalId) return;
      // Ownership gate: only save chat.messages to the room's cache once
      // the room's replay effect has populated them. Without this gate, a
      // sidebar switch B→A fires this effect with activeRoomId=A while
      // chat.messages still holds B's messages (clearChat queued in
      // isRealSwitch hasn't applied yet) — and we'd write B's messages
      // into A's cache, corrupting it for the next visit.
      if (!replayedRoomIds.current.has(activeRoomId)) return;
      roomReplayCacheRef.current.set(activeRoomId, {
        messages: chat.messages,
        nluHistory: nluHistoryRef.current,
        proposalId: activeProposalId,
      });
      return;
    }
    if (!activeSessionId) return;
    if (chat.messages.length === 0 && !lastNluStateRef.current) return;
    // Same ownership gate as rooms above. This was the actual cause of
    // "switching drafts doesn't update content until I refresh" — the
    // session cache was getting overwritten with the OLD context's
    // messages on every switch, then replay loaded that polluted cache
    // back instead of the new session's real messages.
    if (!replayedSessionIds.current.has(activeSessionId)) return;
    sessionReplayCacheRef.current.set(activeSessionId, {
      title: activeSessionTitle,
      messages: chat.messages,
      nluHistory: nluHistoryRef.current,
      lastNluState: lastNluStateRef.current,
    });
  }, [
    activeProposalId,
    activeRoomId,
    activeRoomTitle,
    activeSessionId,
    activeSessionTitle,
    chat.messages,
  ]);

  const replayedRoomIds = useRef<Set<string>>(new Set());
  const replayedSessionIds = useRef<Set<string>>(new Set());
  // Session history replay — parallel to the room one below. Fires only when
  // ?session_id is present (and no ?room_id, which takes priority).
  useEffect(() => {
    if (activeRoomId) return; // room context wins
    if (!activeSessionId) return;
    // The session-creation path (homepage parse → server echoes new id) seeds
    // replayedSessionIds eagerly so this effect skips. Anything else that
    // lands in this effect (sidebar switch back to A, refresh, deep-link)
    // wants a fresh fetch — we no longer guard on chat.messages.length, that
    // check used the stale closure value and silently dropped real switches.
    if (replayedSessionIds.current.has(activeSessionId)) return;
    let cancelled = false;
    (async () => {
      const cached = sessionReplayCacheRef.current.get(activeSessionId);
      if (cached) {
        if (cancelled) return;
        replayedSessionIds.current.add(activeSessionId);
        chat.replaceMessages(cached.messages);
        setActiveSessionTitle(cached.title);
        nluHistoryRef.current = cached.nluHistory;
        lastNluStateRef.current = cached.lastNluState;
        return;
      }
      try {
        console.log(`[session-replay] fetching /api/chat/sessions/${activeSessionId}/messages`);
        const res = await fetch(`/api/chat/sessions/${activeSessionId}/messages`);
        if (!res.ok) {
          console.warn(`[session-replay] fetch failed: ${res.status}`);
          return;
        }
        const data = (await res.json()) as {
          session?: { id: string; title: string } | null;
          messages: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
            nlu_state?: unknown | null;
            created_at: string;
          }>;
        };
        console.log(`[session-replay] got ${data.messages?.length ?? 0} messages for ${activeSessionId}`);
        if (cancelled) return;
        const snapshot = buildSessionReplaySnapshot(data);
        sessionReplayCacheRef.current.set(activeSessionId, snapshot);
        // Mark replayed even on empty — otherwise we'd keep re-fetching.
        replayedSessionIds.current.add(activeSessionId);
        setActiveSessionTitle(snapshot.title);
        chat.replaceMessages(snapshot.messages);
        // Rehydrate the NLU history so the extractor sees the prior turns
        // on the next /api/chat/parse call — otherwise the agent acts
        // amnesiac after a refresh (sees only the new message).
        nluHistoryRef.current = snapshot.nluHistory;
        // Hydrate prev_nlu_state from the latest assistant turn that has one.
        // Walk backwards so a session that ended on a user turn still finds the
        // prior assistant state.
        lastNluStateRef.current = snapshot.lastNluState;
      } catch (err) {
        console.warn("[session-replay] error", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, activeRoomId]);

  useEffect(() => {
    if (!activeRoomId) return;
    if (replayedRoomIds.current.has(activeRoomId)) return;
    let cancelled = false;
    (async () => {
      const cached = roomReplayCacheRef.current.get(activeRoomId);
      if (cached) {
        if (cancelled) return;
        replayedRoomIds.current.add(activeRoomId);
        chat.replaceMessages(cached.messages);
        setActiveProposalId(cached.proposalId);
        nluHistoryRef.current = cached.nluHistory;
        return;
      }
      try {
        const res = await fetch(`/api/rooms/${activeRoomId}/private-messages`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            content: string;
            meta_json: { kind?: string; proposal_id?: string } | null;
            created_at: string;
          }>;
        };
        if (cancelled) return;
        const snapshot = buildRoomReplaySnapshot(data.messages);
        roomReplayCacheRef.current.set(activeRoomId, snapshot);
        replayedRoomIds.current.add(activeRoomId);
        chat.replaceMessages(snapshot.messages);
        // Fresh context — the context-switch effect already cleared chat on
        // a real switch. Inject each persisted message so the user sees the
        // full thread that the server seeded (pre-confirm history + welcome
        // for the creator; a single welcome for invited members).
        // Special case: messages with meta_json.kind === 'trip_proposal_card'
        // are marker rows — skip the text bubble; the card is rendered via
        // activeProposalId state instead. Keep the LAST such proposal_id so
        // we always show the most recent proposal (force re-synthesis creates
        // a new marker message after the old one).
        setActiveProposalId(snapshot.proposalId);
        // Rehydrate NLU history (same rationale as session replay below).
        // Skip system-role messages + marker messages — only user/assistant
        // text feeds the extractor.
        nluHistoryRef.current = snapshot.nluHistory;
      } catch {
        // Network failure here is non-fatal — user can still chat fresh.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId]);

  // Proposal watcher: poll /trip-proposal every 4s while in a trip room so
  // member B (who didn't trigger synthesize) still sees the card appear the
  // moment the server creates the proposal. Also surfaces is_synthesizing
  // so B gets the progress card during the 5-15s wait.
  const [remoteSynthesizing, setRemoteSynthesizing] = useState(false);
  useEffect(() => {
    if (!activeRoomId) {
      setRemoteSynthesizing(false);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/rooms/${activeRoomId}/trip-proposal`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          proposal?: { id?: string } | null;
          is_synthesizing?: boolean;
        };
        if (cancelled) return;
        if (data.proposal?.id) {
          setActiveProposalId((prev) => (prev === data.proposal!.id ? prev : data.proposal!.id!));
          setRemoteSynthesizing(false);
        } else {
          setRemoteSynthesizing(!!data.is_synthesizing);
        }
      } catch {
        // Non-fatal; keep polling.
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeRoomId]);

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
  const [recentContacts, setRecentContacts] = useState<{
    contact_user_id: string;
    nickname: string | null;
    profile_code: string;
    display_name: string | null;
    avatar_url: string | null;
  }[]>([]);
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
  // Hydrated IntentState from the most recent assistant turn. Sent as
  // prev_nlu_state on the next /api/chat/parse call so the extractor merges
  // into existing constraints instead of starting fresh — keeps refresh /
  // sidebar-switch from feeling like the agent has amnesia.
  const lastNluStateRef = useRef<unknown | null>(null);

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

  // Recent DR partners for the welcome hero "Decide with…" chip row.
  // Quietly empty when signed-out or contacts list is empty — never shown
  // as a placeholder/empty state.
  useEffect(() => {
    if (!auth.isSignedIn) { setRecentContacts([]); return; }
    fetch("/api/contacts/recent")
      .then((r) => (r.ok ? r.json() : { contacts: [] }))
      .then((d: { contacts?: typeof recentContacts }) => {
        setRecentContacts(d.contacts ?? []);
      })
      .catch(() => setRecentContacts([]));
  }, [auth.isSignedIn]);

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
          // Stage 2: when the homepage is scoped to a room, the server mirrors
          // this turn into room_member_intent_state + private messages.
          ...(activeRoomId ? { room_id: activeRoomId } : {}),
          // Sessions: solo chats mirror into chat_session_messages. Server
          // auto-creates the session on the first turn and echoes the id back.
          ...(activeSessionId ? { session_id: activeSessionId } : {}),
          // Hydrated NLU state from the prior assistant turn. Lets the extractor
          // merge into existing constraints — keeps refresh / sidebar-switch
          // from feeling like the agent has amnesia.
          ...(lastNluStateRef.current ? { prev_nlu_state: lastNluStateRef.current } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; result: ConversationalNLUResult; session_id?: string | null }
        | null;

      // Network / NLU failure → fall back to the old restaurant search pipeline
      // so the user still gets results rather than a dead chat.
      if (!data || !data.ok) {
        learnFromSearch(text);
        chat.sendMessage(text, undefined, { skipUserPush: true });
        return;
      }

      const nlu = data.result;

      // Sessions: if the server just auto-created a session (no incoming
      // session_id), it echoes the new id back. Adopt it so next turn syncs
      // to the same thread + update the URL so refresh / logo return lands
      // in the same conversation. Mark as "replayed" so the history-replay
      // effect doesn't re-fetch and dedupe.
      if (data.session_id && data.session_id !== activeSessionId && !activeRoomId) {
        setActiveSessionId(data.session_id);
        replayedSessionIds.current.add(data.session_id);
        setSidebarReloadTick((n) => n + 1);
        if (typeof window !== "undefined") {
          const newUrl = `/?session_id=${encodeURIComponent(data.session_id)}`;
          router.replace(newUrl);
        }
      }

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
      // Capture the IntentState snapshot so the next turn sends prev_nlu_state.
      // The server already persisted this onto the assistant chat_session_messages
      // row via syncSessionContext, but holding it client-side avoids a DB
      // round-trip on the next turn.
      if (nlu.__v2_state) {
        lastNluStateRef.current = nlu.__v2_state;
      }

      // Trip scenario runs through a dedicated package planner (not the legacy
      // search). Surface a ConfirmCard so the user can review what we captured
      // before we spend 10-15s running hotel+flight pipelines in parallel.
      if (nlu.intent === "create_plan" && nlu.confirm_ready && nlu.scenario === "trip") {
        if (nlu.assistant_reply) chat.injectAssistantMessage(nlu.assistant_reply);
        setPendingConfirm({ nlu, message: text, kind: "trip" });
        return;
      }

      // create_plan + confirm_ready (restaurant/hotel/flight/activity) → also
      // surface a ConfirmCard before kicking off the search/booking pipeline.
      // Three reasons:
      //   1. The chat layer's reply ("ready to search? confirm below.") implies
      //      a button — short-circuiting straight into search violated that
      //      promise and stranded the user.
      //   2. /api/chat/commit's direct_booking branch (US-W5) only fires when
      //      the user goes through ConfirmCard. Bypassing it meant a venue-
      //      named ask like "book Carbone for 2 at 7pm" silently fell back to
      //      a recommendation list instead of a real booking job.
      //   3. The ConfirmCard commit is also what flags the session as Completed
      //      (markSessionUpgradedPlan / Trip). Without it, the sidebar's
      //      Completed section stayed perpetually empty for solo plans.
      if (nlu.intent === "create_plan" && nlu.confirm_ready) {
        if (nlu.assistant_reply) chat.injectAssistantMessage(nlu.assistant_reply);
        setPendingConfirm({ nlu, message: text, kind: "plan" });
        return;
      }

      // Everything else: inject the assistant reply as a bubble. Optionally
      // render a confirm card (create_room confirm_ready) or quick-pick chips
      // (any missing-fields clarify).
      if (nlu.assistant_reply) {
        chat.injectAssistantMessage(nlu.assistant_reply);
      }

      if (nlu.intent === "create_room" && nlu.confirm_ready && activeRoomId) {
        // Already in a room — don't pop another ConfirmCard to create a
        // duplicate. Interpret the user's intent as "synthesize the plan for
        // THIS room now" and kick off the trip-synthesis pipeline. Chat bubble
        // below echoes the status so the user knows what's happening.
        //
        // BUT: if this room already has a proposal, firing force synthesis
        // again creates a brand-new proposal row and orphans every vote
        // cast against the first one. Instead, just nudge the user to the
        // card that's already on screen.
        if (activeProposalId) {
          chat.injectAssistantMessage(
            "方案已经在下方卡片里了，看看你们的偏好是否勾对就行 ↓",
          );
          return;
        }
        setSynthesizing(true);
        void (async () => {
          try {
            const res = await fetch(`/api/rooms/${activeRoomId}/synthesize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ force: true }),
            });
            // Stale room id in the URL (deleted / left / never joined). Kick
            // back to / so the user can start fresh instead of looping on
            // "方案生成失败了".
            if (res.status === 404 || res.status === 403) {
              chat.injectAssistantMessage(
                "这个房间已经不存在了（被删除或你不是成员）。我带你回到首页重新开始。",
              );
              setActiveRoomId(null);
              replayedRoomIds.current.delete(activeRoomId);
              router.replace("/");
              return;
            }
            const data = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              room_type?: string;
              reason?: string;
              missing?: string[];
              contributor_count?: number | null;
              member_count?: number | null;
              query?: string | null;
            };
            if (!res.ok || !data.ok) {
              chat.injectAssistantMessage("方案生成失败了，先稍等再试一下。");
              return;
            }

            // Plan A: non-trip rooms get a search query back; we kick the
            // legacy /api/chat recommendation pipeline with it + categoryHint
            // so the cards render inline like a solo flow. The agent's reply
            // already announced "好的，我把大家的偏好综合一下..." via parse,
            // so we go straight to the search.
            const nonTripTypes = ["restaurant", "hotel", "flight", "activity"];
            if (data.room_type && nonTripTypes.includes(data.room_type)) {
              if (data.reason === "ok" && data.query) {
                chat.sendMessage(data.query, undefined, {
                  skipUserPush: true,
                  categoryHint: data.room_type as "restaurant" | "hotel" | "flight" | "activity",
                });
                return;
              }
              if (data.reason === "waiting_for_members") {
                const need = (data.member_count ?? 0) - (data.contributor_count ?? 0);
                chat.injectAssistantMessage(
                  `还在等 ${need} 位成员说偏好。他们都聊过一轮后我会自动综合。如果你想现在就看选项，说「先看选项」。`,
                );
                return;
              }
              if (data.reason === "no_joined_members") {
                chat.injectAssistantMessage(
                  "房间还没有成员加入。等大家接受邀请后再说「出方案」。",
                );
                return;
              }
              chat.injectAssistantMessage(`方案状态: ${data.reason ?? "unknown"}`);
              return;
            }

            // Trip rooms — existing TripPackage proposal flow.
            if (data.reason === "ok") {
              chat.injectAssistantMessage(
                "✅ 方案已出！在下方卡片里选择你的偏好，实时看大家的共识进度。",
              );
              // Fetch the active proposal id so the inline card mounts right
              // away (server also seeded a meta_json marker message for the
              // next replay, but we don't want to refetch private-messages
              // just to parse it out).
              try {
                const propRes = await fetch(`/api/rooms/${activeRoomId}/trip-proposal`);
                if (propRes.ok) {
                  const propBody = (await propRes.json()) as {
                    proposal?: { id?: string } | null;
                  };
                  if (propBody.proposal?.id) {
                    setActiveProposalId(propBody.proposal.id);
                  }
                }
              } catch {
                // Non-fatal; card will show after next page load via replay.
              }
            } else if (data.reason === "waiting_for_members") {
              const need = (data.member_count ?? 0) - (data.contributor_count ?? 0);
              chat.injectAssistantMessage(
                `还在等 ${need} 位成员说偏好。他们都聊过一轮后，我会自动综合方案。`,
              );
            } else if (data.reason === "incomplete") {
              chat.injectAssistantMessage(
                `信息还不够完整：缺 ${data.missing?.join("、") ?? "关键字段"}。继续补充我就能出方案了。`,
              );
            } else if (data.reason === "already_synthesized") {
              chat.injectAssistantMessage(
                "之前已经出过方案了。去 Rooms 页看 + 投票吧。",
              );
            } else {
              chat.injectAssistantMessage(`方案状态: ${data.reason ?? "unknown"}`);
            }
          } catch {
            chat.injectAssistantMessage("方案生成出错了，稍后再试。");
          } finally {
            setSynthesizing(false);
          }
        })();
        return;
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

  async function handleConfirmCommitted(payload: CommitResponse) {
    setPendingConfirm(null);
    // Room created or plan dispatched — current NLU thread is finished; clear
    // the history so the next utterance starts a fresh conversation.
    nluHistoryRef.current = [];
    lastNluStateRef.current = null;
    if (payload.kind === "room" && payload.url) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const fullInvite = payload.invite_url ? `${origin}${payload.invite_url}` : null;
      const title = payload.title ? `「${payload.title}」` : "";

      // Stage 2 chat-flow trip room: DO NOT redirect. The room lives on the
      // homepage under ?room_id=<id>; we just update the URL + state so the
      // next chat turn syncs into the room's private channel. The user keeps
      // talking to the agent right here.
      if (payload.flow === "chat" && payload.id) {
        // Session-to-room upgrade: clear the in-memory chat and switch context
        // into the new room. The room replay effect below fetches the private
        // channel (which the server just seeded with history + welcome) and
        // injects it back — single source of truth, no fragile in-memory hand-off.
        setSidebarReloadTick((n) => n + 1);
        setActiveRoomId(payload.id);
        setActiveSessionId(null);
        router.replace(payload.url);
        return;
      }

      // Legacy: single-scenario (classic flow) rooms redirect to /rooms/<id>.
      if (fullInvite) {
        chat.injectAssistantMessage(
          `Decision Room${title}已创建！\n邀请链接：${fullInvite}\n\n即将跳转到房间页面…`
        );
        setTimeout(() => router.push(payload.url!), 2000);
      } else {
        router.push(payload.url);
      }
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
        // Pin the scenario forward to /api/chat. Without this, runAgent
        // re-classifies the conversation history with its own LLM, and
        // when the latest user message is a quick-pick value like "2"
        // (party_size) the classifier has been observed picking
        // category="smartphone" off vague history — surfacing a
        // hallucinated electronics shopping reply right after the user
        // confirmed a restaurant booking. The v2 NLU has already
        // determined the scenario; treat it as ground truth.
        const validHints = ["restaurant", "hotel", "flight", "activity"] as const;
        const hint = validHints.find((s) => s === payload.scenario);
        chat.sendMessage(query, undefined, {
          skipUserPush: true,
          ...(hint ? { categoryHint: hint } : {}),
        });
      }
    }
    if (payload.kind === "direct_booking") {
      await handleDirectBooking(payload);
    }
  }

  // US-W5: direct-booking shortcut. The user named one specific venue
  // ("Book Carbone..."); the commit route returned a pre-built BookingJobStep
  // pointing at that venue. Skip the recommendation pipeline and post
  // straight to /api/booking-jobs the same way RecommendationCard.handleReserve
  // does for clicked recommendations.
  async function handleDirectBooking(payload: CommitResponse) {
    if (!payload.booking_step || !payload.venue_name) return;

    chat.injectAssistantMessage(
      `Booking ${payload.venue_name}…`
    );

    try {
      const profileRes = await fetch("/api/user/booking-profiles?default=true");
      const { profile } = (await profileRes.json().catch(() => ({}))) as {
        profile?: {
          id: number;
          first_name: string;
          last_name: string;
          email: string;
          phone: string;
        };
      };
      if (!profile) {
        chat.injectAssistantMessage(
          `I need your contact info to book — add a booking profile in Settings, then try again.`
        );
        return;
      }

      const sessionId =
        localStorage.getItem("session_id") ?? crypto.randomUUID();
      if (!localStorage.getItem("session_id")) {
        localStorage.setItem("session_id", sessionId);
      }
      localStorage.setItem("active_profile_id", String(profile.id));

      const step = {
        ...payload.booking_step,
        body: {
          ...payload.booking_step.body,
          profileId: profile.id,
          profile: {
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
            phone: profile.phone,
          },
        },
      };

      const createRes = await fetch("/api/booking-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          trip_label: payload.venue_name,
          steps: [step],
        }),
      });
      if (!createRes.ok) {
        chat.injectAssistantMessage(
          `Couldn't start the booking job — please try the Reserve button on a recommendation card instead.`
        );
        return;
      }
      const { jobId } = (await createRes.json()) as { jobId: string };
      void fetch(`/api/booking-jobs/${jobId}/start`, { method: "POST" }).catch(
        () => {}
      );
      router.push("/tasks");
    } catch {
      chat.injectAssistantMessage(
        `Network hiccup while starting the booking. Try again in a moment.`
      );
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
    <div style={{ display: "flex", height: "100dvh" }}>
      <Sidebar
        activeSessionId={activeSessionId}
        activeRoomId={activeRoomId}
        reloadTick={sidebarReloadTick}
      />
      <main
        className="flex flex-col"
        style={{ flex: 1, minWidth: 0, backgroundColor: "var(--bg)", overflow: "hidden" }}
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
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    fontFamily: "var(--font-dm-sans)",
                    color: "var(--gold-text)",
                    background: "var(--gold-soft)",
                    padding: "4px 10px",
                    borderRadius: "var(--radius-pill)",
                    marginBottom: "8px",
                  }}
                >
                  Memory
                </span>
                <h2
                  style={{
                    fontFamily: "var(--font-playfair)",
                    fontSize: "24px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "var(--ink-9)",
                    marginBottom: "4px",
                    lineHeight: 1.15,
                  }}
                >
                  Taste profile.
                </h2>
                <p style={{ fontFamily: "var(--font-dm-sans)", fontSize: "13px", color: "var(--ink-5)", lineHeight: 1.5 }}>
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
            <div className="flex items-start justify-between mb-5">
              <div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    fontFamily: "var(--font-dm-sans)",
                    color: "var(--gold-text)",
                    background: "var(--gold-soft)",
                    padding: "4px 10px",
                    borderRadius: "var(--radius-pill)",
                    marginBottom: "8px",
                  }}
                >
                  Side by side
                </span>
                <h3
                  style={{
                    fontFamily: "var(--font-playfair)",
                    fontSize: "22px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "var(--ink-9)",
                    margin: 0,
                    lineHeight: 1.15,
                  }}
                >
                  Compare options.
                </h3>
              </div>
              <button
                onClick={() => setCompareOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontSize: "20px",
                  lineHeight: 1,
                  flexShrink: 0,
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

      {/* Stage 2: context ribbon — tells the user what thread/room they're in.
          Gold = Decision Room (multi-party, syncs to everyone); neutral =
          solo Session. Without either, no ribbon shows (fresh /). */}
      {activeRoomId ? (
        <div
          style={{
            background: "linear-gradient(180deg, rgba(201,168,76,0.18) 0%, rgba(201,168,76,0.04) 100%)",
            borderBottom: "1px solid rgba(201,168,76,0.28)",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: "var(--text-primary, #111)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>🏠</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong style={{ color: "var(--gold, #C9A84C)" }}>Decision Room</strong>
              {activeRoomTitle ? <> · {activeRoomTitle}</> : null}
            </span>
            {/* Member avatar pills — visible proof of who's in the room.
                Replaces the "...syncs to everyone" tagline so the user has
                concrete confirmation rather than trusting the agent's
                reply that "X 已加入". status="invited" gets a hatched ring
                to mark "still pending". */}
            {activeRoomMembers.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: 4 }}>
                {activeRoomMembers.slice(0, 5).map((m) => {
                  const label = m.display_name || m.username || "?";
                  const initial = label.slice(0, 1).toUpperCase();
                  const pending = m.status === "invited";
                  return (
                    <div
                      key={m.user_id}
                      title={`${label}${pending ? " (邀请中)" : m.is_creator ? " (创建者)" : ""}`}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: m.avatar_url ? "transparent" : "rgba(201,168,76,0.85)",
                        backgroundImage: m.avatar_url ? `url(${m.avatar_url})` : undefined,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontSize: 10,
                        fontWeight: 600,
                        border: pending
                          ? "1.5px dashed rgba(201,168,76,0.7)"
                          : "1.5px solid rgba(201,168,76,0.5)",
                        opacity: pending ? 0.65 : 1,
                      }}
                    >
                      {!m.avatar_url ? initial : null}
                    </div>
                  );
                })}
                {activeRoomMembers.length > 5 && (
                  <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>
                    +{activeRoomMembers.length - 5}
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => router.push("/rooms")}
              style={{
                background: "transparent",
                border: "1px solid rgba(201,168,76,0.4)",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 11,
                color: "var(--gold, #C9A84C)",
                cursor: "pointer",
              }}
            >
              All rooms
            </button>
            <button
              type="button"
              onClick={() => {
                replayedRoomIds.current.delete(activeRoomId);
                setActiveRoomId(null);
                router.replace("/");
              }}
              style={{
                background: "transparent",
                border: "1px solid rgba(201,168,76,0.2)",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 11,
                color: "var(--text-muted, #888)",
                cursor: "pointer",
              }}
            >
              Exit room
            </button>
          </div>
        </div>
      ) : activeSessionId ? (
        /* Solo chat session ribbon — neutral styling to distinguish from
           Rooms. Only exit action; session list is in the sidebar. */
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid var(--border, #2a2622)",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: "var(--text-muted, #888)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💬</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong style={{ color: "var(--text-primary, #eee)" }}>Solo chat</strong>
              {activeSessionTitle ? <> · {activeSessionTitle}</> : null}
              <span style={{ opacity: 0.7 }}> · private to you</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveSessionId(null);
              router.push("/");
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--border, #2a2622)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 11,
              color: "var(--text-muted, #888)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            New chat
          </button>
        </div>
      ) : null}

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
        <div
          className="flex-1 overflow-y-auto"
          style={{
            minHeight: 0,
            // Left-edge accent stripe visually brands the current context.
            // Gold strip = Decision Room, muted strip = Solo chat, none = fresh.
            borderLeft: activeRoomId
              ? "3px solid rgba(201,168,76,0.55)"
              : activeSessionId
                ? "3px solid rgba(255,255,255,0.12)"
                : "none",
          }}
        >
          <div className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto w-full px-4 md:px-6 lg:px-8 py-6">

            {!hasMessages ? (
              /* Welcome / Hero State */
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                {/* Eyebrow — matches the gold-soft pill used on every other
                    main-nav page (/pricing, /account, /rooms, /tasks etc) so
                    the homepage feels like the same product family rather
                    than a separate chat surface. */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
                    color: "var(--gold-text)",
                    background: "var(--gold-soft)",
                    padding: "5px 14px",
                    borderRadius: "var(--radius-pill)",
                    marginBottom: 24,
                    opacity: heroVisible ? 1 : 0,
                    transform: heroVisible ? "translateY(0)" : "translateY(-6px)",
                    transition: "opacity 0.5s ease, transform 0.5s ease",
                  }}
                >
                  Onegent
                </span>
                {/* City name embedded in headline */}
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <h2
                    style={{
                      fontFamily: "var(--font-playfair)",
                      fontSize: "clamp(32px, 5.5vw, 52px)",
                      fontWeight: 600,
                      letterSpacing: "-0.025em",
                      color: "var(--ink-9)",
                      lineHeight: 1.1,
                      marginBottom: 14,
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
                        Decide together — dinner, weekend trips, group plans
                      </p>
                    </div>
                    <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--gold)", flexShrink: 0 }}>
                      Open →
                    </span>
                  </Link>
                </div>

                {/* Recent DR partners — one-tap entry into a new Decision Room
                    with someone you've decided with before. Hidden when signed
                    out or no co-DR history (gracefully empty, never a stub). */}
                {recentContacts.length > 0 && (
                  <div style={{ width: "100%", maxWidth: 440, marginTop: 18 }}>
                    <p
                      style={{
                        fontFamily: "var(--font-dm-sans)",
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.14em",
                        color: "var(--text-muted)",
                        margin: "0 0 10px 2px",
                      }}
                    >
                      Decide with
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {recentContacts.map((c) => {
                        const label = c.nickname ?? c.display_name ?? `@${c.profile_code}`;
                        const initial = label.slice(0, 1).toUpperCase();
                        return (
                          <button
                            key={c.contact_user_id}
                            type="button"
                            onClick={() => {
                              // Plan A: instead of opening the legacy
                              // DecisionRoomModal (form-based), pre-fill the
                              // chat input so the user can finish the prompt
                              // naturally. NLU picks up the named co-decider
                              // and routes to a chat-flow Decision Room.
                              const handle = c.nickname ?? c.display_name ?? `@${c.profile_code}`;
                              const prefill = `我和 ${handle} 一起决定 `;
                              chat.setInput(prefill);
                              chatInputRef.current = prefill;
                              const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
                                "[data-chat-input]",
                              );
                              if (el) {
                                el.focus();
                                if (typeof el.setSelectionRange === "function") {
                                  el.setSelectionRange(prefill.length, prefill.length);
                                }
                              }
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 12px 6px 6px",
                              borderRadius: 999,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              cursor: "pointer",
                              fontFamily: "var(--font-dm-sans)",
                              fontSize: 13,
                              color: "var(--text-primary)",
                              transition: "border-color 120ms",
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLElement).style.borderColor = "var(--gold)";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                            }}
                          >
                            {c.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={c.avatar_url}
                                alt=""
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <span
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  background: "var(--gold)",
                                  color: "white",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  flexShrink: 0,
                                }}
                              >
                                {initial}
                              </span>
                            )}
                            <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

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
                        <div className="chat-msg chat-msg--user">
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
                      <div className="chat-msg--assistant-stack">
                        <p className="chat-msg chat-msg--assistant">{msg.content}</p>
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
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* P1-15: NLU pending indicator — shown while /api/chat/parse is in flight */}
                {nluPending && <div className="chat-thinking">Thinking…</div>}

                {/* P1-15: Quick-pick chips — rendered when NLU asked a clarifying question */}
                {pendingQuickPicks && pendingQuickPicks.length > 0 && (
                  <div className="chat-quickpicks">
                    {pendingQuickPicks.map((pick) => (
                      <button
                        key={`qp-${pick.value}`}
                        type="button"
                        onClick={() => handleQuickPick(pick.value)}
                        disabled={chat.loading || nluPending}
                        className="chat-quickpick"
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
                    // Stage 2: pass the conversation that built up to confirm
                    // so chat-flow trip rooms can seed their private channel.
                    // Use chat.messages (rendered text), NOT nluHistoryRef
                    // (which stores stringified NLU JSON for the next parse).
                    history={chat.messages
                      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0)
                      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))}
                    sessionId={activeSessionId}
                    onConfirmed={handleConfirmCommitted}
                    onEdit={handleConfirmEdit}
                  />
                )}

                {/* Stage 2 · T11: inline trip proposal card for multi-party trip rooms.
                    Mounts when synthesis has created a proposal (activeProposalId is
                    set via the private-messages replay or after a force-synthesize
                    click). 4-column picker + per-item vote badges + payer-only book. */}
                {activeRoomId && activeProposalId && (
                  <TripProposalChatCard
                    key={activeProposalId}
                    roomId={activeRoomId}
                    proposalId={activeProposalId}
                    userId={userId ?? null}
                  />
                )}

                {/* Stage 2 synthesize progress: 4 parallel pipelines kicking off
                    in the background can take 5-15s; without this indicator the
                    chat looks frozen between "好的，我去综合方案" and the
                    proposal card landing. Each chip pulses gold via a shared
                    keyframe so users see forward motion.
                    Visible on TWO triggers: the local user fired synthesize
                    (synthesizing), OR another member did and the server flagged
                    is_synthesizing for the room (remoteSynthesizing via the
                    proposal-watcher poll). */}
                {(synthesizing || remoteSynthesizing) && (
                  <div
                    style={{
                      border: "1px solid rgba(201,168,76,0.35)",
                      borderRadius: 14,
                      padding: 14,
                      backgroundColor: "var(--card-2, #f7f7f7)",
                      marginTop: 8,
                      fontFamily: "var(--font-dm-sans)",
                    }}
                  >
                    <style>{`
                      @keyframes synthPulse {
                        0%, 100% { opacity: 0.55; }
                        50%      { opacity: 1;    }
                      }
                      .synth-chip {
                        animation: synthPulse 1.4s ease-in-out infinite;
                      }
                      .synth-chip-1 { animation-delay: 0s; }
                      .synth-chip-2 { animation-delay: 0.15s; }
                      .synth-chip-3 { animation-delay: 0.3s; }
                      .synth-chip-4 { animation-delay: 0.45s; }
                      @keyframes synthBar {
                        0%   { transform: translateX(-100%); }
                        100% { transform: translateX(400%);  }
                      }
                    `}</style>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111)", marginBottom: 10 }}>
                      🤖 正在为你们综合方案…
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {[
                        { emoji: "🏨", label: "Hotel", cls: "synth-chip-1" },
                        { emoji: "✈", label: "Flight", cls: "synth-chip-2" },
                        { emoji: "🎟", label: "Shows", cls: "synth-chip-3" },
                        { emoji: "🍽", label: "Food", cls: "synth-chip-4" },
                      ].map((c) => (
                        <span
                          key={c.label}
                          className={`synth-chip ${c.cls}`}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 11,
                            color: "var(--text-secondary, #555)",
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: "rgba(201,168,76,0.35)",
                            backgroundColor: "var(--card, #fff)",
                          }}
                        >
                          {c.emoji} {c.label}
                        </span>
                      ))}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        height: 4,
                        borderRadius: 2,
                        background: "rgba(201,168,76,0.12)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          height: "100%",
                          width: "25%",
                          background: "var(--gold, #c9a648)",
                          animation: "synthBar 1.8s ease-in-out infinite",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted, #888)", marginTop: 8 }}>
                      并行跑 4 条品类 pipeline，通常 5-15 秒。
                    </div>
                  </div>
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
      <div className="chat-bottombar">
        <div className="chat-bottombar__inner">
          {/* New chat button — only show when there's conversation history */}
          {hasMessages && (
            <button
              onClick={() => { chat.clearChat(); setInlineItems([]); setPendingTravelDoc(null); nluHistoryRef.current = []; lastNluStateRef.current = null; }}
              title="Start a new conversation"
              className="chat-newchat"
              aria-label="Start a new conversation"
            >
              ✕
            </button>
          )}
          <input
            type="text"
            data-chat-input
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
            className={`chat-input${isListening ? " chat-input--listening" : ""}`}
            disabled={chat.loading || isListening}
          />
          {/* Phase 5.2: Mic button — hidden when voice not supported */}
          {voiceSupported && (
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={chat.loading}
              aria-label={isListening ? "Stop listening" : "Start voice input"}
              className={`chat-mic${isListening ? " chat-mic--listening" : ""}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="9" y="2" width="6" height="14" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          <button
            onClick={sendCurrentInput}
            disabled={chat.loading || !chat.input.trim()}
            aria-label="Send"
            className="chat-send"
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

      {/* Plan A: DecisionRoomModal removed. Multi-decider intent now
          flows through the homepage chat — user types "我和X..." and
          the NLU's create_room intent routes to the chat-flow DR via
          /api/chat/commit (see commit route's create_room branch). The
          legacy /decide/[sessionId] form path is no longer reachable
          from this page. */}
      </main>
    </div>
  );
}

// Suspense wrapper — required by Next.js because HomeInner uses
// useSearchParams. Without this, prerender bails. Renders nothing while
// the client picks up the URL on mount; in practice this is a single
// frame so the user never sees the fallback.
export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

