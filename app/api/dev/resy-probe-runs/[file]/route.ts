/**
 * GET /api/dev/resy-probe-runs/[file] — load one full probe run.
 *
 * `file` is the basename (e.g. `resy-availability-probe-2026-05-04T01-00-00-000Z.json`).
 * Filename pattern is enforced both here AND in the loader for defense in
 * depth. Path traversal attempts (`..`, slashes) are rejected up front.
 *
 * Response: ResyProbeRun (the full file contents) on success.
 * 404 on dev-api-disabled OR file not found OR shape mismatch.
 */
import { NextResponse } from "next/server";
import { loadResyProbeRun } from "@/lib/benchmark/resy-probe-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILENAME_PATTERN = /^resy-availability-probe-[A-Za-z0-9._-]+\.json$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  if (!isDevApiEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }

  const { file } = await params;

  // Reject anything that looks like path traversal before touching the loader.
  if (
    !file ||
    file.includes("/") ||
    file.includes("\\") ||
    file.includes("..") ||
    !FILENAME_PATTERN.test(file)
  ) {
    return NextResponse.json(
      { error: { code: "invalid_filename", message: "Invalid probe-run filename." } },
      { status: 400 },
    );
  }

  const run = await loadResyProbeRun(file);
  if (!run) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Probe run not found or unreadable." } },
      { status: 404 },
    );
  }

  return NextResponse.json({ run });
}

function isDevApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_BENCHMARK_API === "1";
}
