import { describe, expect, it } from "vitest";
import {
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
  });
});
