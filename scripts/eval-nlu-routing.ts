import {
  NLU_ROUTING_FIXTURES,
  NLU_ROUTING_MATRIX_SCOPE,
  NLU_ROUTING_MATRIX_TODO,
  evaluateNluRoutingMatrix,
  renderNluRoutingMatrixMarkdown,
} from "@/lib/agent/nlu-v2/routing-matrix";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const results = evaluateNluRoutingMatrix();

if (hasFlag("--json")) {
  console.log(
    JSON.stringify(
      {
        scope: NLU_ROUTING_MATRIX_SCOPE,
        todo: NLU_ROUTING_MATRIX_TODO,
        fixtureCount: NLU_ROUTING_FIXTURES.length,
        results,
      },
      null,
      2,
    ),
  );
} else {
  console.log(renderNluRoutingMatrixMarkdown(results));
}

if (results.some((result) => !result.pass)) {
  process.exitCode = 1;
}
