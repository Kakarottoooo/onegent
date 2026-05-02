import { NextResponse, type NextRequest } from "next/server";
import { readPhase0BenchmarkReportByFile } from "@/lib/benchmark/phase0-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ file: string }> },
) {
  if (!isDevBenchmarkApiEnabled()) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }

  const { file } = await ctx.params;
  const result = await readPhase0BenchmarkReportByFile(file);
  if (!result) {
    return NextResponse.json(
      { error: { code: "report_not_found", message: `No benchmark report named "${file}".` } },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
}

function isDevBenchmarkApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_BENCHMARK_API === "1";
}
