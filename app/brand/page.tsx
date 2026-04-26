/**
 * Brand explore — internal preview gallery for icon options.
 * Visit /brand to compare 5 candidates at multiple sizes.
 *
 * Once a winner is picked, copy its design into app/icon.tsx (the
 * Next.js auto-icon convention) and delete this folder.
 */
export const metadata = {
  title: "Brand · Onegent",
  description: "Internal icon design exploration.",
};

const OPTIONS = [
  {
    id: "c",
    name: "C — Horizon O · cream + black (current)",
    desc: "Original C reference — geometric ring with horizon line. Modern minimalist.",
  },
  {
    id: "f",
    name: "F — Sunrise · burnt orange + amber",
    desc: "Same structure, horizon lowered (sun cresting). Warm, inviting, dawn departure vibe.",
  },
  {
    id: "g",
    name: "G — Twilight · pink + lavender",
    desc: "Horizon raised (sun setting). Premium, romantic, evening arrival.",
  },
  {
    id: "h",
    name: "H — Aperture · forest emerald + gold",
    desc: "Three concentric rings. Camera iris / target / lens. Nature + precision.",
  },
  {
    id: "i",
    name: "I — Polar Compass · royal blue + white",
    desc: "Ring + cross axes + center dot. Cardinal directions, map, orientation.",
  },
  {
    id: "j",
    name: "J — Orbit · coral + cream on black",
    desc: "Big ring + small ring + connection. Round trip / departure-return / planetary orbit.",
  },
  {
    id: "a",
    name: "A — Serif O on deep ink (reference)",
    desc: "Original serif option for comparison. Luxury hotel monogram.",
  },
  {
    id: "b",
    name: "B — Inverse: dark O on cream (reference)",
    desc: "Original serif option for comparison. Book-cover editorial.",
  },
  {
    id: "d",
    name: "D — Wordmark 'On.' (reference)",
    desc: "Original wordmark option for comparison. Type-as-logo.",
  },
  {
    id: "e",
    name: "E — Stacked O + NEGENT (reference)",
    desc: "Original wordmark option for comparison. Editorial crest.",
  },
];

export default function BrandPage() {
  return (
    <main
      style={{
        background: "#000",
        color: "#fff",
        minHeight: "100vh",
        padding: "64px 48px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 700,
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          Brand · Icon Explore
        </h1>
        <p style={{ color: "#888", marginBottom: 64, fontSize: 16 }}>
          5 candidate marks rendered at 256 / 96 / 48 / 24 px. The 24 px
          column matters most — that's favicon / marketplace listing scale.
        </p>

        {OPTIONS.map((o) => (
          <section
            key={o.id}
            style={{
              padding: "40px 0",
              borderTop: "1px solid #1a1a1a",
              display: "flex",
              alignItems: "center",
              gap: 32,
            }}
          >
            <img
              src={`/brand/icon-${o.id}`}
              alt={o.name}
              style={{
                width: 256,
                height: 256,
                borderRadius: 28,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <img
                src={`/brand/icon-${o.id}`}
                alt={o.name}
                style={{ width: 96, height: 96, borderRadius: 16 }}
              />
              <img
                src={`/brand/icon-${o.id}`}
                alt={o.name}
                style={{ width: 48, height: 48, borderRadius: 8 }}
              />
              <img
                src={`/brand/icon-${o.id}`}
                alt={o.name}
                style={{ width: 24, height: 24, borderRadius: 4 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <h2
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                {o.name}
              </h2>
              <p style={{ color: "#aaa", fontSize: 15, lineHeight: 1.6 }}>
                {o.desc}
              </p>
              <a
                href={`/brand/icon-${o.id}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: 16,
                  fontSize: 13,
                  color: "#d4a443",
                  textDecoration: "underline",
                }}
              >
                Open full PNG →
              </a>
            </div>
          </section>
        ))}

        <p
          style={{
            color: "#555",
            fontSize: 13,
            marginTop: 80,
            paddingTop: 32,
            borderTop: "1px solid #1a1a1a",
          }}
        >
          Pick a winner, tell Claude the letter (A/B/C/D/E), and the chosen
          design will be promoted to app/icon.tsx + used everywhere
          (favicon, MCP manifest, ChatGPT Apps listing, Claude Desktop
          config preview).
        </p>
      </div>
    </main>
  );
}
