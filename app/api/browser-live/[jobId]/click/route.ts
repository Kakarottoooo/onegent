import { browserSessionStore } from "@/lib/browser-session-store";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const page = browserSessionStore.get(jobId);
  if (!page) return Response.json({ error: "Session not found" }, { status: 404 });

  const { x, y, button = "left", doubleClick = false } = await req.json();
  try {
    if (doubleClick) {
      await page.mouse.dblclick(x, y, { button });
    } else {
      await page.mouse.click(x, y, { button });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
