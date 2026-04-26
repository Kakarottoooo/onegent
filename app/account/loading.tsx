/**
 * Skeleton for /account. Tabs + content panel layout matches the real page.
 */
export default function AccountLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
        <div className="animate-pulse" style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ height: 32, width: 160, background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
          <div style={{ height: 16, width: 240, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
        </div>

        {/* Tab strip */}
        <div
          className="animate-pulse"
          style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-5)" }}
        >
          {[80, 70, 90].map((w, i) => (
            <div
              key={i}
              style={{ width: w, height: 32, background: "var(--ink-3)", borderRadius: "var(--radius-pill)" }}
            />
          ))}
        </div>

        {/* Form panel */}
        <div
          className="animate-pulse"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-6)",
            boxShadow: "var(--shadow-1)",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ marginBottom: "var(--space-5)" }}>
              <div style={{ height: 12, width: 100, background: "var(--ink-2)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
              <div style={{ height: 40, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
