"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  jobId: string;
  /** Natural browser viewport size (default 1280×800) */
  browserWidth?: number;
  browserHeight?: number;
  /** Fill parent container instead of using aspect-ratio constraint */
  fullscreen?: boolean;
}

export default function BrowserLiveView({
  jobId,
  browserWidth = 1280,
  browserHeight = 800,
  fullscreen = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "closed" | "error">("connecting");
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);
  const closedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFrameAtRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const everConnectedRef = useRef(false);
  // Pending frame being decoded — prevents pile-up of simultaneous decodes
  const pendingDecodeRef = useRef(false);

  // ── SSE screenshot stream ───────────────────────────────────────────────────
  useEffect(() => {
    closedRef.current = false;
    lastFrameAtRef.current = 0;
    reconnectAttemptsRef.current = 0;
    everConnectedRef.current = false;
    pendingDecodeRef.current = false;
    let es: EventSource | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    /**
     * Draw a JPEG base64 frame onto the canvas using double-buffering.
     * Creates an off-screen Image, waits for it to decode, then draws in one
     * synchronous call — no visible flicker between old and new frame.
     */
    const drawFrame = (b64: string) => {
      if (pendingDecodeRef.current) return; // skip if already decoding
      pendingDecodeRef.current = true;

      const img = new Image();
      img.onload = () => {
        pendingDecodeRef.current = false;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // Draw atomically — no blank-canvas moment
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        frameCount.current++;
        lastFrameAtRef.current = Date.now();
        reconnectAttemptsRef.current = 0;
        everConnectedRef.current = true;
        clearReconnectTimer();
        setStatus("live");
      };
      img.onerror = () => {
        pendingDecodeRef.current = false;
      };
      img.src = `data:image/jpeg;base64,${b64}`;
    };

    const connect = () => {
      es = new EventSource(`/api/browser-live/${jobId}/stream`);

      es.addEventListener("connected", () => {
        clearReconnectTimer();
        reconnectAttemptsRef.current = 0;
        everConnectedRef.current = true;
        setStatus("live");
      });
      es.addEventListener("closed", () => {
        clearReconnectTimer();
        setStatus("closed");
        es?.close();
      });
      es.onmessage = (e) => {
        drawFrame(e.data);
      };
      es.onerror = () => {
        if (closedRef.current) return;
        reconnectAttemptsRef.current += 1;
        // Stop retrying after too many consecutive failures:
        // - Never connected: 4 attempts (session doesn't exist / 404)
        // - Was connected before: 8 attempts (~10s) then give up (session ended)
        const maxAttempts = everConnectedRef.current ? 8 : 4;
        if (reconnectAttemptsRef.current >= maxAttempts) {
          setStatus("closed");
          es?.close();
          return;
        }
        setStatus("connecting");
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (closedRef.current) return;
            es?.close();
            connect();
          }, 1000);
        }
      };
    };

    connect();

    // FPS counter
    const fpsInterval = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);

    // Watchdog: reconnect if no frame received for 2.5s
    const watchdogInterval = setInterval(() => {
      if (closedRef.current) return;
      if (!lastFrameAtRef.current) return;
      if (Date.now() - lastFrameAtRef.current > 2500 && !reconnectTimerRef.current) {
        setStatus("connecting");
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (closedRef.current) return;
          es?.close();
          connect();
        }, 150);
      }
    }, 800);

    return () => {
      closedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      es?.close();
      clearInterval(fpsInterval);
      clearInterval(watchdogInterval);
    };
  }, [jobId]);

  // ── Coordinate scaling ──────────────────────────────────────────────────────
  const toPageCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const scaleX = browserWidth / rect.width;
      const scaleY = browserHeight / rect.height;
      return {
        x: Math.round((clientX - rect.left) * scaleX),
        y: Math.round((clientY - rect.top) * scaleY),
      };
    },
    [browserWidth, browserHeight]
  );

  // ── Pointer handlers ────────────────────────────────────────────────────────
  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      const { x, y } = toPageCoords(e.clientX, e.clientY);
      await fetch(`/api/browser-live/${jobId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
    },
    [jobId, toPageCoords]
  );

  const handleWheel = useCallback(
    async (e: React.WheelEvent) => {
      const { x, y } = toPageCoords(e.clientX, e.clientY);
      await fetch(`/api/browser-live/${jobId}/scroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y, deltaY: e.deltaY }),
      });
    },
    [jobId, toPageCoords]
  );

  // ── Keyboard handler (active when component is focused) ────────────────────
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      e.preventDefault();
      const specialKeys = [
        "Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp",
        "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End",
        "PageUp", "PageDown", "F1", "F5", "F12",
      ];
      if (specialKeys.includes(e.key)) {
        await fetch(`/api/browser-live/${jobId}/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: e.key }),
        });
      } else if (e.key.length === 1) {
        await fetch(`/api/browser-live/${jobId}/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: e.key }),
        });
      }
    },
    [jobId]
  );

  // ── Status overlay ──────────────────────────────────────────────────────────
  const overlay =
    status === "connecting" ? (
      <div style={overlayStyle}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
        <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "#fff" }}>
          Connecting to browser…
        </div>
      </div>
    ) : status === "closed" ? (
      <div style={overlayStyle}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🏁</div>
        <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "#fff" }}>
          Session ended
        </div>
        <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
          Agent has finished or session was not active
        </div>
      </div>
    ) : status === "error" ? (
      <div style={overlayStyle}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontFamily: "var(--font-dm-sans)", fontSize: 13, color: "#fff" }}>
          Connection lost
        </div>
      </div>
    ) : null;

  return (
    <div style={{ position: "relative", width: "100%", ...(fullscreen ? { height: "100%" } : {}) }}>
      {/* Live badge */}
      {status === "live" && (
        <div style={{
          position: "absolute", top: 8, left: 8, zIndex: 10,
          display: "flex", alignItems: "center", gap: 5,
          backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 6,
          padding: "3px 8px",
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%", backgroundColor: "#22c55e",
            boxShadow: "0 0 6px #22c55e",
          }} />
          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "#fff", fontWeight: 600 }}>
            LIVE · {fps} fps
          </span>
        </div>
      )}

      {/* Keyboard focus hint */}
      {status === "live" && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 10,
          backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 6,
          padding: "3px 8px",
          fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "rgba(255,255,255,0.8)",
        }}>
          Click to type · Scroll to scroll
        </div>
      )}

      {/* Browser viewport — canvas for flicker-free double-buffered rendering */}
      <div
        ref={containerRef}
        tabIndex={0}
        onClick={handleClick}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        style={{
          position: "relative",
          cursor: status === "live" ? "crosshair" : "default",
          outline: "2px solid transparent",
          borderRadius: fullscreen ? 0 : 10,
          overflow: "hidden",
          backgroundColor: "#1e1e1e",
          ...(fullscreen
            ? { width: "100%", height: "100%" }
            : { aspectRatio: `${browserWidth} / ${browserHeight}`, width: "100%" }
          ),
        }}
      >
        <canvas
          ref={canvasRef}
          width={browserWidth}
          height={browserHeight}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {overlay}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "absolute", inset: 0,
  display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  backgroundColor: "rgba(0,0,0,0.6)",
  borderRadius: 10,
};
