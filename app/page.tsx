"use client";

import { useRef, useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { TravelDocRequest } from "@/components/booking/InlineJobCard";
import type { InlineTaskWatchState } from "@/components/chat/InlineTaskWatchPanel";
import type { GapSavePayload } from "@/components/profile-gap/types";
import {
  commitResponseToDecisionInput,
  decideProfileGap,
} from "@/lib/profile-gap-decision";
import { makeProfileGapOnSave } from "@/lib/profile-gap-on-save";
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
import { PlanAction, PlanLinkAction, RecommendationCard as CardType, PostExperienceFeedback, FeedbackRecord, Message } from "@/lib/types";
import type { FeedbackPromptItem } from "@/app/api/feedback-prompts/route";
import type { CommitResponse } from "@/components/ConfirmCard";
import type { TripPackage } from "@/lib/types";
import type { TripIntentState } from "@/lib/agent/trip-intent-state";
import { useLanguage } from "@/app/hooks/useLanguage";
import GlobalNav from "@/components/GlobalNav";
import Sidebar from "@/components/Sidebar";
import { fetchAppBootstrapCached } from "@/components/app-bootstrap-client";
import type { AppBootstrapRecentJob } from "@/lib/app-bootstrap";
import MentionPicker, { type MentionContact } from "@/components/MentionPicker";
import {
  looksLikeRecommendationAsk,
  getFallbackQuickPicks,
} from "@/lib/quick-picks-fallback";
import type {
  ConversationalNLUResult,
  ProfilePatch,
  QuickPick,
} from "@/lib/agent/nlu-v2";
import type { ChatMessage } from "@/lib/llm-client";
import { loadAgentModelConfig } from "@/lib/agent-model-config";
import { getTaskWorkspaceHref, taskWorkspaceHrefForView } from "@/lib/booking-jobs/workspace";
import {
  buildRoomReplaySnapshot,
  buildSessionReplaySnapshot,
  type InlineBookingProfileSnapshot,
  type PendingConfirmSnapshot,
  type PersistedDirectBookingPayload,
  type RoomReplaySnapshot,
  type SessionReplaySnapshot,
} from "@/lib/chat-replay";
import { useRouter } from "next/navigation";
import "./tasks/tasks.css";
import "@/components/chat.css";

type MinimalBookingProfile = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

type MinimalBookingProfileDraft = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

type InlineBookingProfileState = {
  id: number | null;
  venueName: string;
  payload: CommitResponse;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  missing: string[];
};

// Leaflet is not SSR-compatible
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const RecommendationCard = dynamic(() => import("@/components/RecommendationCard"), { loading: LazySurfaceFallback });
const HotelCard = dynamic(() => import("@/components/HotelCard"), { loading: LazySurfaceFallback });
const FlightCard = dynamic(() => import("@/components/FlightCard"), { loading: LazySurfaceFallback });
const ActivityCard = dynamic(() => import("@/components/ActivityCard"), { loading: LazySurfaceFallback });
const InlineJobCard = dynamic(() => import("@/components/booking/InlineJobCard"), { loading: LazySurfaceFallback });
const InlineBookingProfileGate = dynamic(() => import("@/components/booking/InlineBookingProfileGate"), { loading: () => null });
const ProfileGapCard = dynamic(() => import("@/components/profile-gap").then((m) => m.ProfileGapCard), { loading: LazySurfaceFallback });
const ScenarioPlanView = dynamic(() => import("@/components/ScenarioPlanView"), { loading: LazySurfaceFallback });
const FeedbackPromptCard = dynamic(() => import("@/components/FeedbackPromptCard"), { loading: LazySurfaceFallback });
const DateRangePicker = dynamic(() => import("@/components/DateRangePicker"), { loading: LazySurfaceFallback });
const ConfirmCard = dynamic(() => import("@/components/ConfirmCard"), { loading: LazySurfaceFallback });
const TripPackageCard = dynamic(() => import("@/components/TripPackageCard"), { loading: LazySurfaceFallback });
const TripProposalChatCard = dynamic(() => import("@/components/TripProposalChatCard"), { loading: LazySurfaceFallback });
const ScenarioProposalChatCard = dynamic(() => import("@/components/ScenarioProposalChatCard"), { loading: LazySurfaceFallback });
const InlineTaskWatchPanel = dynamic(() => import("@/components/chat/InlineTaskWatchPanel"), {
  ssr: false,
  loading: () => (
    <div className="chat-task-watch-panel" style={{ padding: 16, color: "#f8fafc", fontSize: 13 }}>
      Loading task observer...
    </div>
  ),
});

function LazySurfaceFallback() {
  return (
    <div
      aria-hidden
      style={{
        minHeight: 88,
        borderRadius: 16,
        border: "0.5px solid var(--border, #e5e7eb)",
        background: "var(--card, #fff)",
      }}
    />
  );
}

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
  const { userId, userDisplayName, userEmail, isSignedIn } = useAuth();
  const { aiInstruction: languageInstruction, t } = useLanguage();
  const th = t.home;
  const tn = t.nav;

  const location = useLocation();
  const subs = useSubscriptions();
  // Refs so the persist callback reads the latest active context. useChat's
  // emitCardsResult also goes through a ref, so the closure stays correct
  // when the user switches rooms/sessions mid-stream. Synced from state
  // below once we declare activeRoomId/activeSessionId.
  const activeRoomIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const persistCardsResult = useCallback((msg: Message) => {
    // Build a payload narrow to A1 scope: restaurant/hotel/flight/activity
    // cards. Other result modes (scenario_plan, credit_card, etc) are
    // out of scope and persist nothing — those will be added in A2.
    const hasRestaurantCards = (msg.cards?.length ?? 0) > 0;
    const hasHotelCards = (msg.hotelCards?.length ?? 0) > 0;
    const hasFlightCards = (msg.flightCards?.length ?? 0) > 0;
    const hasActivityCards = (msg.activityCards?.length ?? 0) > 0;
    if (!hasRestaurantCards && !hasHotelCards && !hasFlightCards && !hasActivityCards) {
      return;
    }
    const meta_json: Record<string, unknown> = { kind: "search_cards" };
    if (hasRestaurantCards) meta_json.cards = msg.cards;
    if (hasHotelCards) meta_json.hotelCards = msg.hotelCards;
    if (hasFlightCards) meta_json.flightCards = msg.flightCards;
    if (hasActivityCards) meta_json.activityCards = msg.activityCards;
    if (msg.category) meta_json.category = msg.category;
    if (msg.output_language) meta_json.output_language = msg.output_language;

    const roomId = activeRoomIdRef.current;
    const sessionId = activeSessionIdRef.current;
    const body = JSON.stringify({
      role: "assistant",
      content: msg.content,
      meta_json,
    });
    const headers = { "Content-Type": "application/json" };
    if (roomId) {
      // Room context wins — same precedence as the rest of the page.
      void fetch(`/api/rooms/${roomId}/private-messages`, { method: "POST", headers, body }).catch(() => {});
    } else if (sessionId) {
      void fetch(`/api/chat/sessions/${sessionId}/messages`, { method: "POST", headers, body }).catch(() => {});
    }
  }, []);
  const persistThreadMessage = useCallback(async (params: {
    role: "user" | "assistant";
    content: string;
    meta_json?: Record<string, unknown> | null;
  }) => {
    if (!params.content.trim()) return;
    const roomId = activeRoomIdRef.current;
    const sessionId = activeSessionIdRef.current;
    const body = JSON.stringify({
      role: params.role,
      content: params.content,
      meta_json: params.meta_json ?? null,
    });
    const headers = { "Content-Type": "application/json" };
    try {
      if (roomId) {
        await fetch(`/api/rooms/${roomId}/private-messages`, { method: "POST", headers, body });
      } else if (sessionId) {
        await fetch(`/api/chat/sessions/${sessionId}/messages`, { method: "POST", headers, body });
      }
    } catch {
      // best-effort persistence only
    }
  }, []);
  const restorePendingConfirmState = useCallback((next: PendingConfirmSnapshot | null) => {
    setPendingConfirm(next);
  }, []);
  const restoreInlineBookingProfileState = useCallback((next: InlineBookingProfileSnapshot | null) => {
    if (!next) {
      setInlineBookingProfile(null);
      return;
    }
    setInlineBookingProfile({
      id: next.id,
      venueName: next.venueName,
      payload: next.payload as unknown as CommitResponse,
      first_name: next.first_name,
      last_name: next.last_name,
      email: next.email,
      phone: next.phone,
      missing: next.missing,
    });
  }, []);
  const persistPendingConfirmState = useCallback((next: PendingConfirmSnapshot | null) => {
    void persistThreadMessage({
      role: "assistant",
      content: "__pending_confirm_state__",
      meta_json: {
        kind: "pending_confirm_state",
        state: next ? "open" : "closed",
        confirm: next,
      },
    });
  }, [persistThreadMessage]);
  const persistInlineBookingProfileState = useCallback((next: InlineBookingProfileState | null) => {
    const gate = next
      ? {
          id: next.id,
          venueName: next.venueName,
          payload: {
            kind: "direct_booking",
            venue_name: next.payload.venue_name ?? next.venueName,
            booking_step: next.payload.booking_step!,
          } as PersistedDirectBookingPayload,
          first_name: next.first_name,
          last_name: next.last_name,
          email: next.email,
          phone: next.phone,
          missing: next.missing,
        }
      : null;
    void persistThreadMessage({
      role: "assistant",
      content: "__inline_booking_profile_state__",
      meta_json: {
        kind: "inline_booking_profile_state",
        state: gate ? "open" : "closed",
        gate,
      },
    });
  }, [persistThreadMessage]);

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
    onCardsResult: persistCardsResult,
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
  // Keep the persist-cards callback's refs in sync with state.
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  // Stage 2 · T11: when a trip room has an active proposal, render
  // <TripProposalChatCard> inline in the chat stream. The id comes from the
  // most recent private_message with meta_json.kind='trip_proposal_card'.
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  // Companion to activeProposalId: which inline card component to render.
  // 'trip' → <TripProposalChatCard>, 'scenario' → <ScenarioProposalChatCard>.
  // Set from chat-replay's snapshot.proposalKind on room load and from the
  // synthesize response's room_type on live fire.
  const [activeProposalKind, setActiveProposalKind] = useState<"trip" | "scenario" | null>(null);
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
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmSnapshot | null>(null);
  const [pendingQuickPicks, setPendingQuickPicks] = useState<QuickPick[] | null>(null);
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
  const [inlineBookingProfile, setInlineBookingProfile] = useState<InlineBookingProfileState | null>(null);
  const [inlineBookingProfileSaving, setInlineBookingProfileSaving] = useState(false);
  const [inlineBookingProfileError, setInlineBookingProfileError] = useState<string | null>(null);
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
      setInlineItems([]);
      closeInlineWatchPanel();
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
          restorePendingConfirmState(cached.pendingConfirm);
          restoreInlineBookingProfileState(cached.inlineBookingProfile);
          nluHistoryRef.current = cached.nluHistory;
          lastNluStateRef.current = cached.lastNluState;
          replayedSessionIds.current.add(activeSessionId);
          restored = true;
        }
      } else if (activeRoomId) {
        const cached = roomReplayCacheRef.current.get(activeRoomId);
        if (cached) {
          chat.replaceMessages(cached.messages);
          restorePendingConfirmState(null);
          restoreInlineBookingProfileState(null);
          setActiveProposalId(cached.proposalId);
          setActiveProposalKind(cached.proposalKind);
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
        restorePendingConfirmState(null);
        restoreInlineBookingProfileState(null);
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
      setActiveProposalKind(null);
      return;
    }
    const cachedTitle = roomTitleCacheRef.current.get(activeRoomId) ?? null;
    setActiveRoomTitle(cachedTitle);
    setActiveProposalId(null);
    setActiveProposalKind(null);
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
        proposalKind: activeProposalKind,
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
      pendingConfirm,
      inlineBookingProfile: inlineBookingProfile
        ? {
            id: inlineBookingProfile.id,
            venueName: inlineBookingProfile.venueName,
            payload: {
              kind: "direct_booking",
              venue_name: inlineBookingProfile.payload.venue_name ?? inlineBookingProfile.venueName,
              booking_step: inlineBookingProfile.payload.booking_step!,
            },
            first_name: inlineBookingProfile.first_name,
            last_name: inlineBookingProfile.last_name,
            email: inlineBookingProfile.email,
            phone: inlineBookingProfile.phone,
            missing: inlineBookingProfile.missing,
          }
        : null,
    });
  }, [
    activeProposalId,
    activeRoomId,
    activeRoomTitle,
    activeSessionId,
    activeSessionTitle,
    chat.messages,
    inlineBookingProfile,
    pendingConfirm,
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
        restorePendingConfirmState(cached.pendingConfirm);
        restoreInlineBookingProfileState(cached.inlineBookingProfile);
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
            meta_json?: Record<string, unknown> | null;
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
        restorePendingConfirmState(snapshot.pendingConfirm);
        restoreInlineBookingProfileState(snapshot.inlineBookingProfile);
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
        restorePendingConfirmState(null);
        restoreInlineBookingProfileState(null);
        setActiveProposalId(cached.proposalId);
        setActiveProposalKind(cached.proposalKind);
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
        restorePendingConfirmState(null);
        restoreInlineBookingProfileState(null);
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
        setActiveProposalKind(snapshot.proposalKind);
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
  // Drives the synth-spinner chips: 'trip' shows 4 pipelines (Hotel/
  // Flight/Shows/Food); single-category rooms show their one chip.
  // Mirrors poll's scenario_category so spinner copy matches the room.
  const [synthesizingCategory, setSynthesizingCategory] = useState<
    "restaurant" | "hotel" | "flight" | "activity" | "trip" | null
  >(null);
  useEffect(() => {
    if (!activeRoomId) {
      setRemoteSynthesizing(false);
      setSynthesizingCategory(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/rooms/${activeRoomId}/trip-proposal`);
        if (cancelled) return;
        // Room dissolved by creator (404) or membership revoked (403): clear
        // the active room, kick back to /, and surface a toast so the user
        // understands why their view changed. Without this the banner +
        // proposal card stay mounted on a zombie roomId and the user is
        // stuck staring at "无法加载方案".
        if (res.status === 404 || res.status === 403) {
          const goneId = activeRoomId;
          setActiveRoomId(null);
          setActiveProposalId(null);
          setActiveProposalKind(null);
          replayedRoomIds.current.delete(goneId);
          router.replace("/");
          setRoomGoneToast("房间已被创建人解散");
          setTimeout(() => setRoomGoneToast(null), 3500);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          proposal?: { id?: string } | null;
          scenario_proposal_id?: string | null;
          scenario_category?: string | null;
          is_synthesizing?: boolean;
        };
        if (cancelled) return;
        if (data.proposal?.id) {
          setActiveProposalId((prev) => (prev === data.proposal!.id ? prev : data.proposal!.id!));
          setActiveProposalKind("trip");
          setRemoteSynthesizing(false);
        } else if (data.scenario_proposal_id) {
          // Non-trip DR — scenario synthesis just landed (or already had).
          // Member B sees the card without refreshing.
          setActiveProposalId((prev) =>
            prev === data.scenario_proposal_id ? prev : data.scenario_proposal_id!,
          );
          setActiveProposalKind("scenario");
          setRemoteSynthesizing(false);
        } else {
          setRemoteSynthesizing(!!data.is_synthesizing);
          // scenario_category is null for trip rooms; leave it as 'trip'
          // sentinel so the spinner falls back to 4-chip mode.
          if (data.is_synthesizing) {
            const cat = data.scenario_category;
            if (cat === "restaurant" || cat === "hotel" || cat === "flight" || cat === "activity") {
              setSynthesizingCategory(cat);
            } else {
              setSynthesizingCategory("trip");
            }
          }
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
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  }[]>([]);
  // Full contacts list, for the @-mention picker on the chat input.
  const [allContacts, setAllContacts] = useState<MentionContact[]>([]);
  const contactsUserIdRef = useRef<string | null>(null);
  const recentContactsLoadedRef = useRef(false);
  const allContactsLoadedRef = useRef(false);
  // user_ids currently @-mentioned in the input. Resolved live from text
  // by MentionPicker; we just hold the latest value.
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  // username (lowercase) → user_id, for users resolved via "Look up @xyz..."
  // (sent contact request inline). MentionPicker uses this to attribute
  // mentions for handles that aren't yet in allContacts.
  const [pendingInvites, setPendingInvites] = useState<Record<string, string>>({});
  const [mentionToast, setMentionToast] = useState<string | null>(null);
  // Banner toast shown when the active room gets deleted by its creator while
  // a non-creator member has the URL open. Wired to the trip-proposal poller
  // (404/403 → room is gone). Three seconds is enough to read and matches
  // the mentionToast cadence so the UI feels coherent.
  const [roomGoneToast, setRoomGoneToast] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<AppBootstrapRecentJob[]>([]);
  // Inline booking task cards rendered below results
  const [inlineItems, setInlineItems] = useState<{ type: "job"; jobId: string }[]>([]);
  const [inlineWatchPanel, setInlineWatchPanel] = useState<InlineTaskWatchState | null>(null);
  const [inlineWatchKey, setInlineWatchKey] = useState(0);
  const inlineWatchJobIdRef = useRef<string | null>(null);
  const openInlineWatchPanel = useCallback((jobId: string, title: string) => {
    if (inlineWatchJobIdRef.current !== jobId) {
      setInlineWatchKey((key) => key + 1);
    }
    inlineWatchJobIdRef.current = jobId;
    setInlineWatchPanel({
      jobId,
      title: title ? `Agent - ${title}` : "Agent",
    });
  }, []);
  const closeInlineWatchPanel = useCallback(() => {
    inlineWatchJobIdRef.current = null;
    setInlineWatchPanel(null);
  }, []);
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
  const hasMessages = chat.messages.length > 0;

  const loadRecentContacts = useCallback(async () => {
    if (recentContactsLoadedRef.current) return;
    recentContactsLoadedRef.current = true;
    try {
      const response = await fetch("/api/contacts/recent");
      const data: { contacts?: typeof recentContacts } = response.ok
        ? await response.json()
        : { contacts: [] };
      setRecentContacts(data.contacts ?? []);
    } catch {
      recentContactsLoadedRef.current = false;
      setRecentContacts([]);
    }
  }, []);

  const loadAllContacts = useCallback(async () => {
    if (allContactsLoadedRef.current) return;
    allContactsLoadedRef.current = true;
    try {
      const response = await fetch("/api/contacts");
      const data: {
        contacts?: Array<{
          contact_user_id: string;
          nickname: string | null;
          profile_code: string | null;
          username?: string | null;
          display_name: string | null;
          avatar_url: string | null;
        }>;
      } = response.ok ? await response.json() : { contacts: [] };
      const list: MentionContact[] = (data.contacts ?? []).map((contact) => ({
        user_id: contact.contact_user_id,
        username: contact.username ?? null,
        display_name: contact.display_name ?? contact.nickname ?? null,
        avatar_url: contact.avatar_url ?? null,
        profile_code: contact.profile_code ?? null,
      }));
      setAllContacts(list);
    } catch {
      allContactsLoadedRef.current = false;
      setAllContacts([]);
    }
  }, []);

  // Load recent jobs for home page strip
  useEffect(() => {
    const sid = chat.getSessionId();
    if (!sid) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchAppBootstrapCached(sid)
        .then((d) => {
          if (!cancelled) setRecentJobs(d.recent_jobs ?? []);
        })
        .catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
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
    if (!auth.isSignedIn) {
      contactsUserIdRef.current = null;
      recentContactsLoadedRef.current = false;
      allContactsLoadedRef.current = false;
      setRecentContacts([]);
      setAllContacts([]);
      return;
    }
    if (contactsUserIdRef.current !== auth.userId) {
      contactsUserIdRef.current = auth.userId;
      recentContactsLoadedRef.current = false;
      allContactsLoadedRef.current = false;
      setRecentContacts([]);
      setAllContacts([]);
    }
    if (hasMessages) return;
    const timer = window.setTimeout(() => {
      void loadRecentContacts();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [auth.isSignedIn, auth.userId, hasMessages, loadRecentContacts]);

  // Full contacts list for the @-mention picker. It is not needed for the
  // default home page, so load it only when the user starts a mention.
  useEffect(() => {
    if (!auth.isSignedIn) return;
    if (!chat.input.includes("@")) return;
    void loadAllContacts();
  }, [auth.isSignedIn, auth.userId, chat.input, loadAllContacts]);

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
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/feedback-prompts?session_id=${encodeURIComponent(sessionId)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!cancelled && data?.prompts?.length) {
            setPendingFeedbackPrompts(data.prompts);
          }
        })
        .catch(() => {});
    }, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
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
    await fetch(`/api/booking-jobs/${req.jobId}/start?executor=inline`, { method: "POST" }).catch(() => {});

    chat.injectAssistantMessage(
      `Got it — travel documents saved. Retrying your flight booking now…`
    );
  }

  // MentionPicker calls this when user picks "Look up @<handle>" — we resolve
  // the handle via the public profile endpoint, immediately fire a contact
  // request, and remember the user_id keyed by lowercase username so the
  // mention bubbles up as a real user_id even though the request is still
  // pending. Returns the canonical username so MentionPicker splices it back
  // into the text (handles case-mismatch). Returns null on 404.
  async function handleMentionLookup(rawHandle: string): Promise<{
    user_id: string;
    username: string;
    display_name: string | null;
  } | null> {
    const handle = rawHandle.trim().replace(/^@/, "");
    if (!handle) return null;
    try {
      const res = await fetch(`/api/users/by-code/${encodeURIComponent(handle)}`);
      if (!res.ok) {
        if (res.status === 404) {
          setMentionToast(`@${handle} not found`);
          setTimeout(() => setMentionToast(null), 3000);
        } else {
          setMentionToast("Lookup failed.");
          setTimeout(() => setMentionToast(null), 3000);
        }
        return null;
      }
      const body = (await res.json()) as {
        user: {
          user_id: string;
          username: string | null;
          display_name: string | null;
          profile_code: string;
        };
      };
      const u = body.user;
      const resolvedUsername = (u.username ?? handle).toLowerCase();
      // Fire-and-forget contact request — server is idempotent (409 if already
      // a contact, 429 if too soon since last request, both fine for our path).
      void fetch("/api/contacts/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_code: u.profile_code }),
      }).catch(() => {});
      setPendingInvites((prev) => ({ ...prev, [resolvedUsername]: u.user_id }));
      const label = u.display_name ?? u.username ?? handle;
      setMentionToast(`Sent request to ${label} — added to chat`);
      setTimeout(() => setMentionToast(null), 3000);
      return {
        user_id: u.user_id,
        username: u.username ?? handle,
        display_name: u.display_name,
      };
    } catch {
      setMentionToast("Lookup failed.");
      setTimeout(() => setMentionToast(null), 3000);
      return null;
    }
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
    if (pendingConfirm) {
      restorePendingConfirmState(null);
      persistPendingConfirmState(null);
    }
    setPendingQuickPicks(null);

    // Snapshot @-mentions BEFORE clearing the input — MentionPicker will fire
    // onMentionsChange([]) once chat.setInput("") propagates, but we still need
    // the captured ids on the eventual ConfirmCard commit.
    const capturedMentionIds = mentionedUserIds;

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
          // @-mentions resolved client-side (deterministic — no LLM guessing).
          // Server uses these directly to set party_type=multi + skip name
          // resolution entirely.
          ...(mentionedUserIds.length > 0 ? { mentioned_user_ids: mentionedUserIds } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok: boolean;
            result: ConversationalNLUResult;
            session_id?: string | null;
            /** Server flag: every joined member of this DR has contributed
             *  intent state, no invitees pending, no live proposal yet — so
             *  this client should auto-fire /api/rooms/[id]/synthesize and
             *  surface the merged-search cards. */
            scenario_synthesis_ready?: boolean;
            /** Contact ids the server matched against the caller's contacts
             *  via natural-language member_names (no @-picker required).
             *  Merged into capturedMentionIds below so the eventual
             *  ConfirmCard commit treats them identically to explicit @s. */
            auto_mentioned_user_ids?: string[];
          }
        | null;

      // Network / NLU failure → fall back to the old restaurant search pipeline
      // so the user still gets results rather than a dead chat.
      if (!data || !data.ok) {
        learnFromSearch(text);
        chat.sendMessage(text, undefined, { skipUserPush: true });
        return;
      }

      const nlu = data.result;

      // Merge server-resolved contact ids (from natural-language
      // member_names) into the captured mention list so downstream
      // setPendingConfirm calls treat them identically to explicit @-picker
      // mentions. Dedupe by Set in case the user both @-tagged and named
      // the same person in free text.
      const mergedMentionIds = (() => {
        const auto = data.auto_mentioned_user_ids ?? [];
        if (auto.length === 0) return capturedMentionIds;
        return Array.from(new Set([...capturedMentionIds, ...auto]));
      })();

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

      // Phase 1 #7 path A — apply_profile_patch dispatcher.
      // User said "save my DOB 1995/05/15" / "我的护照号 A1234567" / etc.
      // mid-conversation. PATCH the profile, do NOT advance any booking
      // pipeline — the IntentState's ambient booking sub-state is preserved
      // by the extractor so the next turn picks up where the user left off.
      // See NLU_CONSUMER_CONTRACT.md § "apply_profile_patch" for the contract,
      // PHASE_1_7_SPEC.md for the design.
      const v2Action = nlu.__v2_action;
      if (v2Action?.type === "apply_profile_patch") {
        // Always render the Layer 1 conversational reply first ("Got it —
        // saved your DOB."). Empty-patch case is impossible here: router
        // returns continue_chat instead when patch has no usable fields.
        if (nlu.assistant_reply) chat.injectAssistantMessage(nlu.assistant_reply);
        await dispatchProfilePatch(v2Action.patch);
        return;
      }

      // Trip scenario runs through a dedicated package planner (not the legacy
      // search). Surface a ConfirmCard so the user can review what we captured
      // before we spend 10-15s running hotel+flight pipelines in parallel.
      // !activeRoomId: inside a DR, "create new trip plan" makes no sense —
      // the DR IS the plan, the user is just refining their preferences.
      if (nlu.intent === "create_plan" && nlu.confirm_ready && nlu.scenario === "trip" && !activeRoomId) {
        if (nlu.assistant_reply) chat.injectAssistantMessage(nlu.assistant_reply);
        const nextConfirm: PendingConfirmSnapshot = { nlu, message: text, kind: "trip", mentioned_user_ids: mergedMentionIds };
        restorePendingConfirmState(nextConfirm);
        persistPendingConfirmState(nextConfirm);
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
      // !activeRoomId: same reason as the trip branch above. Inside a DR a
      // member's preference message is constraint-collection input, not a
      // request to create a new individual plan. Without this guard each
      // member's chat would pop a ConfirmCard, confirm-click would fire
      // /api/chat with that single member's preferences, and the
      // multi-party merge gets bypassed entirely.
      if (nlu.intent === "create_plan" && nlu.confirm_ready && !activeRoomId) {
        if (nlu.assistant_reply) chat.injectAssistantMessage(nlu.assistant_reply);
        const nextConfirm: PendingConfirmSnapshot = { nlu, message: text, kind: "plan", mentioned_user_ids: mergedMentionIds };
        restorePendingConfirmState(nextConfirm);
        persistPendingConfirmState(nextConfirm);
        return;
      }

      // Everything else: inject the assistant reply as a bubble. Optionally
      // render a confirm card (create_room confirm_ready) or quick-pick chips
      // (any missing-fields clarify).
      if (nlu.assistant_reply) {
        chat.injectAssistantMessage(nlu.assistant_reply);
      }

      // Two ways to enter the synthesize flow inside an existing DR:
      //   (a) User typed "出方案 / give me the plan" — extractor + parse
      //       override flipped intent=create_room + confirm_ready=true.
      //   (b) Server detected every joined member has contributed an intent
      //       state and signalled scenario_synthesis_ready (auto-fire when
      //       the LAST contributor finishes their turn).
      // Both paths POST /api/rooms/[id]/synthesize and let the synthesizer
      // figure out the rest (trip → TripPackage proposal; non-trip → merged
      // search query the client posts to /api/chat).
      const wantsSynthesize =
        (nlu.intent === "create_room" && nlu.confirm_ready) ||
        data.scenario_synthesis_ready === true;
      if (wantsSynthesize && activeRoomId) {
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
              proposal_id?: string | null;
              already_exists?: boolean;
            };
            // Sync the spinner's chip set to the actual room type so a
            // restaurant DR shows just 🍽 instead of the 4-pipeline trip
            // chips. Set as soon as the response lands so the visual
            // matches reality (vs stale 4-chip default during the brief
            // network round-trip after setSynthesizing(true) above).
            const _rt = data.room_type;
            if (_rt === "restaurant" || _rt === "hotel" || _rt === "flight" || _rt === "activity") {
              setSynthesizingCategory(_rt);
            } else if (_rt === "trip") {
              setSynthesizingCategory("trip");
            }
            if (!res.ok || !data.ok) {
              chat.injectAssistantMessage("方案生成失败了，先稍等再试一下。");
              return;
            }

            // Non-trip DRs (restaurant/hotel/flight/activity): server ran
            // the LLM search ONCE and landed cards in a shared
            // decision_room_proposals row. Mount <ScenarioProposalChatCard>
            // via activeProposalId+Kind state — both members read the same
            // row instead of independently calling /api/chat.
            const nonTripTypes = ["restaurant", "hotel", "flight", "activity"];
            if (data.room_type && nonTripTypes.includes(data.room_type)) {
              if (data.reason === "ok" && data.proposal_id) {
                if (!data.already_exists) {
                  chat.injectAssistantMessage(
                    "✅ 方案已出！下方卡片选你的偏好，看看大家投谁。",
                  );
                }
                setActiveProposalId(data.proposal_id);
                setActiveProposalKind("scenario");
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
              if (data.reason === "search_failed") {
                chat.injectAssistantMessage(
                  "搜索没找到合适的选项。能再补一些细节吗（例如具体地段或时间）？",
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
                    setActiveProposalKind("trip");
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
            setSynthesizingCategory(null);
          }
        })();
        return;
      }

      if (nlu.intent === "create_room" && nlu.confirm_ready) {
        const nextConfirm: PendingConfirmSnapshot = { nlu, message: text, kind: "room", mentioned_user_ids: mergedMentionIds };
        restorePendingConfirmState(nextConfirm);
        persistPendingConfirmState(nextConfirm);
      } else if (nlu.intent === "create_plan" && nlu.confirm_ready) {
        // Safety net — shouldn't reach here given the early return above.
        const nextConfirm: PendingConfirmSnapshot = { nlu, message: text, kind: "plan", mentioned_user_ids: mergedMentionIds };
        restorePendingConfirmState(nextConfirm);
        persistPendingConfirmState(nextConfirm);
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
    restorePendingConfirmState(null);
    persistPendingConfirmState(null);
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
          ...(payload.constraints ? { confirmedConstraints: payload.constraints } : {}),
        });
      }
    }
    if (payload.kind === "direct_booking") {
      await handleDirectBooking(payload);
    }
  }

  function deriveNameParts(displayName: string | null | undefined) {
    const full = (displayName ?? "").trim();
    if (!full) return { first_name: "", last_name: "" };
    const parts = full.split(/\s+/).filter(Boolean);
    return {
      first_name: parts[0] ?? "",
      last_name: parts.slice(1).join(" "),
    };
  }

  /**
   * Phase 1 #7 path A — apply_profile_patch dispatcher.
   *
   * PATCH the user's booking profile via codex's `48c80b2` cookie-auth
   * endpoint. Surfaces success quietly (assistant_reply already rendered
   * by the chat handler); errors fall back to a chat-bubble notification.
   *
   * Idempotency: the underlying `upsertDefaultBookingProfile` is safe on
   * retry (existence check before update vs create). Same patch sent
   * twice is a no-op net effect.
   *
   * Validation: codex's `parseProfilePatch` rejects payment fields with
   * 400; we surface the field-level errors as a chat bubble so the user
   * can correct (e.g. invalid email format → "Hmm, email: Enter a valid
   * email. Try again?").
   *
   * Auth: 401 means session expired or user signed out — surface "sign
   * in first" prompt rather than a generic error. Cookie auth wired by
   * codex `48c80b2` for cookie-authed `/api/v1/*` routes.
   *
   * Path A scope: this only handles MID-CONVERSATION profile_edit
   * ("save my DOB 1995-05-15"). The booking-blocked needs_profile_data
   * path (path B) still uses the legacy InlineBookingProfileGate
   * modal — that cutover is the next sub-step of Phase 1 #7, not this
   * commit. See PHASE_1_7_SPEC.md.
   */
  async function dispatchProfilePatch(patch: ProfilePatch): Promise<boolean> {
    try {
      const res = await fetch("/api/v1/users/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profile: patch }),
      });
      if (res.status === 401) {
        chat.injectAssistantMessage(
          "Sign in first so I can save your profile.",
        );
        return false;
      }
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: {
            code?: string;
            message?: string;
            fields?: Record<string, string>;
          };
        };
        const fields = errBody?.error?.fields ?? {};
        const fieldErrSummary = Object.entries(fields)
          .map(([k, v]) => `${k}: ${v}`)
          .join("; ");
        const summary =
          fieldErrSummary ||
          errBody?.error?.message ||
          "Couldn't save those fields.";
        chat.injectAssistantMessage(`Hmm, ${summary} Try again?`);
        return false;
      }
      // Success — assistant_reply (Layer 1 conversational confirmation,
      // e.g. "Got it — saved your DOB.") was already rendered by the chat
      // handler before this dispatcher fired. No additional bubble needed
      // unless we want to add a structured "saved field list" — that's
      // Phase 2 polish.
      return true;
    } catch {
      chat.injectAssistantMessage(
        "Network hiccup saving your profile. Try again in a moment.",
      );
      return false;
    }
  }

  function getMissingBookingFields(profile: Partial<MinimalBookingProfileDraft> | null | undefined) {
    const missing: string[] = [];
    if (!profile?.first_name?.trim()) missing.push("first_name");
    if (!profile?.last_name?.trim()) missing.push("last_name");
    if (!profile?.email?.trim()) missing.push("email");
    if (!profile?.phone?.trim()) missing.push("phone");
    return missing;
  }

  async function startDirectBookingWithProfile(
    payload: CommitResponse,
    profile: MinimalBookingProfile
  ) {
    const sessionId =
      activeRoomIdRef.current ??
      activeSessionIdRef.current ??
      localStorage.getItem("session_id") ??
      crypto.randomUUID();
    if (!localStorage.getItem("session_id")) {
      localStorage.setItem("session_id", sessionId);
    }
    localStorage.setItem("active_profile_id", String(profile.id));

    const step = {
      ...payload.booking_step,
      body: {
        ...payload.booking_step?.body,
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
      const content = `Couldn't start the booking job — please try the Reserve button on a recommendation card instead.`;
      chat.injectAssistantMessage(content);
      void persistThreadMessage({ role: "assistant", content });
      return;
    }
    const { jobId } = (await createRes.json()) as { jobId: string };
    void fetch(`/api/booking-jobs/${jobId}/start?executor=inline`, { method: "POST" }).catch(
      () => {}
    );
    setInlineItems((prev) => [...prev, { type: "job", jobId }]);
  }

  async function submitInlineBookingProfile() {
    if (!inlineBookingProfile || inlineBookingProfileSaving) return;
    const first_name = inlineBookingProfile.first_name.trim();
    const last_name = inlineBookingProfile.last_name.trim();
    const email = inlineBookingProfile.email.trim();
    const phone = inlineBookingProfile.phone.trim();
    const missing = getMissingBookingFields({ first_name, last_name, email, phone });

    if (missing.length > 0) {
      const nextGate = inlineBookingProfile
        ? {
            ...inlineBookingProfile,
            first_name,
            last_name,
            email,
            phone,
            missing,
          }
        : null;
      setInlineBookingProfile(nextGate);
      persistInlineBookingProfileState(nextGate);
      setInlineBookingProfileError("Please fill the missing contact details before I continue.");
      return;
    }

    setInlineBookingProfileSaving(true);
    setInlineBookingProfileError(null);
    try {
      const body = {
        label: "Personal",
        is_default: true,
        first_name,
        last_name,
        email,
        phone,
      };
      const res = await fetch(
        inlineBookingProfile.id
          ? `/api/user/booking-profiles/${inlineBookingProfile.id}`
          : "/api/user/booking-profiles",
        {
          method: inlineBookingProfile.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (res.status === 401) {
        setInlineBookingProfileError("Please sign in first so I can save your booking profile.");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        profile?: MinimalBookingProfile;
      };
      if (!res.ok || !data.profile) {
        setInlineBookingProfileError(data.error ?? "I couldn't save your booking profile yet. Try again.");
        return;
      }
      setInlineBookingProfile(null);
      persistInlineBookingProfileState(null);
      const content = "Thanks — I’ve saved your contact details and I’m continuing the booking now.";
      chat.injectAssistantMessage(content);
      void persistThreadMessage({ role: "assistant", content });
      await startDirectBookingWithProfile(inlineBookingProfile.payload, data.profile);
    } catch {
      setInlineBookingProfileError("Network hiccup while saving your booking profile. Try again in a moment.");
    } finally {
      setInlineBookingProfileSaving(false);
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
    void persistThreadMessage({
      role: "assistant",
      content: `Booking ${payload.venue_name}…`,
    });

    try {
      if (!isSignedIn) {
        const content = "Please sign in first so I can save your booking profile and continue the reservation.";
        chat.injectAssistantMessage(content);
        void persistThreadMessage({ role: "assistant", content });
        return;
      }
      const profileRes = await fetch("/api/user/booking-profiles?default=true");
      const { profile } = (await profileRes.json().catch(() => ({}))) as {
        profile?: MinimalBookingProfile;
      };
      const authName = deriveNameParts(userDisplayName);
      const mergedProfile: (MinimalBookingProfile & MinimalBookingProfileDraft) | (MinimalBookingProfileDraft & { id: null }) = profile
        ? {
            ...profile,
            first_name: profile.first_name?.trim() ? profile.first_name : authName.first_name,
            last_name: profile.last_name?.trim() ? profile.last_name : authName.last_name,
            email: profile.email?.trim() ? profile.email : userEmail ?? "",
            phone: profile.phone ?? "",
          }
        : {
            id: null,
            first_name: authName.first_name,
            last_name: authName.last_name,
            email: userEmail ?? "",
            phone: "",
          };
      // Phase 1 #7 path B — delegate decision to `decideProfileGap`
      // (`lib/profile-gap-decision.ts`). The helper trusts backend
      // `payload.profile_gap` (codex `7289ba0` Q15 emit) and falls back
      // to the legacy 4-field check only when the backend forgot to
      // emit. Feature flag NEXT_PUBLIC_PROFILE_GAP_INLINE flips between
      // the inline ProfileGapCard (default) and the legacy modal
      // (debug fallback).
      const useInlineGate =
        (process.env.NEXT_PUBLIC_PROFILE_GAP_INLINE ?? "1") !== "0";
      const legacyMissing = getMissingBookingFields(mergedProfile);
      const decision = decideProfileGap(
        commitResponseToDecisionInput({
          payload,
          legacyMissing,
          profileExists: Boolean(profile),
          useInlineGate,
        }),
      );

      if (decision.kind === "inline") {
        chat.injectAssistantMessage(decision.assistantMessage, {
          profileGapCard: {
            id: decision.cardId,
            state: decision.gapState,
            pendingPayload: payload,
          },
        });
        void persistThreadMessage({
          role: "assistant",
          content: decision.assistantMessage,
        });
        return;
      }

      if (decision.kind === "legacy_modal") {
        // Legacy fallback: modal-style InlineBookingProfileGate.
        // Only fires when NEXT_PUBLIC_PROFILE_GAP_INLINE=0 (debug toggle).
        chat.injectAssistantMessage(decision.assistantMessage);
        void persistThreadMessage({
          role: "assistant",
          content: decision.assistantMessage,
        });
        setInlineBookingProfileError(null);
        const nextGate = {
          id: profile?.id ?? null,
          venueName: payload.venue_name,
          payload,
          first_name: mergedProfile.first_name,
          last_name: mergedProfile.last_name,
          email: mergedProfile.email,
          phone: mergedProfile.phone,
          missing: legacyMissing,
        };
        setInlineBookingProfile(nextGate);
        persistInlineBookingProfileState(nextGate);
        return;
      }

      await startDirectBookingWithProfile(payload, mergedProfile as MinimalBookingProfile);
    } catch {
      const content = `Network hiccup while starting the booking. Try again in a moment.`;
      chat.injectAssistantMessage(content);
      void persistThreadMessage({ role: "assistant", content });
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
    restorePendingConfirmState(null);
    persistPendingConfirmState(null);
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

      if (!chat.decisionPlan) throw new Error("Nothing to share yet — generate a plan first.");

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

      if (!chat.decisionPlan) throw new Error("Nothing to vote on yet — generate a plan first.");

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
      if (!chat.decisionPlan) throw new Error("Nothing to track yet — generate a plan first.");

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
      if (!chat.decisionPlan) throw new Error("Nothing to export yet — generate a plan first.");

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

  const currentTaskSessionId = activeRoomId ?? activeSessionId ?? null;

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

      {/* Room-dissolved toast (creator deleted the room while a member had
          the URL open). Reuses the GPS-toast styling so the page has one
          visual language for transient banners. */}
      {roomGoneToast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm shadow-lg"
          style={{
            backgroundColor: "#FDF6EC",
            border: "1px solid #E8A020",
            color: "#8B5E14",
            fontFamily: "var(--font-dm-sans)",
          }}
        >
          {roomGoneToast}
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

            {!hasMessages && !activeRoomId && (!activeSessionId || replayedSessionIds.current.has(activeSessionId)) ? (
              /* Welcome / Hero State. During a cold session switch, wait
                 until replay confirms whether messages exist so the homepage
                 does not flash over a loading thread. If a saved solo draft
                 is genuinely empty, show the welcome surface instead of a
                 blank middle pane. */
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
                              // naturally. v1 picker: prefer @username so the
                              // mention auto-tags via MentionPicker (skips the
                              // LLM name resolution); fall back to display
                              // name when the contact has no username yet.
                              const handle = c.username
                                ? `@${c.username}`
                                : (c.nickname ?? c.display_name ?? `@${c.profile_code}`);
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
                      <a
                        href={taskWorkspaceHrefForView("queue", { sourceSessionId: currentTaskSessionId ?? chat.getSessionId() })}
                        style={{ fontFamily: "var(--font-dm-sans)", fontSize: 12, color: "var(--gold)", textDecoration: "none" }}
                      >
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
                          <a key={job.id} href={getTaskWorkspaceHref(job)} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, backgroundColor: "var(--card)", border: "0.5px solid var(--border)" }}>
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
                        {/* Phase 1 #7 path B — inline ProfileGapCard.
                            Triggered when /api/chat/commit direct_booking
                            response includes profile_gap (canonical 13-field
                            via backend buildProfileGap). User fills the form
                            in chat, save dispatches PATCH + resumes booking. */}
                        {msg.profileGapCard && (
                          <div className="my-2">
                            <ProfileGapCard
                              key={msg.profileGapCard.id}
                              state={msg.profileGapCard.state}
                              onSave={makeProfileGapOnSave({
                                dispatchProfilePatch,
                                refetchProfile: async () => {
                                  const res = await fetch(
                                    "/api/user/booking-profiles?default=true",
                                    { credentials: "include" },
                                  );
                                  const { profile: freshProfile } = (await res
                                    .json()
                                    .catch(() => ({}))) as {
                                    profile?: MinimalBookingProfile;
                                  };
                                  return freshProfile ?? null;
                                },
                                startBooking: startDirectBookingWithProfile,
                                notify: chat.injectAssistantMessage,
                                pendingPayload: msg.profileGapCard.pendingPayload,
                              })}
                            />
                          </div>
                        )}
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
                                sessionId={currentTaskSessionId}
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
                                sessionId={currentTaskSessionId}
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
                                sessionId={currentTaskSessionId}
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
                                  sessionId={currentTaskSessionId}
                                  onCompare={() => {
                                    toggleCompare(card);
                                    setCompareOpen(true);
                                  }}
                                  isComparing={isComparing(card)}
                                  onFeedback={handleCardFeedback}
                                  onJobCreated={(jobId) => setInlineItems((prev) => [...prev, { type: "job", jobId }])}
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
                    mentionedUserIds={pendingConfirm.mentioned_user_ids}
                    onConfirmed={handleConfirmCommitted}
                    onEdit={handleConfirmEdit}
                  />
                )}

                {/* Stage 2 · T11: inline trip proposal card for multi-party trip rooms.
                    Mounts when synthesis has created a proposal (activeProposalId is
                    set via the private-messages replay or after a force-synthesize
                    click). 4-column picker + per-item vote badges + payer-only book. */}
                {activeRoomId && activeProposalId && activeProposalKind === "trip" && (
                  <TripProposalChatCard
                    key={activeProposalId}
                    roomId={activeRoomId}
                    proposalId={activeProposalId}
                    userId={userId ?? null}
                  />
                )}

                {/* Phase 2: inline scenario proposal card for non-trip DRs
                    (restaurant/hotel/flight/activity). Reads cards from a
                    SHARED decision_room_proposals row so both members see
                    the same list. Phase 3 layers on per-card voting. */}
                {activeRoomId && activeProposalId && activeProposalKind === "scenario" && (
                  <ScenarioProposalChatCard
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
                      {(synthesizingCategory === "restaurant"
                        ? [{ emoji: "🍽", label: "Restaurants", cls: "synth-chip-1" }]
                        : synthesizingCategory === "hotel"
                          ? [{ emoji: "🏨", label: "Hotels", cls: "synth-chip-1" }]
                          : synthesizingCategory === "flight"
                            ? [{ emoji: "✈", label: "Flights", cls: "synth-chip-1" }]
                            : synthesizingCategory === "activity"
                              ? [{ emoji: "🎟", label: "Activities", cls: "synth-chip-1" }]
                              : [
                                  { emoji: "🏨", label: "Hotel", cls: "synth-chip-1" },
                                  { emoji: "✈", label: "Flight", cls: "synth-chip-2" },
                                  { emoji: "🎟", label: "Shows", cls: "synth-chip-3" },
                                  { emoji: "🍽", label: "Food", cls: "synth-chip-4" },
                                ]
                      ).map((c) => (
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
                      {synthesizingCategory && synthesizingCategory !== "trip"
                        ? "综合大家的偏好做一次搜索，通常 5-15 秒。"
                        : "并行跑 4 条品类 pipeline，通常 5-15 秒。"}
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
                    sessionId={currentTaskSessionId ?? chat.getSessionId()}
                    errors={tripFlow.errors}
                    onBooked={(jobId) => {
                      setInlineItems((prev) => [...prev, { type: "job", jobId }]);
                      setTripFlow(null);
                    }}
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
                          onWatch={openInlineWatchPanel}
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
        {/* P4: pills + toast above the input. Pills surface who's currently
            tagged so the user can verify before sending; × strips the @username
            token from the text (which auto-clears the user_id via
            MentionPicker's derive). */}
        {(mentionedUserIds.length > 0 || mentionToast) && (
          <div
            style={{
              maxWidth: "56rem",
              margin: "0 auto",
              padding: "0 var(--space-2)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            {mentionedUserIds.map((uid) => {
              const c = allContacts.find((x) => x.user_id === uid);
              const usernameFromInvite = Object.entries(pendingInvites).find(
                ([, id]) => id === uid,
              )?.[0];
              const username = c?.username ?? usernameFromInvite ?? null;
              const label = c?.display_name ?? c?.username ?? username ?? "Unknown";
              return (
                <span
                  key={uid}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "var(--gold-soft, #f7eed8)",
                    color: "var(--gold-text, #7a5b1c)",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 12,
                    fontWeight: 600,
                    border: "1px solid var(--gold, #C9A84C)",
                  }}
                >
                  @{label}
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => {
                      if (!username) return;
                      const re = new RegExp(
                        `(^|\\s)@${username}\\b\\s?`,
                        "gi",
                      );
                      const next = chat.input
                        .replace(re, " ")
                        .replace(/\s+/g, " ")
                        .trim();
                      updateChatInput(next);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {mentionToast && (
              <span
                style={{
                  marginLeft: mentionedUserIds.length > 0 ? 8 : 0,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "rgba(0,0,0,0.04)",
                  color: "var(--text-secondary, #555)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                }}
              >
                {mentionToast}
              </span>
            )}
          </div>
        )}
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
          <MentionPicker
            value={isListening ? "" : chat.input}
            onChange={updateChatInput}
            onSubmit={() => {
              chatInputRef.current = chat.input;
              sendCurrentInput();
            }}
            contacts={allContacts}
            pendingInvites={pendingInvites}
            onMentionsChange={setMentionedUserIds}
            onLookup={handleMentionLookup}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(value) => {
              isComposingRef.current = false;
              updateChatInput(value);
            }}
            placeholder={
              isListening
                ? "Listening..."
                : pendingTravelDoc
                ? "e.g. 2001-09-05, passport EJ2676174"
                : hasMessages
                ? "Refine: 'more quiet', 'cheaper options'..."
                : "Describe what you're looking for... (type @ to tag a contact)"
            }
            ariaLabel="Search for restaurants"
            className={`chat-input${isListening ? " chat-input--listening" : ""}`}
            disabled={chat.loading || isListening}
            wrapperStyle={{ flex: 1, minWidth: 0 }}
            inputDataAttributes={{ "data-chat-input": "true" }}
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

      {inlineWatchPanel && (
        <InlineTaskWatchPanel
          panel={inlineWatchPanel}
          panelKey={inlineWatchKey}
          onClose={closeInlineWatchPanel}
        />
      )}

      <InlineBookingProfileGate
        open={!!inlineBookingProfile}
        venueName={inlineBookingProfile?.venueName ?? "this place"}
        values={{
          first_name: inlineBookingProfile?.first_name ?? "",
          last_name: inlineBookingProfile?.last_name ?? "",
          email: inlineBookingProfile?.email ?? "",
          phone: inlineBookingProfile?.phone ?? "",
        }}
        missingFields={inlineBookingProfile?.missing ?? []}
        saving={inlineBookingProfileSaving}
        error={inlineBookingProfileError}
        onChange={(patch) => {
          let nextGate: InlineBookingProfileState | null = null;
          setInlineBookingProfile((prev) => {
            nextGate = prev
              ? {
                  ...prev,
                  ...patch,
                  missing: getMissingBookingFields({
                    first_name: patch.first_name ?? prev.first_name,
                    last_name: patch.last_name ?? prev.last_name,
                    email: patch.email ?? prev.email,
                    phone: patch.phone ?? prev.phone,
                  }),
                }
              : prev;
            return nextGate;
          });
          if (nextGate) persistInlineBookingProfileState(nextGate);
          if (inlineBookingProfileError) setInlineBookingProfileError(null);
        }}
        onClose={() => {
          setInlineBookingProfile(null);
          persistInlineBookingProfileState(null);
          setInlineBookingProfileError(null);
        }}
        onSubmit={submitInlineBookingProfile}
      />

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

