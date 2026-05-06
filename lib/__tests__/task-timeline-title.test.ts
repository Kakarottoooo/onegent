import { describe, expect, it } from "vitest";
import { normalizeTaskTimelineTitle } from "@/components/task-timeline/title";

describe("task timeline title normalization", () => {
  it("removes duplicated leading computer icons from task titles", () => {
    expect(normalizeTaskTimelineTitle("🖥️ 🖥️ Agent — Sirrah")).toBe("Agent — Sirrah");
    expect(normalizeTaskTimelineTitle("💻 Agent — Hotel")).toBe("Agent — Hotel");
  });

  it("keeps ordinary titles unchanged", () => {
    expect(normalizeTaskTimelineTitle("Agent — The Lion King")).toBe(
      "Agent — The Lion King",
    );
  });
});
