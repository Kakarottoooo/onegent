import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeCaptureImageForText,
  buildScreenshotCaptureMessage,
  MAX_CAPTURE_IMAGE_BYTES,
  parseCaptureImagePayload,
} from "@/lib/capture/screenshot-analysis";

const dataUrl = "data:image/png;base64,aGVsbG8=";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parseCaptureImagePayload", () => {
  it("accepts bounded image data urls", () => {
    const payload = parseCaptureImagePayload({
      type: "image",
      mime_type: "image/png",
      data_url: dataUrl,
      name: "ticketmaster.png",
      size: 5,
    });

    expect(payload).toMatchObject({
      type: "image",
      mime_type: "image/png",
      data_url: dataUrl,
      name: "ticketmaster.png",
      size: 5,
    });
  });

  it("rejects non-image and oversized payloads", () => {
    expect(parseCaptureImagePayload({ type: "image", mime_type: "text/plain", data_url: dataUrl })).toBeNull();
    expect(parseCaptureImagePayload({ type: "image", mime_type: "image/png", data_url: "https://example.com/a.png" })).toBeNull();
    expect(
      parseCaptureImagePayload({
        type: "image",
        mime_type: "image/png",
        data_url: dataUrl,
        size: MAX_CAPTURE_IMAGE_BYTES + 1,
      }),
    ).toBeNull();
  });
});

describe("buildScreenshotCaptureMessage", () => {
  it("keeps screenshot evidence separate from the user instruction", () => {
    const message = buildScreenshotCaptureMessage({
      userText: "帮我订这个票",
      analysis: {
        status: "analyzed",
        summary_text: "Screenshot analysis:\n- scenario: activity\n- title: Lil Wayne",
      },
    });

    expect(message).toContain("[screenshot attached]");
    expect(message).toContain("scenario: activity");
    expect(message).toContain("User instruction: 帮我订这个票");
    expect(message).toContain("Ask for missing date");
  });
});

describe("analyzeCaptureImageForText", () => {
  it("calls OpenAI vision when an OpenAI user key is supplied", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            scenario: "activity",
            provider: "ticketmaster",
            title: "Lil Wayne",
            city: "Nashville",
            missing_fields: ["date", "time"],
            confidence: 0.81,
            concise_summary: "Ticketmaster artist page for Lil Wayne.",
          }),
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeCaptureImageForText({
      image: {
        type: "image",
        mime_type: "image/png",
        data_url: dataUrl,
        size: 5,
      },
      userText: "book this",
      userModel: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
    });

    expect(result.status).toBe("analyzed");
    expect(result.summary_text).toContain("provider: ticketmaster");
    expect(result.summary_text).toContain("title: Lil Wayne");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
    expect(JSON.parse((init as RequestInit).body as string).model).toBe("gpt-4o-mini");
  });

  it("retries gpt-5.5 when a stale user model is not allowed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Project does not have access to model `gpt-4o-mini`",
              code: "model_not_found",
            },
          }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      scenario: "activity",
                      provider: "ticketmaster",
                      title: "Disney On Ice",
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeCaptureImageForText({
      image: {
        type: "image",
        mime_type: "image/png",
        data_url: dataUrl,
        size: 5,
      },
      userText: "help me reserve May 17th ticket",
      userModel: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
    });

    expect(result.status).toBe("analyzed");
    expect(result.model).toBe("gpt-5.5");
    expect(result.summary_text).toContain("Disney On Ice");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(firstBody.model).toBe("gpt-4o-mini");
    expect(secondBody.model).toBe("gpt-5.5");
  });

  it("falls back safely when no vision key is available", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await analyzeCaptureImageForText({
      image: {
        type: "image",
        mime_type: "image/png",
        data_url: dataUrl,
        size: 5,
      },
      userText: "",
      userModel: { provider: "minimax", model: "MiniMax-Text-01" },
    });

    expect(result.status).toBe("unavailable");
    expect(result.summary_text).toContain("Screenshot received");
  });
});
