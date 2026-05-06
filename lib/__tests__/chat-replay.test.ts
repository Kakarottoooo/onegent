import { describe, expect, it } from "vitest";
import {
  INLINE_BOOKING_JOB_CONTENT,
  buildRoomReplaySnapshot,
  buildSessionReplaySnapshot,
} from "@/lib/chat-replay";

describe("chat replay snapshots", () => {
  it("builds a session snapshot with the latest assistant nlu state", () => {
    const snapshot = buildSessionReplaySnapshot({
      session: { title: "Dinner in Nashville" },
      messages: [
        {
          id: "1",
          role: "user",
          content: "Find me somewhere quiet",
          created_at: "2026-04-29T00:00:00Z",
        },
        {
          id: "2",
          role: "assistant",
          content: "What area do you prefer?",
          nlu_state: { step: "clarify-area" },
          created_at: "2026-04-29T00:00:01Z",
        },
        {
          id: "3",
          role: "user",
          content: "Downtown please",
          created_at: "2026-04-29T00:00:02Z",
        },
      ],
    });

    expect(snapshot.title).toBe("Dinner in Nashville");
    expect(snapshot.messages).toEqual([
      { role: "user", content: "Find me somewhere quiet" },
      { role: "assistant", content: "What area do you prefer?" },
      { role: "user", content: "Downtown please" },
    ]);
    expect(snapshot.nluHistory).toEqual([
      { role: "user", content: "Find me somewhere quiet" },
      { role: "assistant", content: "What area do you prefer?" },
      { role: "user", content: "Downtown please" },
    ]);
    expect(snapshot.lastNluState).toEqual({ step: "clarify-area" });
  });

  it("drops room proposal marker rows from replayed messages", () => {
    const snapshot = buildRoomReplaySnapshot([
      {
        id: "1",
        role: "system",
        content: "Welcome back",
        meta_json: null,
        created_at: "2026-04-29T00:00:00Z",
      },
      {
        id: "2",
        role: "user",
        content: "Book Carbone tomorrow",
        meta_json: null,
        created_at: "2026-04-29T00:00:01Z",
      },
      {
        id: "3",
        role: "assistant",
        content: "I found a few options",
        meta_json: null,
        created_at: "2026-04-29T00:00:02Z",
      },
      {
        id: "4",
        role: "assistant",
        content: "",
        meta_json: { kind: "trip_proposal_card", proposal_id: "prop_123" },
        created_at: "2026-04-29T00:00:03Z",
      },
    ]);

    expect(snapshot.messages).toEqual([
      { role: "assistant", content: "Welcome back" },
      { role: "user", content: "Book Carbone tomorrow" },
      { role: "assistant", content: "I found a few options" },
    ]);
    expect(snapshot.nluHistory).toEqual([
      { role: "user", content: "Book Carbone tomorrow" },
      { role: "assistant", content: "I found a few options" },
    ]);
    expect(snapshot.proposalId).toBe("prop_123");
    expect(snapshot.proposalKind).toBe("trip");
  });

  it("captures scenario_proposal_card markers as scenario kind", () => {
    const snapshot = buildRoomReplaySnapshot([
      {
        id: "1",
        role: "user",
        content: "Italian for 4 in Nashville",
        meta_json: null,
        created_at: "2026-04-29T00:00:00Z",
      },
      {
        id: "2",
        role: "assistant",
        content: "✅ 方案已出！下方卡片选你的偏好。",
        meta_json: {
          kind: "scenario_proposal_card",
          proposal_id: "scenario_prop_456",
          category: "restaurant",
        } as unknown as { kind?: string; proposal_id?: string },
        created_at: "2026-04-29T00:00:01Z",
      },
    ]);

    // Marker row is skipped from the message stream — the page renders cards
    // via <ScenarioProposalChatCard /> using proposalId state.
    expect(snapshot.messages).toEqual([
      { role: "user", content: "Italian for 4 in Nashville" },
    ]);
    expect(snapshot.proposalId).toBe("scenario_prop_456");
    expect(snapshot.proposalKind).toBe("scenario");
  });

  it("rebuilds search-card payloads from meta_json on room replay (A1)", () => {
    // Card payloads are stubbed minimally — we only assert the snapshot
    // re-attaches them to the corresponding Message, not that the full
    // RecommendationCard shape is constructed.
    const stubCards = [
      { restaurant: { id: "r1", name: "Carbone" } },
      { restaurant: { id: "r2", name: "Don Angie" } },
    ] as unknown as Parameters<typeof buildRoomReplaySnapshot>[0] extends infer _ ? never : never;

    const snapshot = buildRoomReplaySnapshot([
      {
        id: "1",
        role: "user",
        content: "Italian in NYC",
        meta_json: null,
        created_at: "2026-04-29T00:00:00Z",
      },
      {
        id: "2",
        role: "assistant",
        content: "Found 2 restaurants for you.",
        // Cast to avoid pulling in the full RecommendationCard shape just for the test fixture.
        meta_json: {
          kind: "search_cards",
          cards: stubCards as unknown as never[],
          category: "restaurant",
          output_language: "en",
        } as unknown as { kind?: string; proposal_id?: string },
        created_at: "2026-04-29T00:00:01Z",
      },
    ]);

    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1].cards).toBeDefined();
    expect(snapshot.messages[1].cards).toHaveLength(2);
    expect(snapshot.messages[1].category).toBe("restaurant");
    expect(snapshot.messages[1].output_language).toBe("en");
  });

  it("rebuilds search-card payloads from meta_json on session replay (A1)", () => {
    const snapshot = buildSessionReplaySnapshot({
      session: { title: "Hotels in Tokyo" },
      messages: [
        {
          id: "1",
          role: "user",
          content: "4-star in Shibuya",
          created_at: "2026-04-29T00:00:00Z",
        },
        {
          id: "2",
          role: "assistant",
          content: "Found 3 hotels for you.",
          // Casting the raw JSON shape in lieu of the full HotelRecommendationCard.
          meta_json: {
            kind: "search_cards",
            hotelCards: [{ id: "h1" }, { id: "h2" }, { id: "h3" }],
            category: "hotel",
          } as unknown as Record<string, unknown>,
          created_at: "2026-04-29T00:00:01Z",
        },
      ],
    });

    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1].hotelCards).toHaveLength(3);
    expect(snapshot.messages[1].category).toBe("hotel");
  });

  it("rebuilds inline booking task cards without polluting session NLU history", () => {
    const snapshot = buildSessionReplaySnapshot({
      session: { title: "Book Sirrah" },
      messages: [
        {
          id: "1",
          role: "user",
          content: "Book Sirrah next Thursday",
          created_at: "2026-05-06T00:00:00Z",
        },
        {
          id: "2",
          role: "assistant",
          content: INLINE_BOOKING_JOB_CONTENT,
          meta_json: {
            kind: "inline_booking_job",
            job_id: "job_sirrah_123",
          },
          created_at: "2026-05-06T00:00:01Z",
        },
      ],
    });

    expect(snapshot.messages).toEqual([
      { role: "user", content: "Book Sirrah next Thursday" },
      { role: "assistant", content: "", bookingJobId: "job_sirrah_123" },
    ]);
    expect(snapshot.nluHistory).toEqual([
      { role: "user", content: "Book Sirrah next Thursday" },
    ]);
  });

  it("rebuilds inline booking task cards without polluting room NLU history", () => {
    const snapshot = buildRoomReplaySnapshot([
      {
        id: "1",
        role: "user",
        content: "Book a Broadway show",
        meta_json: null,
        created_at: "2026-05-06T00:00:00Z",
      },
      {
        id: "2",
        role: "assistant",
        content: INLINE_BOOKING_JOB_CONTENT,
        meta_json: {
          kind: "inline_booking_job",
          job_id: "job_lion_king_123",
        },
        created_at: "2026-05-06T00:00:01Z",
      },
    ]);

    expect(snapshot.messages).toEqual([
      { role: "user", content: "Book a Broadway show" },
      { role: "assistant", content: "", bookingJobId: "job_lion_king_123" },
    ]);
    expect(snapshot.nluHistory).toEqual([
      { role: "user", content: "Book a Broadway show" },
    ]);
  });
});
