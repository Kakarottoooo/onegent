/**
 * Expedia flight controlled-retry readiness checks.
 *
 * Pure no-live module: validates operator-provided names, prompts, and artifact
 * paths before a founder-approved retry. It never reads env files, prints env
 * values, starts workers, opens providers, or performs provider actions.
 */

export const EXPEDIA_CONTROLLED_RETRY_PROMPT =
  "\u5e2e\u6211\u8ba2\u4e00\u4e2a6\u67081\u53f7\u4ece\u5965\u5170\u591a\u98de Nashville \u7684\u673a\u7968\uff0c\u4e00\u4e2a\u4eba";

export const EXPEDIA_CONTROLLED_RETRY_START_URL =
  "https://www.expedia.com/Flights-Search?trip=oneway&leg1=from:MCO,to:BNA,departure:2026-06-01TANYT&passengers=adults:1&options=cabinclass:coach&mode=search";

export const EXPEDIA_FLIGHT_REQUIRED_ENV_NAMES = [
  "POSTGRES_URL",
  "OPENAI_API_KEY",
] as const;

export const EXPEDIA_FLIGHT_HARD_STOPS = [
  "payment submission",
  "CVV",
  "OTP",
  "CAPTCHA",
  "login bypass",
  "final booking confirmation",
] as const;

export const EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS = {
  workerLogPath:
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\codex-worker.log",
  screenshotGlob:
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\worker\\.debug-screenshots\\flight-rpa-*",
  liveSnapshotGlob:
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\.debug-screenshots\\live\\<retry-job-id>\\*.json",
  benchmarkReportGlob:
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\benchmark\\runs\\<retry-run-id>.json",
} as const;

export type ExpediaFlightLiveReadinessCheckId =
  | "env-required-names"
  | "env-worker-routing"
  | "env-browserbase-pair"
  | "prompt-exact"
  | "start-url-exact"
  | "hard-stops"
  | "artifact-paths";

export interface ExpediaFlightLiveReadinessInput {
  env: Record<string, string | undefined | null>;
  prompt: string;
  startUrl: string;
  hardStops: readonly string[];
  artifactPaths: {
    workerLogPath?: string | null;
    screenshotPaths?: readonly string[] | null;
    liveSnapshotPaths?: readonly string[] | null;
    benchmarkReportPath?: string | null;
  };
}

export interface ExpediaFlightLiveReadinessCheck {
  id: ExpediaFlightLiveReadinessCheckId;
  ok: boolean;
  label: string;
  detail: string;
  missingEnvNames?: string[];
}

export interface ExpediaFlightLiveReadinessResult {
  ok: boolean;
  checks: ExpediaFlightLiveReadinessCheck[];
}

export function validateExpediaFlightLiveReadiness(
  input: ExpediaFlightLiveReadinessInput,
): ExpediaFlightLiveReadinessResult {
  const checks: ExpediaFlightLiveReadinessCheck[] = [
    checkRequiredEnvNames(input.env),
    checkWorkerRouting(input.env),
    checkBrowserbasePair(input.env),
    checkPrompt(input.prompt),
    checkStartUrl(input.startUrl),
    checkHardStops(input.hardStops),
    checkArtifactPaths(input.artifactPaths),
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function checkRequiredEnvNames(
  env: ExpediaFlightLiveReadinessInput["env"],
): ExpediaFlightLiveReadinessCheck {
  const missing = EXPEDIA_FLIGHT_REQUIRED_ENV_NAMES.filter(
    (name) => !hasValue(env[name]),
  );
  return {
    id: "env-required-names",
    ok: missing.length === 0,
    label: "Required env names",
    detail:
      missing.length === 0
        ? `Required env names present: ${EXPEDIA_FLIGHT_REQUIRED_ENV_NAMES.join(", ")}. Values intentionally omitted.`
        : `Missing required env names: ${missing.join(", ")}. Values intentionally omitted.`,
    ...(missing.length > 0 ? { missingEnvNames: [...missing] } : {}),
  };
}

function checkWorkerRouting(
  env: ExpediaFlightLiveReadinessInput["env"],
): ExpediaFlightLiveReadinessCheck {
  const raw = env.USE_WORKER_FOR;
  if (!hasValue(raw)) {
    return {
      id: "env-worker-routing",
      ok: true,
      label: "Worker routing",
      detail:
        "USE_WORKER_FOR is absent; no worker-route allowlist can block flight.",
    };
  }

  const entries = String(raw)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const includesFlight = entries.includes("flight");
  return {
    id: "env-worker-routing",
    ok: includesFlight,
    label: "Worker routing",
    detail: includesFlight
      ? "USE_WORKER_FOR is present and includes flight. Value intentionally omitted."
      : "USE_WORKER_FOR is present but does not include flight. Value intentionally omitted.",
  };
}

function checkBrowserbasePair(
  env: ExpediaFlightLiveReadinessInput["env"],
): ExpediaFlightLiveReadinessCheck {
  const hasApiKey = hasValue(env.BROWSERBASE_API_KEY);
  const hasProjectId = hasValue(env.BROWSERBASE_PROJECT_ID);
  const ok = hasApiKey === hasProjectId;
  return {
    id: "env-browserbase-pair",
    ok,
    label: "Browserbase env pair",
    detail: ok
      ? "Browserbase env names are both present or both absent. Values intentionally omitted."
      : "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be present together or absent together. Values intentionally omitted.",
    ...(!ok
      ? {
          missingEnvNames: [
            ...(!hasApiKey ? ["BROWSERBASE_API_KEY"] : []),
            ...(!hasProjectId ? ["BROWSERBASE_PROJECT_ID"] : []),
          ],
        }
      : {}),
  };
}

function checkPrompt(prompt: string): ExpediaFlightLiveReadinessCheck {
  const ok = prompt === EXPEDIA_CONTROLLED_RETRY_PROMPT;
  return {
    id: "prompt-exact",
    ok,
    label: "Exact input prompt",
    detail: ok
      ? "Input prompt exactly matches the controlled Expedia flight retry prompt."
      : "Input prompt does not exactly match the controlled Expedia flight retry prompt.",
  };
}

function checkStartUrl(startUrl: string): ExpediaFlightLiveReadinessCheck {
  const ok = startUrl === EXPEDIA_CONTROLLED_RETRY_START_URL;
  return {
    id: "start-url-exact",
    ok,
    label: "Exact Expedia start URL",
    detail: ok
      ? "Start URL exactly matches MCO/BNA/2026-06-01/1 adult economy."
      : "Start URL does not exactly match MCO/BNA/2026-06-01/1 adult economy.",
  };
}

function checkHardStops(
  hardStops: readonly string[],
): ExpediaFlightLiveReadinessCheck {
  const normalized = hardStops.map(normalize);
  const missing = EXPEDIA_FLIGHT_HARD_STOPS.filter((stop) => {
    const needle = normalize(stop);
    return !normalized.some((entry) => entry.includes(needle));
  });
  return {
    id: "hard-stops",
    ok: missing.length === 0,
    label: "Hard stops",
    detail:
      missing.length === 0
        ? "Hard stops cover payment submission, CVV, OTP, CAPTCHA, login bypass, and final booking confirmation."
        : `Hard stops are missing: ${missing.join(", ")}.`,
  };
}

function checkArtifactPaths(
  artifactPaths: ExpediaFlightLiveReadinessInput["artifactPaths"],
): ExpediaFlightLiveReadinessCheck {
  const workerLogOk =
    artifactPaths.workerLogPath === EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.workerLogPath;
  const screenshotOk = includesPath(
    artifactPaths.screenshotPaths,
    EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.screenshotGlob,
  );
  const liveSnapshotOk = includesPath(
    artifactPaths.liveSnapshotPaths,
    EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.liveSnapshotGlob,
  );
  const benchmarkOk =
    artifactPaths.benchmarkReportPath ===
    EXPEDIA_FLIGHT_EXPECTED_ARTIFACT_PATHS.benchmarkReportGlob;
  const missing = [
    ...(!workerLogOk ? ["worker log path"] : []),
    ...(!screenshotOk ? ["provider screenshot path"] : []),
    ...(!liveSnapshotOk ? ["live snapshot path"] : []),
    ...(!benchmarkOk ? ["benchmark report path"] : []),
  ];

  return {
    id: "artifact-paths",
    ok: missing.length === 0,
    label: "Artifact output paths",
    detail:
      missing.length === 0
        ? "Artifact paths cover worker log, flight-rpa screenshots, live snapshots, and benchmark report."
        : `Artifact paths missing or mismatched: ${missing.join(", ")}.`,
  };
}

function hasValue(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function includesPath(
  values: readonly string[] | null | undefined,
  expected: string,
): boolean {
  return Array.isArray(values) && values.includes(expected);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
