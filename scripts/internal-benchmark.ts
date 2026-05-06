import {
  evaluateInternalBenchmarkGate,
  renderInternalBenchmarkMarkdown,
  runInternalNoLiveBenchmark,
  type InternalBenchmarkVerticalArg,
} from "@/lib/internal-benchmark";

function readArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readRateArg(name: string): number | undefined {
  const value = readArg(name, "");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric ${name}, got ${value}`);
  }
  return parsed > 1 ? parsed / 100 : parsed;
}

function readCountArg(name: string): number | undefined {
  const value = readArg(name, "");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric ${name}, got ${value}`);
  }
  return Math.floor(parsed);
}

const vertical = readArg("--vertical", "all") as InternalBenchmarkVerticalArg;
if (!["all", "restaurant", "hotel", "flight", "activity"].includes(vertical)) {
  throw new Error(`Unsupported --vertical ${vertical}`);
}

const mode = readArg("--mode", "no-live");
if (mode !== "no-live") {
  throw new Error("Only --mode no-live is supported.");
}

const count = Number(readArg("--count", "10"));
const report = runInternalNoLiveBenchmark({
  vertical,
  count: Number.isFinite(count) ? count : 10,
  mode: "no-live",
});

if (hasFlag("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderInternalBenchmarkMarkdown(report));
}

if (hasFlag("--gate")) {
  const gate = evaluateInternalBenchmarkGate(report, {
    minSuccessRate: readRateArg("--min-success-rate"),
    minArtifactCompletenessRate: readRateArg("--min-artifact-completeness"),
    maxFailureCounts: {
      routing_mismatch: readCountArg("--max-routing-mismatch"),
      unsafe_boundary: readCountArg("--max-unsafe-boundary"),
      artifact_incomplete: readCountArg("--max-artifact-incomplete"),
      provider_simulated_block: readCountArg("--max-provider-simulated-block"),
    },
  });

  if (!gate.pass) {
    console.error(`Internal benchmark gate failed:\n- ${gate.errors.join("\n- ")}`);
    process.exitCode = 1;
  }
}
