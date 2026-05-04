/**
 * Dev-only API for the Phase 1 Quality Gate.
 *
 *   GET  /api/dev/phase1-quality-gates           → list summaries
 *   GET  /api/dev/phase1-quality-gates?file=…    → one full run
 *   POST /api/dev/phase1-quality-gates           → save a run (JSON body)
 *
 * Gating: 404 unless we're outside production OR
 * ENABLE_DEV_BENCHMARK_API=1. This mirrors
 * `app/api/dev/benchmark-runs/route.ts`.
 *
 * Security:
 *  - File reads go through resolveSafeRunPath which combines a
 *    strict whitelist regex (no slashes, no "..", explicit suffix)
 *    with a path-prefix check after path.resolve normalization.
 *  - POST body is parsed with parseQualityGateRun (defensive
 *    schema validation) before being persisted. Malformed payloads
 *    return 400, never crash the server.
 *  - This endpoint never spawns subprocesses or runs the gate
 *    itself. It only stores artifacts produced by the local
 *    runner.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  isSafeQualityGateFileName,
  parseQualityGateRun,
  QualityGateParseError,
  fileNameFromRunId,
  listQualityGateRunSummaries,
  readQualityGateRunByFile,
  saveQualityGateRun,
  saveQualityGateMarkdown,
  formatQualityGateMarkdown,
  fileNameForQualityGateRun,
} from "@/lib/quality-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDevApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_BENCHMARK_API === "1";
}

function notFound() {
  return NextResponse.json(
    { error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );
}

export async function GET(request: NextRequest) {
  if (!isDevApiEnabled()) return notFound();

  const url = new URL(request.url);
  const file = url.searchParams.get("file");

  if (file) {
    if (!isSafeQualityGateFileName(file)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_filename",
            message:
              "filename must match phase1-quality-gate-<id>.(json|md) and must not contain path separators.",
          },
        },
        { status: 400 },
      );
    }
    try {
      const run = await readQualityGateRunByFile(file);
      return NextResponse.json({ run, fileName: file });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      // Distinguish ENOENT (404) from parse errors (400) for the
      // dashboard. Other IO errors fall through as 500.
      const code =
        err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "ENOENT"
          ? "not_found"
          : err instanceof QualityGateParseError
          ? "invalid_payload"
          : "read_failed";
      const status = code === "not_found" ? 404 : code === "invalid_payload" ? 400 : 500;
      return NextResponse.json(
        { error: { code, message } },
        { status },
      );
    }
  }

  const runs = await listQualityGateRunSummaries();
  return NextResponse.json({ runs, total: runs.length });
}

export async function POST(request: NextRequest) {
  if (!isDevApiEnabled()) return notFound();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Body is not valid JSON." } },
      { status: 400 },
    );
  }

  let run;
  try {
    run = parseQualityGateRun(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "invalid payload";
    return NextResponse.json(
      { error: { code: "invalid_payload", message } },
      { status: 400 },
    );
  }

  // Persist JSON + MD next to it. The runner already does this on
  // local disk; this endpoint mirrors the behavior so a CI worker
  // running the gate elsewhere can POST results into the dashboard.
  const fileName = fileNameFromRunId(run.runId);
  await saveQualityGateRun(run, { fileName });
  const mdName = fileNameForQualityGateRun(run.runId, "md");
  await saveQualityGateMarkdown(mdName, formatQualityGateMarkdown(run));

  return NextResponse.json(
    { ok: true, fileName, mdName },
    { status: 201 },
  );
}
