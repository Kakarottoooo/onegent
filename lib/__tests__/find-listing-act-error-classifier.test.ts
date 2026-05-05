import { describe, expect, it } from "vitest";

import { classifyActError } from "@/lib/booking-autopilot/ai-loop/find-listing";

describe("classifyActError — distinguish platform errors from real availability", () => {
  // Bug 3 (P0 systemic): when stagehand.act() throws because the OpenAI project
  // lacks access to the configured model, the surrounding code in find-listing.ts
  // emits "could not click reserve — no_availability" — the literal opposite of
  // the truth (it's an LLM platform error, not a sold-out room). This bug was
  // observed live: project proj_TlgX3E0dUS4JjNWWXtd62geC missing gpt-4o-mini
  // access produced a false "no rooms available" outcome.
  //
  // classifyActError gives the catch-handler a way to emit the correct kind in
  // the trace + decisionLog so runtime-forensics taxonomy stays clean.

  it("classifies OpenAI project model-access errors as platform", () => {
    const err = new Error(
      "Project `proj_TlgX3E0dUS4JjNWWXtd62geC` does not have access to model `gpt-4o-mini`",
    );
    const c = classifyActError(err);
    expect(c.kind).toBe("platform");
    expect(c.reason).toMatch(/model access/i);
  });

  it("classifies OpenAI 401/403 auth errors as platform", () => {
    expect(classifyActError(new Error("401 Unauthorized: invalid api key")).kind).toBe("platform");
    expect(classifyActError(new Error("403 Forbidden")).kind).toBe("platform");
    expect(classifyActError(new Error("Could not resolve authentication method")).kind).toBe("platform");
  });

  it("classifies OpenAI quota / rate-limit errors as platform", () => {
    expect(classifyActError(new Error("429 Too Many Requests")).kind).toBe("platform");
    expect(classifyActError(new Error("You exceeded your current quota")).kind).toBe("platform");
    expect(classifyActError(new Error("rate_limit_exceeded")).kind).toBe("platform");
  });

  it("classifies network failures as transient", () => {
    expect(classifyActError(new Error("ECONNRESET")).kind).toBe("transient");
    expect(classifyActError(new Error("getaddrinfo ENOTFOUND api.openai.com")).kind).toBe("transient");
    expect(classifyActError(new Error("network timeout")).kind).toBe("transient");
    expect(classifyActError(new Error("fetch failed")).kind).toBe("transient");
  });

  it("classifies playwright element-not-found as unknown (the legitimately ambiguous case)", () => {
    // This is the case where the page genuinely doesn't have the button —
    // could be sold-out, could be selector drift. Don't claim platform error.
    expect(classifyActError(new Error("Locator 'button' not visible")).kind).toBe("unknown");
    expect(classifyActError(new Error("Timeout 30000ms exceeded")).kind).toBe("unknown");
  });

  it("handles non-Error throws safely", () => {
    expect(classifyActError(null).kind).toBe("unknown");
    expect(classifyActError(undefined).kind).toBe("unknown");
    expect(classifyActError("string error").kind).toBe("unknown");
    expect(classifyActError({ foo: "bar" }).kind).toBe("unknown");
  });

  it("always produces a non-empty reason string", () => {
    for (const e of [null, undefined, new Error(""), new Error("x"), "raw"]) {
      const c = classifyActError(e);
      expect(typeof c.reason).toBe("string");
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });
});
