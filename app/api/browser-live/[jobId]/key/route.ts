import { browserSessionStore } from "@/lib/browser-session-store";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const page = browserSessionStore.get(jobId);
  if (!page) return Response.json({ error: "Session not found" }, { status: 404 });

  const { key, text } = await req.json();
  try {
    if (text) {
      await page.keyboard.type(text, { delay: 30 });
    } else if (key) {
      await page.keyboard.press(key);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
