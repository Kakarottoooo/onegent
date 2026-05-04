import { NextResponse, type NextRequest } from "next/server";

import {
  FounderE2eParseError,
  buildEmptyRun,
  getExitCriteriaForPath,
  getPathDef,
  listFounderE2eRunSummaries,
  parseQaRun,
  readFounderE2eRunByFile,
  saveFounderE2eRun,
} from "@/lib/founder-e2e";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dev/founder-e2e-runs
 *   ? file=founder-e2e-...json   → return single run JSON
 *   ? template=quick|full        → return a fresh empty run for that path
 *   (no params)                  → list summaries
 *
 * Always dev-gated. Always returns 404 in production unless
 * ENABLE_DEV_BENCHMARK_API=1 (sharing the existing dev gate flag — adding
 * yet another env var would create more places to forget to set).
 */
export async function GET(req: NextRequest) {
  if (!isDevApiEnabled()) return notFound();

  const url = new URL(req.url);
  const file = url.searchParams.get("file");
  const template = url.searchParams.get("template");

  if (file) {
    const run = await readFounderE2eRunByFile(file);
    if (!run) {
      return NextResponse.json(
        { error: { code: "run_not_found", message: `No founder QA run named "${file}".` } },
        { status: 404 },
      );
    }
    return NextResponse.json({ run, file });
  }

  if (template) {
    if (template !== "quick" && template !== "full") {
      return NextResponse.json(
        { error: { code: "bad_template", message: `template must be "quick" or "full"` } },
        { status: 400 },
      );
    }
    const pathDef = getPathDef(template);
    const defs = getExitCriteriaForPath(template);
    const run = buildEmptyRun(pathDef, defs);
    return NextResponse.json({ run, template });
  }

  const runs = await listFounderE2eRunSummaries();
  return NextResponse.json({ runs, total: runs.length });
}

/**
 * POST /api/dev/founder-e2e-runs
 *   body = QaRun JSON
 *   → server recomputes summary + exit + writes to benchmark/runs/.
 */
export async function POST(req: NextRequest) {
  if (!isDevApiEnabled()) return notFound();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  let run;
  try {
    run = parseQaRun(payload);
  } catch (err) {
    if (err instanceof FounderE2eParseError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: "parse_error", message: "Could not parse run." } },
      { status: 400 },
    );
  }

  try {
    const result = await saveFounderE2eRun(run);
    return NextResponse.json(
      {
        file: result.file,
        run: result.run,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "save_failed",
          message: err instanceof Error ? err.message : "Could not save run.",
        },
      },
      { status: 500 },
    );
  }
}

function isDevApiEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_BENCHMARK_API === "1"
  );
}

function notFound() {
  return NextResponse.json(
    { error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );
}
