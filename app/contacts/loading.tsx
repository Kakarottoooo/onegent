/**
 * Skeleton for /contacts (people directory). List layout.
 */
export default function ContactsLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
        <div className="animate-pulse" style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ height: 32, width: 180, background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
          <div style={{ height: 16, width: 280, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
        </div>

        <div
          className="animate-pulse"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-1)",
            overflow: "hidden",
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "var(--space-4)",
                borderBottom: i < 4 ? "1px solid var(--ink-2)" : "none",
              }}
            >
              <div style={{ width: 40, height: 40, background: "var(--ink-3)", borderRadius: "var(--radius-pill)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: 16, width: "40%", background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: 6 }} />
                <div style={{ height: 12, width: "60%", background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
              </div>
              <div style={{ width: 80, height: 28, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
