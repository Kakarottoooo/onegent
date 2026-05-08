import { describe, expect, it } from "vitest";

import {
  STAGE0B_TEST_PLAN,
  TICKETMASTER_SKILL_FORGE_PLAN,
  buildBrowserHarnessPython,
  buildStage0BLabResult,
  classifyStage0BOutcome,
  formatStage0BLabDryRun,
  parseBrowserHarnessPayload,
  parseStage0BLabRunnerArgs,
  selectStage0BLabEntries,
  type BrowserHarnessPayload,
} from "@/lib/stage0b-skill-runtime";
import { resolveActivityProviderSkillUrl } from "@/lib/activity-skills";
import type { LabTestPlanEntry } from "@/lib/stage0b-skill-runtime";

const EXACT_EVENT = STAGE0B_TEST_PLAN.find((entry) => entry.expected_resolver_execution_mode === "direct_execution")!;
const LISTING = STAGE0B_TEST_PLAN.find((entry) => entry.expected_resolver_execution_mode === "provider_start")!;

describe("Stage 0B live lab runner args and plan selection", () => {
  it("defaults to no-live dry plan behavior unless --live is explicit", () => {
    const args = parseStage0BLabRunnerArgs([]);
    expect(args.live).toBe(false);
    expect(args.plan).toBe("stage0b");
    expect(args.keepOpen).toBe(false);
    expect(args.evidenceRoot).toBe(".stage0b-evidence");
    expect(args.browserHarnessCommand).toBe("browser-harness");
  });

  it("parses provider/id/limit/evidence/browser-harness flags", () => {
    const args = parseStage0BLabRunnerArgs([
      "--live",
      "--provider",
      "ticketmaster",
      "--id",
      "tm-01",
      "--limit",
      "1",
      "--plan",
      "ticketmaster-forge",
      "--evidence-root",
      ".tmp/evidence",
      "--browser-harness",
      "browser-harness-dev",
      "--stop-on-error",
      "--keep-open",
    ]);
    expect(args).toMatchObject({
      live: true,
      provider: "ticketmaster",
      id: "tm-01",
      limit: 1,
      plan: "ticketmaster-forge",
      evidenceRoot: ".tmp/evidence",
      browserHarnessCommand: "browser-harness-dev",
      stopOnError: true,
      keepOpen: true,
    });
  });

  it("selects the 10 Ticketmaster and 10 SeatGeek cases from the shared plan", () => {
    expect(selectStage0BLabEntries({ provider: "ticketmaster" })).toHaveLength(10);
    expect(selectStage0BLabEntries({ provider: "seatgeek" })).toHaveLength(10);
  });

  it("selects the expanded Ticketmaster Skill Forge plan when requested", () => {
    const entries = selectStage0BLabEntries({ plan: "ticketmaster-forge" });
    expect(entries).toHaveLength(20);
    expect(entries.every((entry) => entry.provider === "ticketmaster")).toBe(true);
    expect(entries.map((entry) => entry.id)).toEqual(TICKETMASTER_SKILL_FORGE_PLAN.map((entry) => entry.id));
  });

  it("keeps every Ticketmaster Skill Forge URL aligned with the activity resolver", () => {
    for (const entry of TICKETMASTER_SKILL_FORGE_PLAN) {
      const resolved = resolveActivityProviderSkillUrl(entry.url);
      expect(resolved?.provider, entry.id).toBe("ticketmaster");
      expect(resolved?.pageType, entry.id).toBe(entry.expected_resolver_page_type);
      expect(resolved?.executionMode, entry.id).toBe(entry.expected_resolver_execution_mode);
    }
  });

  it("filters by exact id before applying limit", () => {
    const entries = selectStage0BLabEntries({ id: "sg-01", limit: 5 });
    expect(entries.map((entry) => entry.id)).toEqual(["sg-01"]);
  });

  it("prints a dry-run table without implying that a browser was launched", () => {
    const output = formatStage0BLabDryRun([EXACT_EVENT, LISTING]);
    expect(output).toContain("Stage 0B Activity Provider Skill Runtime lab plan");
    expect(output).toContain(EXACT_EVENT.url);
    expect(output).toContain(LISTING.url);
  });
});

describe("Stage 0B Browser Harness bridge code generation", () => {
  it("generates an external Browser Harness script that navigates, inspects, and screenshots only", () => {
    const python = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/stage0b.png");
    expect(python).toContain("new_tab(url)");
    expect(python).toContain("wait_for_load()");
    expect(python).toContain("capture_screenshot");
    expect(python).toContain("js(inspect_js)");
    expect(python).toContain("click_at_xy");
    expect(python).toContain("cdp('Target.closeTarget'");
    expect(python).toContain("ONEGENT_STAGE0B_RESULT_START");
    expect(python).not.toMatch(/type_text|fill_input|press_key/);
  });

  it("keeps live lab tabs open only when explicitly requested", () => {
    const defaultPython = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/stage0b.png");
    const keepOpenPython = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/stage0b.png", true);
    expect(defaultPython).toContain("keep_open = False");
    expect(defaultPython).toContain("if opened_target and not keep_open:");
    expect(keepOpenPython).toContain("keep_open = True");
  });

  it("filters Ticketmaster artist candidates by target title and provider event link", () => {
    const python = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/stage0b.png");
    expect(python).toContain("targetTokens");
    expect(python).toContain("labelMatchesTarget(item.label)");
    expect(python).toContain("linkLooksLikeProviderEvent(item.link)");
    expect(python).toContain("fans also viewed");
  });

  it("attempts screenshot and page_info capture even on Browser Harness exceptions", () => {
    const python = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/stage0b.png");
    expect(python).toContain("except Exception as exc:");
    expect(python).toContain("captured = capture_screenshot(screenshot_path, full=True)");
    expect(python).toContain("info = page_info()");
  });

  it("does not treat ordinary header Sign In/Register text as an account wall", () => {
    const python = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/stage0b.png");
    expect(python).toContain("passwordFieldVisible");
    expect(python).toContain("loginHeading");
    expect(python).not.toContain("if (/sign in|log in|login|create account");
  });

  it("does not use broad section/row text alone as a seat-selection hard stop", () => {
    const python = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/stage0b.png");
    expect(python).toContain("eventPageLike");
    expect(python).toContain("standard tickets");
    expect(python).toContain("sec\\\\s+\\\\d+");
    expect(python).not.toContain("section\\s+\\d+|row\\s+\\w+");
  });

  it("embeds the input URL and screenshot path as quoted literals", () => {
    const python = buildBrowserHarnessPython(EXACT_EVENT, "C:/tmp/with spaces/stage0b.png");
    expect(python).toContain(JSON.stringify(EXACT_EVENT.url));
    expect(python).toContain(JSON.stringify("C:/tmp/with spaces/stage0b.png"));
  });

  it("parses a sentinel-delimited Browser Harness payload", () => {
    const payload = parseBrowserHarnessPayload([
      "noise before",
      "ONEGENT_STAGE0B_RESULT_START",
      JSON.stringify({
        ok: true,
        currentUrl: EXACT_EVENT.url,
        screenshotPath: "C:/tmp/stage0b.png",
        visibleFacts: {
          title: "Nashville SC",
          candidate_count: 1,
          candidate_labels: ["Nashville SC vs D.C. United May 9, 2026"],
          candidate_links: ["https://www.ticketmaster.com/foo/event/abc"],
        },
        followedSafeLink: true,
        followTarget: { text: "Find Tickets", href: "https://www.ticketmaster.com/foo/event/abc" },
        hardStops: ["seat_selection_required", "not-real"],
      }),
      "ONEGENT_STAGE0B_RESULT_END",
    ].join("\n"));
    expect(payload.ok).toBe(true);
    expect(payload.visibleFacts?.title).toBe("Nashville SC");
    expect(payload.visibleFacts?.candidate_labels).toEqual(["Nashville SC vs D.C. United May 9, 2026"]);
    expect(payload.visibleFacts?.candidate_links).toEqual(["https://www.ticketmaster.com/foo/event/abc"]);
    expect(payload.followedSafeLink).toBe(true);
    expect(payload.followTarget?.text).toBe("Find Tickets");
    expect(payload.hardStops).toEqual(["seat_selection_required"]);
  });

  it("returns a provider-degraded payload when the sentinel is missing", () => {
    const payload = parseBrowserHarnessPayload("plain browser-harness output");
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/sentinel/);
  });
});

describe("Stage 0B Browser Harness observations classify into safe next actions", () => {
  it("classifies exact-event pages with evidence as exact_event_ready", () => {
    expect(classifyStage0BOutcome(EXACT_EVENT, okPayload({ candidate_count: 1 }))).toBe("exact_event_ready");
  });

  it("does not mark exact-event pages ready when the ticket widget never reaches a candidate or hard stop", () => {
    expect(classifyStage0BOutcome(EXACT_EVENT, okPayload({
      candidate_count: 0,
    }))).toBe("skill_patch_needed");
  });

  it("classifies listing pages with one candidate as single_candidate_ready", () => {
    expect(classifyStage0BOutcome(LISTING, okPayload({ candidate_count: 1 }))).toBe("single_candidate_ready");
  });

  it("classifies listing pages with multiple candidates as provider_listing_needs_choice", () => {
    expect(classifyStage0BOutcome(LISTING, okPayload({ candidate_count: 4 }))).toBe("provider_listing_needs_choice");
  });

  it("classifies rendered listing pages with zero extracted candidates as skill_patch_needed", () => {
    expect(classifyStage0BOutcome(LISTING, okPayload({ candidate_count: 0 }))).toBe("skill_patch_needed");
  });

  it("does not create a patch proposal for explicit no-events listing pages", () => {
    expect(classifyStage0BOutcome(LISTING, okPayload({
      title: "No events found",
      candidate_count: 0,
    }))).toBe("provider_listing_needs_choice");
  });

  it.each([
    ["seat_selection_required", "user_seat_selection_required"],
    ["login_or_signin_wall", "account_session_required"],
    ["otp_or_phone_verification", "account_session_required"],
    ["payment_form_visible", "payment_or_final_action_required"],
    ["final_confirm_button", "payment_or_final_action_required"],
    ["captcha_or_challenge", "provider_degraded"],
    ["cookie_consent_blocking_render", "provider_degraded"],
  ] as const)("maps hard stop %s to %s", (hardStop, expected) => {
    expect(classifyStage0BOutcome(EXACT_EVENT, okPayload({ hardStops: [hardStop] }))).toBe(expected);
  });

  it("classifies missing screenshot or missing visible facts as insufficient_evidence", () => {
    expect(classifyStage0BOutcome(EXACT_EVENT, {
      ok: true,
      currentUrl: EXACT_EVENT.url,
      visibleFacts: { title: "Nashville SC", candidate_count: 1 },
    })).toBe("insufficient_evidence");
    expect(classifyStage0BOutcome(EXACT_EVENT, {
      ok: true,
      currentUrl: EXACT_EVENT.url,
      screenshotPath: ".stage0b-evidence/run/shot.png",
    })).toBe("insufficient_evidence");
  });

  it("classifies Browser Harness errors as provider_degraded", () => {
    expect(classifyStage0BOutcome(EXACT_EVENT, { ok: false, error: "CDP disconnected" })).toBe("provider_degraded");
  });

  it.each([
    "PAGE NOT FOUND",
    "Well, this isn't right",
    "Something went wrong",
  ])("classifies provider error title %s as provider_degraded, not exact_event_ready", (title) => {
    expect(classifyStage0BOutcome(EXACT_EVENT, okPayload({
      title,
      candidate_count: 0,
    }))).toBe("provider_degraded");
  });

  it("provider error pages beat false hard-stop text matches", () => {
    expect(classifyStage0BOutcome(EXACT_EVENT, okPayload({
      title: "PAGE NOT FOUND",
      candidate_count: 0,
      hardStops: ["seat_selection_required"],
    }))).toBe("provider_degraded");
  });
});

describe("Stage 0B lab result evidence shape", () => {
  it("builds JSONL events and an L2RecoveryResult for an exact event", () => {
    const { events, result } = buildStage0BLabResult({
      entry: EXACT_EVENT,
      payload: okPayload({ title: "Nashville SC", candidate_count: 1 }),
      runId: "00000000-0000-4000-8000-000000000001",
      eventsPath: ".stage0b-evidence/run/events.jsonl",
      screenshotPath: ".stage0b-evidence/run/screenshots/tm.png",
      startedAt: "2026-05-08T00:00:00.000Z",
      finishedAt: "2026-05-08T00:00:10.000Z",
    });
    expect(events.map((event) => event.action)).toEqual(["navigate", "inspect", "screenshot", "complete"]);
    expect(result.classification).toBe("exact_event_ready");
    expect(result.safe_next_action).toBe("start_task");
    expect(result.evidence.event_count).toBe(events.length);
    expect(result.evidence.screenshot_paths).toEqual([".stage0b-evidence/run/screenshots/tm.png"]);
  });

  it("records a safe-follow action when Browser Harness clicked an allowed provider CTA", () => {
    const { events, result } = buildStage0BLabResult({
      entry: EXACT_EVENT,
      payload: okPayload({
        title: "Nashville SC",
        candidate_count: 1,
        followedSafeLink: true,
        followTarget: { text: "Find Tickets", href: EXACT_EVENT.url },
      }),
      runId: "00000000-0000-4000-8000-000000000004",
      eventsPath: ".stage0b-evidence/run/events.jsonl",
      screenshotPath: ".stage0b-evidence/run/screenshots/tm.png",
      startedAt: "2026-05-08T00:00:00.000Z",
      finishedAt: "2026-05-08T00:00:10.000Z",
    });
    expect(events.map((event) => event.action)).toEqual(["navigate", "inspect", "follow_safe_link", "screenshot", "complete"]);
    expect(events.find((event) => event.action === "follow_safe_link")?.notes).toContain("Find Tickets");
    expect(result.classification).toBe("exact_event_ready");
  });

  it("records hard stops in both JSONL events and result evidence", () => {
    const { events, result } = buildStage0BLabResult({
      entry: EXACT_EVENT,
      payload: okPayload({ hardStops: ["seat_selection_required"] }),
      runId: "00000000-0000-4000-8000-000000000002",
      eventsPath: ".stage0b-evidence/run/events.jsonl",
      screenshotPath: ".stage0b-evidence/run/screenshots/tm.png",
      startedAt: "2026-05-08T00:00:00.000Z",
      finishedAt: "2026-05-08T00:00:10.000Z",
    });
    expect(events.some((event) => event.action === "halt_at_hard_stop" && event.hardStop === "seat_selection_required")).toBe(true);
    expect(result.classification).toBe("user_seat_selection_required");
    expect(result.safe_next_action).toBe("user_handoff_required");
    expect(result.evidence.hard_stops).toEqual(["seat_selection_required"]);
  });

  it("falls back to the plan page type when the final URL resolves to an unknown provider page", () => {
    const entry: LabTestPlanEntry = {
      ...EXACT_EVENT,
      url: "https://www.ticketmaster.com/foo/event/abc",
      expected_resolver_page_type: "exact_event",
    };
    const { result } = buildStage0BLabResult({
      entry,
      payload: okPayload({
        currentUrl: "https://ads.example.com/interstitial",
        candidate_count: 1,
      }),
      runId: "00000000-0000-4000-8000-000000000003",
      eventsPath: ".stage0b-evidence/run/events.jsonl",
      screenshotPath: ".stage0b-evidence/run/screenshots/tm.png",
      startedAt: "2026-05-08T00:00:00.000Z",
      finishedAt: "2026-05-08T00:00:10.000Z",
    });
    expect(result.evidence.final_url).toBe("https://ads.example.com/interstitial");
    expect(result.evidence.final_page_type).toBe("exact_event");
  });

  it("emits a reviewed patch proposal when candidate extraction needs a skill patch", () => {
    const { result } = buildStage0BLabResult({
      entry: LISTING,
      payload: okPayload({
        title: "Kacey Musgraves Tickets",
        candidate_count: 0,
      }),
      runId: "00000000-0000-4000-8000-000000000005",
      eventsPath: ".stage0b-evidence/run/events.jsonl",
      screenshotPath: ".stage0b-evidence/run/screenshots/tm.png",
      startedAt: "2026-05-08T00:00:00.000Z",
      finishedAt: "2026-05-08T00:00:10.000Z",
    });
    expect(result.classification).toBe("skill_patch_needed");
    expect(result.safe_next_action).toBe("review_patch_proposal");
    expect(result.skill_patch_proposal).toMatchObject({
      kind: "selector_drift",
      patch_target: "lib/stage0b-skill-runtime/lab-runner.ts",
      risk: "medium",
    });
  });

  it("emits a reviewed patch proposal for exact-event pages stuck before a ticket boundary", () => {
    const { result } = buildStage0BLabResult({
      entry: EXACT_EVENT,
      payload: okPayload({
        title: "Nashville SC v D.C. United - Eddi Tagseth Bobblehead Night",
        candidate_count: 0,
      }),
      runId: "00000000-0000-4000-8000-000000000006",
      eventsPath: ".stage0b-evidence/run/events.jsonl",
      screenshotPath: ".stage0b-evidence/run/screenshots/tm.png",
      startedAt: "2026-05-08T00:00:00.000Z",
      finishedAt: "2026-05-08T00:00:10.000Z",
    });
    expect(result.classification).toBe("skill_patch_needed");
    expect(result.skill_patch_proposal?.observed_evidence).toContain("Nashville SC");
  });
});

function okPayload(options: {
  title?: string;
  currentUrl?: string;
  candidate_count?: number;
  followedSafeLink?: boolean;
  followTarget?: BrowserHarnessPayload["followTarget"];
  hardStops?: BrowserHarnessPayload["hardStops"];
} = {}): BrowserHarnessPayload {
  return {
    ok: true,
    currentUrl: options.currentUrl ?? EXACT_EVENT.url,
    screenshotPath: ".stage0b-evidence/run/screenshots/shot.png",
    visibleFacts: {
      title: options.title ?? "Nashville SC",
      candidate_count: options.candidate_count ?? 1,
      visible_dates: ["May 9, 2026"],
      visible_times: ["8:00 PM"],
    },
    followedSafeLink: options.followedSafeLink,
    followTarget: options.followTarget,
    hardStops: options.hardStops,
  };
}
