import {
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
