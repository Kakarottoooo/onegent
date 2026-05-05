import { describe, expect, it } from "vitest";

import {
  EXPEDIA_CONTROLLED_RETRY_PROMPT,
  EXPEDIA_CONTROLLED_RETRY_START_URL,
} from "@/lib/runtime-forensics/expedia-flight-live-readiness";
import {
  EXPEDIA_CONTROLLED_FLIGHT_PREFLIGHT_EXAMPLE,
  parseExpediaControlledFlightPreflightArgs,
  runExpediaControlledFlightPreflightCli,
} from "@/scripts/preflight-expedia-controlled-flight";

const EXACT_ARGS = [
  "--confirm-one-controlled-retry",
  "--prompt",
  EXPEDIA_CONTROLLED_RETRY_PROMPT,
  "--start-url",
  EXPEDIA_CONTROLLED_RETRY_START_URL,
] as const;

describe("preflight-expedia-controlled-flight CLI", () => {
  it("parses only the exact controlled retry argument shape", () => {
    expect(parseExpediaControlledFlightPreflightArgs(EXACT_ARGS)).toMatchObject({
      prompt: EXPEDIA_CONTROLLED_RETRY_PROMPT,
      startUrl: EXPEDIA_CONTROLLED_RETRY_START_URL,
      confirmedOneControlledRetry: true,
    });
    expect(EXPEDIA_CONTROLLED_FLIGHT_PREFLIGHT_EXAMPLE).toMatchObject({
      prompt: EXPEDIA_CONTROLLED_RETRY_PROMPT,
      startUrl: EXPEDIA_CONTROLLED_RETRY_START_URL,
    });
  });

  it("refuses broad-run arguments", () => {
    expect(() =>
      parseExpediaControlledFlightPreflightArgs([
        "--confirm-one-controlled-retry",
        "--all",
        "--prompt",
        EXPEDIA_CONTROLLED_RETRY_PROMPT,
        "--start-url",
        EXPEDIA_CONTROLLED_RETRY_START_URL,
      ]),
    ).toThrow(/Unsafe broad-run argument/);
  });

  it("passes with required env names while omitting env values", async () => {
    const output: string[] = [];
    const exitCode = await runExpediaControlledFlightPreflightCli(EXACT_ARGS, {
      env: {
        POSTGRES_URL: "postgres://secret",
        OPENAI_API_KEY: "sk-secret",
        USE_WORKER_FOR: "flight",
      },
      writeOutput: (text) => output.push(text),
      writeError: (text) => output.push(text),
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("Status**: `pass`");
    expect(output.join("\n")).toContain("Env values");
    expect(output.join("\n")).not.toContain("postgres://secret");
    expect(output.join("\n")).not.toContain("sk-secret");
  });

  it("fails closed when the prompt is not the exact controlled flight task", async () => {
    const output: string[] = [];
    const exitCode = await runExpediaControlledFlightPreflightCli(
      [
        "--confirm-one-controlled-retry",
        "--prompt",
        "Book a broad flight sweep",
        "--start-url",
        EXPEDIA_CONTROLLED_RETRY_START_URL,
      ],
      {
        env: {
          POSTGRES_URL: "postgres://secret",
          OPENAI_API_KEY: "sk-secret",
          USE_WORKER_FOR: "flight",
        },
        writeOutput: (text) => output.push(text),
        writeError: (text) => output.push(text),
      },
    );

    expect(exitCode).toBe(1);
    expect(output.join("\n")).toContain("Input prompt does not exactly match");
  });
});
