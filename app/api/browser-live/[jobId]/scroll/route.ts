import { browserSessionStore } from "@/lib/browser-session-store";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const page = browserSessionStore.get(jobId);
  if (!page) return Response.json({ error: "Session not found" }, { status: 404 });

  const { x, y, deltaY } = await req.json();
  try {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, deltaY);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
