import Link from "next/link";

/**
 * Footer for developer surface. Minimal, editorial.
 * Pure server component — no client JS.
 */
export function DevFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--ink-200)",
        padding: "var(--space-16) var(--space-8) var(--space-12)",
        marginTop: "var(--space-32)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          maxWidth: "var(--container)",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr 1fr 1fr",
          gap: "var(--space-12)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--ink-900)",
              marginBottom: "var(--space-3)",
            }}
          >
            Onegent
          </div>
          <p
            className="dev-body-sm"
            style={{ maxWidth: "32ch", color: "var(--ink-500)" }}
          >
            The Travel Execution Layer for AI agents. Book restaurants,
            hotels, flights, and activities through one API.
          </p>
        </div>

        <FooterColumn label="Product">
          <FooterLink href="/developers">Overview</FooterLink>
          <FooterLink href="/developers/docs">Docs</FooterLink>
          <FooterLink href="/developers/pricing">Pricing</FooterLink>
          <FooterLink href="/developers/keys">Dashboard</FooterLink>
        </FooterColumn>

        <FooterColumn label="Integrations">
          <FooterLink href="/developers/docs/integrations/claude-mcp">
            Claude Desktop
          </FooterLink>
          <FooterLink href="/developers/docs/integrations/chatgpt-apps">
            ChatGPT Apps
          </FooterLink>
          <FooterLink href="/developers/docs/api/v1">REST API</FooterLink>
        </FooterColumn>

        <FooterColumn label="Company">
          <FooterLink href="/" external={false}>
            Consumer app
          </FooterLink>
          <FooterLink
            href="https://github.com/kakarottoooo/onegent"
            external
          >
            GitHub
          </FooterLink>
          <FooterLink href="mailto:beta@onegent.one" external>
            beta@onegent.one
          </FooterLink>
        </FooterColumn>
      </div>

      <div
        style={{
          maxWidth: "var(--container)",
          margin: "var(--space-12) auto 0",
          paddingTop: "var(--space-8)",
          borderTop: "1px solid var(--ink-200)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <span className="dev-body-sm" style={{ color: "var(--ink-400)" }}>
          © {new Date().getFullYear()} Onegent. Private beta — invite only.
        </span>
        <span
          className="dev-mono-sm"
          style={{ color: "var(--ink-400)" }}
        >
          v1
        </span>
      </div>
    </footer>
  );
}

function FooterColumn({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="dev-eyebrow" style={{ marginBottom: "var(--space-4)" }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {children}
      </div>
    </div>
  );
}

function FooterLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="dev-body-sm"
        style={{ color: "var(--ink-700)", textDecoration: "none" }}
      >
        {children}
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="dev-body-sm"
      style={{ color: "var(--ink-700)", textDecoration: "none" }}
    >
      {children}
    </Link>
  );
}
