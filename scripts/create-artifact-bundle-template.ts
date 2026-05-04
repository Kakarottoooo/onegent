import { pathToFileURL } from "node:url";

export type ArtifactBundleTemplateKind = "restaurant" | "expedia" | "hotel";

export interface ArtifactBundleTemplateCliIO {
  writeOutput?: (text: string) => void;
  writeError?: (text: string) => void;
}

export interface ArtifactBundleTemplateCliArgs {
  kind: ArtifactBundleTemplateKind;
}

export type ArtifactBundleTemplateCliErrorCode = "usage" | "invalid_kind";

export class ArtifactBundleTemplateCliError extends Error {
  readonly code: ArtifactBundleTemplateCliErrorCode;
  readonly exitCode: number;

  constructor(code: ArtifactBundleTemplateCliErrorCode, message: string) {
    super(message);
    this.name = "ArtifactBundleTemplateCliError";
    this.code = code;
    this.exitCode = 1;
  }
}

export const ARTIFACT_BUNDLE_TEMPLATE_KINDS: readonly ArtifactBundleTemplateKind[] = [
  "restaurant",
  "expedia",
  "hotel",
] as const;

export const ARTIFACT_BUNDLE_TEMPLATE_CLI_USAGE = [
  "Usage:",
  "  npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant",
  "  npx tsx scripts/create-artifact-bundle-template.ts --kind expedia",
  "  npx tsx scripts/create-artifact-bundle-template.ts --kind hotel",
  "",
  "Prints a synthetic no-live artifact bundle template to stdout.",
  "Replace placeholders only with already-collected post-live evidence.",
].join("\n");

const TEMPLATE_KIND_DETAILS: Record<
  ArtifactBundleTemplateKind,
  {
    providerPlaceholder: string;
    scenarioPlaceholder: string;
    stepType: string;
    params: Record<string, string | number>;
  }
> = {
  restaurant: {
    providerPlaceholder: "<provider: resy-or-opentable>",
    scenarioPlaceholder: "<restaurant-scenario>",
    stepType: "restaurant",
    params: {
      restaurant: "<restaurant-name-from-job-params>",
      city: "<city-from-job-params>",
      date: "<date-from-job-params>",
      time: "<time-from-job-params>",
      partySize: "<party-size-from-job-params>",
    },
  },
  expedia: {
    providerPlaceholder: "<provider: expedia>",
    scenarioPlaceholder: "flight",
    stepType: "flight",
    params: {
      origin: "<origin-airport-from-job-params>",
      dest: "<destination-airport-from-job-params>",
      date: "<departure-date-from-job-params>",
      passengers: "<passenger-count-from-job-params>",
      cabin_class: "<cabin-class-from-job-params>",
      targetAirline: "<target-airline-from-job-params>",
      targetDepartureTime: "<target-departure-time-from-job-params>",
      targetFlightNumber: "<target-flight-number-from-job-params>",
      targetPrice: "<target-price-from-job-params>",
    },
  },
  hotel: {
    providerPlaceholder: "<provider: booking-com-or-hotels-com>",
    scenarioPlaceholder: "hotel",
    stepType: "hotel",
    params: {
      hotel_name: "<hotel-name-from-job-params>",
      city: "<city-from-job-params>",
      checkin: "<checkin-date-from-job-params>",
      checkout: "<checkout-date-from-job-params>",
      adults: "<adult-count-from-job-params>",
      rooms: "<room-count-from-job-params>",
    },
  },
};

export function normalizeArtifactBundleTemplateKind(
  value: string | undefined,
): ArtifactBundleTemplateKind | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return ARTIFACT_BUNDLE_TEMPLATE_KINDS.includes(
    normalized as ArtifactBundleTemplateKind,
  )
    ? (normalized as ArtifactBundleTemplateKind)
    : null;
}

export function parseArtifactBundleTemplateCliArgs(
  argv: readonly string[],
): ArtifactBundleTemplateCliArgs {
  const args = argv.filter((arg) => arg.trim().length > 0);
  let kindInput: string | undefined;
  let expectedLength = 0;

  if (args[0] === "--kind") {
    kindInput = args[1];
    expectedLength = 2;
  } else if (args[0]?.startsWith("--kind=")) {
    kindInput = args[0].slice("--kind=".length);
    expectedLength = 1;
  } else {
    throw new ArtifactBundleTemplateCliError(
      "usage",
      "Template kind is required. Pass --kind restaurant, --kind expedia, or --kind hotel.",
    );
  }

  if (args.length > expectedLength) {
    throw new ArtifactBundleTemplateCliError(
      "usage",
      `Unexpected arguments: ${args.slice(expectedLength).join(" ")}`,
    );
  }

  const kind = normalizeArtifactBundleTemplateKind(kindInput);
  if (!kind) {
    throw new ArtifactBundleTemplateCliError(
      "invalid_kind",
      `Invalid template kind: ${kindInput ?? "(missing)"}. Expected one of: ${ARTIFACT_BUNDLE_TEMPLATE_KINDS.join(
        ", ",
      )}.`,
    );
  }

  return { kind };
}

export function createArtifactBundleTemplate(
  kind: ArtifactBundleTemplateKind,
): Record<string, unknown> {
  const details = TEMPLATE_KIND_DETAILS[kind];

  return {
    synthetic: true,
    templateId: `synthetic-${kind}-artifact-bundle-template`,
    templateKind: kind,
    job: {
      id: "<job-id>",
      taskId: "<task-id>",
      provider: details.providerPlaceholder,
      scenario: details.scenarioPlaceholder,
      status: "<booking_jobs.status>",
      errorMessage: "<top-level-or-step-error>",
      terminalReason: "<step-terminalReason-if-present>",
      terminalCode: "<step-terminalCode-if-present>",
      steps: [
        {
          type: details.stepType,
          status: "<steps[0].status>",
          error: "<steps[0].error>",
          terminalReason: "<steps[0].terminalReason-if-present>",
          terminalCode: "<steps[0].terminalCode-if-present>",
          __source: "<steps[0].body.__source-or-step.__source>",
          body: {
            scenario: details.scenarioPlaceholder,
            params: details.params,
          },
        },
      ],
      params: details.params,
      decisionLog: [
        {
          at: "<timestamp>",
          level: "<level>",
          event: "<event-name>",
          message: "<decision-log-message>",
        },
      ],
    },
    dbRow: "<optional-copied-booking_jobs-row>",
    workerLogExcerpt: "<bounded-worker-log-excerpt>",
    workerLogPath: "<path-to-codex-worker.log>",
    screenshotPaths: ["<path-to-provider-screenshot>"],
    liveSnapshotPaths: ["<path-to-live-snapshot-json>"],
    notes: [
      "Synthetic no-live bridge template. Replace placeholders only with already-collected evidence.",
      "Do not include payment card numbers, CVV/CVC/security-code values, challenge-code values, login-bypass steps, or final-confirmation actions.",
    ],
  };
}

export function formatArtifactBundleTemplate(
  kind: ArtifactBundleTemplateKind,
): string {
  return `${JSON.stringify(createArtifactBundleTemplate(kind), null, 2)}\n`;
}

export async function runArtifactBundleTemplateCli(
  argv: readonly string[],
  io: ArtifactBundleTemplateCliIO = {},
): Promise<number> {
  const writeOutput = io.writeOutput ?? ((text: string) => console.log(text));
  const writeError = io.writeError ?? ((text: string) => console.error(text));

  if (argv[0] === "-h" || argv[0] === "--help") {
    writeError(ARTIFACT_BUNDLE_TEMPLATE_CLI_USAGE);
    return 0;
  }

  try {
    const { kind } = parseArtifactBundleTemplateCliArgs(argv);
    writeOutput(formatArtifactBundleTemplate(kind));
    return 0;
  } catch (error) {
    if (error instanceof ArtifactBundleTemplateCliError) {
      writeError(`${error.message}\n${ARTIFACT_BUNDLE_TEMPLATE_CLI_USAGE}`);
      return error.exitCode;
    }
    throw error;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runArtifactBundleTemplateCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
