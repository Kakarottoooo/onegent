/**
 * Skeleton for /rooms (Decision Room list). Two-column grid layout matches
 * the real page so users don't see content "jump" when hydration finishes.
 */
export default function RoomsLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
        <div className="animate-pulse" style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ height: 32, width: 240, background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
          <div style={{ height: 16, width: 380, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "var(--space-4)" }}>
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
                minHeight: 180,
              }}
            >
              <div style={{ height: 22, width: "70%", background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
              <div style={{ height: 14, width: "50%", background: "var(--ink-2)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-4)" }} />
              <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                <div style={{ width: 28, height: 28, background: "var(--ink-3)", borderRadius: "var(--radius-pill)" }} />
                <div style={{ width: 28, height: 28, background: "var(--ink-3)", borderRadius: "var(--radius-pill)" }} />
                <div style={{ width: 28, height: 28, background: "var(--ink-3)", borderRadius: "var(--radius-pill)" }} />
              </div>
              <div style={{ height: 12, width: "85%", background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
