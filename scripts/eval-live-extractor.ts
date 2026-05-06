import {
  evaluateLiveExtractorFixtures,
  evaluateLiveExtractorGate,
  renderLiveExtractorMarkdown,
  type LiveExtractorEvalReport,
  type LiveExtractorVerticalArg,
} from "@/lib/agent/nlu-v2/live-extractor-eval";

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
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric ${name}, got ${value}`);
  return parsed > 1 ? parsed / 100 : parsed;
}

function readCountArg(name: string): number | undefined {
  const value = readArg(name, "");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric ${name}, got ${value}`);
  return Math.floor(parsed);
}

const vertical = readArg("--vertical", "all") as LiveExtractorVerticalArg;
if (!["all", "restaurant", "hotel", "flight", "activity", "trip", "ambiguous", "refine", "profile-edit", "chitchat"].includes(vertical)) {
  throw new Error(`Unsupported --vertical ${vertical}`);
}

const count = Number(readArg("--count", "120"));
const report = evaluateLiveExtractorFixtures({
  vertical,
  count: Number.isFinite(count) ? count : 120,
});

let gate: ReturnType<typeof evaluateLiveExtractorGate> | null = null;
if (hasFlag("--gate")) {
  gate = evaluateLiveExtractorGate(report, {
    minPassRate: readRateArg("--min-pass-rate"),
    maxWrongVertical: readCountArg("--max-wrong-vertical"),
    maxConstraintLost: readCountArg("--max-constraint-lost"),
  });
}

if (hasFlag("--json")) {
  console.log(JSON.stringify(withGate(report, gate), null, 2));
} else {
  console.log(renderLiveExtractorMarkdown(report));
  if (gate) {
    console.log("");
    console.log("## Gate");
    console.log(gate.pass ? "PASS" : `FAIL\n- ${gate.errors.join("\n- ")}`);
  }
}

if (gate && !gate.pass) {
  console.error(`Live extractor eval gate failed:\n- ${gate.errors.join("\n- ")}`);
  process.exitCode = 1;
}

function withGate(
  report: LiveExtractorEvalReport,
  gateResult: ReturnType<typeof evaluateLiveExtractorGate> | null,
): LiveExtractorEvalReport | (LiveExtractorEvalReport & { gate: NonNullable<typeof gateResult> }) {
  return gateResult ? { ...report, gate: gateResult } : report;
}
