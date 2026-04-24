/**
 * Scenario grid — four scenarios across one API. Hand-drawn SVG icons
 * (single-color, currentColor) so we don't pull a generic icon set.
 *
 * Card hover: lift 4px + shadow-hover + icon rotates 6° + subtle gold
 * gradient sheen fades in from the top edge. All CSS, no client JS.
 */

interface Scenario {
  title: string;
  providers: string;
  time: string;
  status: "live" | "preview";
  icon: React.ReactNode;
}

const SCENARIOS: Scenario[] = [
  {
    title: "Restaurant",
    providers: "OpenTable · Resy · Direct sites",
    time: "30–120 s",
    status: "live",
    icon: <RestaurantIcon />,
  },
  {
    title: "Hotel",
    providers: "Booking.com · Expedia · Hotels.com",
    time: "60–180 s",
    status: "live",
    icon: <HotelIcon />,
  },
  {
    title: "Flight",
    providers: "Expedia · Google Flights · Direct airlines",
    time: "90–240 s",
    status: "preview",
    icon: <FlightIcon />,
  },
  {
    title: "Activity",
    providers: "Viator · GetYourGuide · Direct venues",
    time: "60–180 s",
    status: "preview",
    icon: <ActivityIcon />,
  },
];

export function ScenarioGrid() {
  return (
    <section className="dev-section">
      <div className="dev-container">
        <header className="dev-section-header">
          <span className="dev-eyebrow dev-section-header__eyebrow">
            What it books
          </span>
          <h2 className="dev-h1">Four scenarios. One API.</h2>
          <p className="dev-lead">
            One verb across four very different parts of a trip. Same
            authentication, same job lifecycle, same payment-safety
            invariant — different providers underneath.
          </p>
        </header>

        <div className="dev-scenario-grid">
          {SCENARIOS.map((s) => (
            <article key={s.title} className="dev-scenario-card">
              <div className="dev-scenario-card-icon">{s.icon}</div>
              <div>
                <div className="dev-scenario-card-title">{s.title}</div>
                <div
                  className="dev-scenario-card-providers"
                  style={{ marginTop: "var(--space-2)" }}
                >
                  {s.providers}
                </div>
              </div>
              <div className="dev-scenario-card-meta">
                <span
                  className={`dev-badge dev-badge--${s.status}`}
                  aria-label={`Status: ${s.status}`}
                >
                  {s.status}
                </span>
                <span className="dev-scenario-card-time">{s.time}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Custom single-color SVG marks ──────────────────────────────────── */

function RestaurantIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* fork (left) */}
      <path d="M13 6v8a3 3 0 0 0 3 3v17" />
      <path d="M16 6v6" />
      <path d="M19 6v8a3 3 0 0 1-3 3" />
      {/* knife / plate accent (right) */}
      <path d="M27 6c-2 0-3 4-3 8s1 5 3 5v15" />
    </svg>
  );
}

function HotelIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* building silhouette */}
      <path d="M8 34V12l12-5 12 5v22" />
      <path d="M8 34h24" />
      {/* windows grid */}
      <rect x="13" y="15" width="3" height="3" />
      <rect x="18.5" y="15" width="3" height="3" />
      <rect x="24" y="15" width="3" height="3" />
      <rect x="13" y="20" width="3" height="3" />
      <rect x="24" y="20" width="3" height="3" />
      {/* door */}
      <path d="M17.5 34v-6a2.5 2.5 0 0 1 5 0v6" />
    </svg>
  );
}

function FlightIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* paper plane / wing */}
      <path d="M5 22l30-14-7 26-9-10-14-2z" />
      <path d="M19 24L28 8" opacity="0.5" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* ticket with notch */}
      <path d="M6 14a2 2 0 0 1 2-2h24a2 2 0 0 1 2 2v4a2 2 0 0 0 0 4v4a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4v-4z" />
      {/* perforation line */}
      <path d="M22 12v4M22 24v4" strokeDasharray="2 2" />
      {/* star inside */}
      <path d="M14 21l2-2 2 2-1-2.5L19 17h-2.5L16 14.5 15.5 17H13l2 1.5z" fill="currentColor" stroke="none" opacity="0.85" />
    </svg>
  );
}
