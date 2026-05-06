import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runAgent } from "@/lib/agent";
import { ChatRequestSchema } from "@/lib/schemas";

// ─── In-memory rate limiter ────────────────────────────────────────────────────
// For multi-replica deployments, replace with @upstash/ratelimit + Redis.
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Error classification ──────────────────────────────────────────────────────

function classifyError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes("Agent timeout"))
      return "Request timed out — the search took too long. Please try again.";
    if (err.message.includes("Google Places"))
      return "Location search failed. Please try again.";
    if (err.message.includes("MiniMax API"))
      return "AI service temporarily unavailable. Please try again.";
    if (err.message.includes("Rate limit"))
      return "Too many requests. Please wait a moment.";
  }
  return "Something went wrong. Please try again.";
}

// ─── Timeout ───────────────────────────────────────────────────────────────────

export const maxDuration = 60; // Vercel: allow up to 60s for multi-step scenario plans

const AGENT_TIMEOUT_MS = 58_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Agent timeout: request took too long")), ms)
    ),
  ]);
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Rate limiting
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const rawBody = await req.json().catch(() => null);
  const body = ChatRequestSchema.safeParse(rawBody);
  if (!body.success) {
    console.warn("[chat] invalid request", JSON.stringify({
      issues: body.error.issues,
      bodyKeys: rawBody && typeof rawBody === "object" ? Object.keys(rawBody) : null,
      messagePreview: typeof rawBody?.message === "string" ? rawBody.message.slice(0, 80) : null,
      historyLen: Array.isArray(rawBody?.history) ? rawBody.history.length : null,
      category_hint: rawBody?.category_hint,
    }));
    return NextResponse.json({ error: "Invalid request.", issues: body.error.issues }, { status: 400 });
  }

  const { message, history, city, gpsCoords, nearLocation, sessionPreferences, profileContext, customWeights, session_id, pinned_plan_id, category_hint, confirmed_constraints } = body.data;
  // Derive userId from Clerk server-side auth — never trust client-supplied user_id
  const { userId: user_id } = await auth().catch(() => ({ userId: null }));
  const request_id = crypto.randomUUID();

  console.log(JSON.stringify({
    type: "request",
    request_id,
    ip,
    message: message.slice(0, 100),
    city,
    timestamp: new Date().toISOString(),
  }));

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        const chunk = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      const keepAlive = setInterval(() => {
        sendEvent({ type: "status", request_id, stage: "working", category: category_hint ?? null });
      }, 15_000);

      try {
        sendEvent({ type: "status", request_id, stage: "started", category: category_hint ?? null });
        const result = await withTimeout(
          runAgent(
            message,
            history,
            city ?? undefined,
            gpsCoords ?? null,
            nearLocation ?? undefined,
            sessionPreferences ?? undefined,
            profileContext ?? undefined,
            {
              onPartial: (cards, requirements) => {
                sendEvent({ type: "partial", cards, requirements });
              },
            },
            customWeights ?? undefined,
            session_id ?? undefined,
            user_id ?? undefined,
            pinned_plan_id ?? undefined,
            category_hint ?? undefined,
            confirmed_constraints
          ),
          AGENT_TIMEOUT_MS
        );

        const recCount =
          result.category === "hotel"
            ? result.hotelRecommendations.length
            : result.category === "flight"
            ? result.flightRecommendations.length
            : result.category === "activity"
            ? result.activityRecommendations.length
            : result.category === "credit_card"
            ? result.creditCardRecommendations.length
            : result.category === "laptop"
            ? result.laptopRecommendations.length
            : result.category === "smartphone"
            ? result.smartphoneRecommendations.length
            : result.category === "headphone"
            ? result.headphoneRecommendations.length
            : result.recommendations.length;

        console.log(JSON.stringify({
          type: "response",
          request_id,
          category: result.category,
          recommendations_count: recCount,
          timestamp: new Date().toISOString(),
        }));

        sendEvent({
          type: "complete",
          requirements: result.requirements,
          recommendations: result.recommendations,
          hotelRecommendations: result.hotelRecommendations,
          flightRecommendations: result.flightRecommendations,
          creditCardRecommendations: result.creditCardRecommendations,
          laptopRecommendations: result.laptopRecommendations,
          laptop_db_gap_warning: result.laptop_db_gap_warning,
          smartphoneRecommendations: result.smartphoneRecommendations,
          headphoneRecommendations: result.headphoneRecommendations,
          device_db_gap_warning: result.device_db_gap_warning,
          subscriptionIntent: result.subscriptionIntent,
          activityRecommendations: result.activityRecommendations,
          missing_activity_fields: result.missing_activity_fields,
          missing_credit_card_fields: result.missing_credit_card_fields,
          missing_laptop_use_case: result.category === "laptop" && result.missing_flight_fields.includes("use_case"),
          missing_smartphone_use_case: result.category === "smartphone" && result.missing_flight_fields.includes("use_case"),
          missing_headphone_use_case: result.category === "headphone" && result.missing_flight_fields.includes("use_case"),
          missing_flight_fields: result.missing_flight_fields,
          no_direct_available: result.no_direct_available,
          suggested_refinements: result.suggested_refinements,
          scenarioIntent: result.scenarioIntent,
          decisionPlan: result.decisionPlan,
          result_mode: result.result_mode,
          category: result.category,
          output_language: result.output_language,
          request_id,
        });
      } catch (error) {
        console.error(JSON.stringify({
          type: "error",
          request_id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }));
        sendEvent({ type: "error", error: classifyError(error) });
      } finally {
        clearInterval(keepAlive);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
