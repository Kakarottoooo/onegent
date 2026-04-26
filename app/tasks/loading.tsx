/**
 * Skeleton screen shown while /tasks (3300+ line client component) hydrates.
 * Next.js App Router automatically renders this between click and mount —
 * no client-side dance needed.
 */
export default function TasksLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
        {/* Header skeleton */}
        <div className="animate-pulse" style={{ marginBottom: "var(--space-6)" }}>
          <div style={{ height: 32, width: 200, background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-2)" }} />
          <div style={{ height: 16, width: 320, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
        </div>

        {/* Job card skeletons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[0, 1, 2].map((i) => (
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
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
                <div style={{ width: 28, height: 28, background: "var(--ink-3)", borderRadius: "var(--radius-pill)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 18, width: "60%", background: "var(--ink-3)", borderRadius: "var(--radius-sm)", marginBottom: 6 }} />
                  <div style={{ height: 12, width: "40%", background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
                </div>
              </div>
              <div style={{ height: 60, background: "var(--ink-2)", borderRadius: "var(--radius-sm)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
