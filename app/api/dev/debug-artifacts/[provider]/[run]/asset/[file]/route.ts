/**
 * GET /api/dev/debug-artifacts/[provider]/[run]/asset/[file]
 *
 * Serves raw bytes from `worker/.debug-screenshots/<provider>/<run>/<file>`
 * with the right Content-Type. Used by the dashboard's <img> + <iframe>
 * tags to render screenshots / HTML snapshots inline.
 *
 * Layered defense:
 *   - This handler validates each path segment up front.
 *   - lib/debug-artifacts.ts revalidates and refuses anything outside
 *     the run dir (symlink-safe via path.resolve + prefix check).
 *
 * Same dev gate as the rest of /api/dev/*.
 */
import { NextResponse } from "next/server";
import {
  readDebugArtifactAsset,
  ALLOWED_ARTIFACT_FILES,
  PROVIDER_WHITELIST,
  RUN_DIR_PATTERN,
} from "@/lib/debug-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string; run: string; file: string }> },
) {
  if (!isDevApiEnabled()) {
    return notFound();
  }
  const { provider, run, file } = await params;

  if (!provider || !run || !file) return badRequest("missing path segment");
  if (provider.includes("/") || provider.includes("\\") || provider.includes("..")) return badRequest("invalid provider");
  if (run.includes("/") || run.includes("\\") || run.includes("..")) return badRequest("invalid run");
  if (file.includes("/") || file.includes("\\") || file.includes("..")) return badRequest("invalid file");
  if (!PROVIDER_WHITELIST.has(provider)) return notFound();
  if (!RUN_DIR_PATTERN.test(run)) return notFound();
  if (!ALLOWED_ARTIFACT_FILES.has(file)) return notFound();

  const result = await readDebugArtifactAsset(provider, run, file);
  if (!result) return notFound();

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
      "Content-Length": String(result.bytes.length),
    },
  });
}

function notFound() {
  return NextResponse.json(
    { error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );
}

function badRequest(message: string) {
  return NextResponse.json(
    { error: { code: "bad_request", message } },
    { status: 400 },
  );
}

function isDevApiEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_BENCHMARK_API === "1"
  );
}
