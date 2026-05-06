import {
  evaluateNluRoutingMatrix,
  renderNluRoutingMatrixMarkdown,
} from "@/lib/agent/nlu-v2/routing-matrix";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const results = evaluateNluRoutingMatrix();

if (hasFlag("--json")) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  console.log(renderNluRoutingMatrixMarkdown(results));
}

if (results.some((result) => !result.pass)) {
  process.exitCode = 1;
}
