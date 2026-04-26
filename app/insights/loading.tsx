/**
 * Skeleton for /insights (memory / agent learnings).
 */
export default function InsightsLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
        <div className="animate-pulse" style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ height: 32, width: 180, background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
          <div style={{ height: 16, width: 320, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-5)",
                boxShadow: "var(--shadow-1)",
              }}
            >
              <div style={{ height: 16, width: "85%", background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
              <div style={{ height: 14, width: "60%", background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
