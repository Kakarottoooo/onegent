/**
 * Skeleton for /trips (trip history). Grid of trip cards.
 */
export default function TripsLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
        <div className="animate-pulse" style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ height: 32, width: 180, background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
          <div style={{ height: 16, width: 300, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--space-4)" }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
                boxShadow: "var(--shadow-1)",
              }}
            >
              <div style={{ height: 140, background: "var(--ink-2)" }} />
              <div style={{ padding: "var(--space-4)" }}>
                <div style={{ height: 18, width: "70%", background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
                <div style={{ height: 14, width: "50%", background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
