/**
 * Skeleton for /calendar. Month-grid layout matches the real calendar so
 * the user's eye doesn't have to re-scan when the data fills in.
 */
export default function CalendarLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
        <div
          className="animate-pulse"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "var(--space-6)",
          }}
        >
          <div style={{ height: 32, width: 200, background: "var(--ink-3)", borderRadius: "var(--radius-sm)" }} />
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <div style={{ width: 36, height: 36, background: "var(--ink-3)", borderRadius: "var(--radius-sm)" }} />
            <div style={{ width: 36, height: 36, background: "var(--ink-3)", borderRadius: "var(--radius-sm)" }} />
          </div>
        </div>

        <div
          className="animate-pulse"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-1)",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
          }}
        >
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={i}
              style={{
                aspectRatio: "1 / 1",
                borderRight: (i + 1) % 7 !== 0 ? "1px solid var(--ink-2)" : "none",
                borderBottom: i < 28 ? "1px solid var(--ink-2)" : "none",
                padding: "var(--space-2)",
              }}
            >
              <div style={{ height: 14, width: 20, background: "var(--ink-2)", borderRadius: 3 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
