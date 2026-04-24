import Link from "next/link";

import "../_styles/docs.css";
import "../_styles/docs-hub.css";

export const metadata = {
  title: "Docs",
  description: "REST API reference, Claude Desktop integration, ChatGPT Apps integration.",
};

interface DocCard {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
  glyph: React.ReactNode;
}

const DOCS: DocCard[] = [
  {
    href: "/developers/docs/api/v1",
    eyebrow: "REST",
    title: "API Reference",
    description:
      "Every endpoint under /api/v1, with schemas, error codes, the job lifecycle diagram, and full curl quickstart.",
    meta: "~12 min",
    glyph: <ApiGlyph />,
  },
  {
    href: "/developers/docs/integrations/claude-mcp",
    eyebrow: "MCP · stdio",
    title: "Claude Desktop",
    description:
      "Install the @onegent/mcp-server in claude_desktop_config.json. First booking walkthrough, status timeline, payment-safety primer.",
    meta: "~6 min",
    glyph: <ClaudeGlyph />,
  },
  {
    href: "/developers/docs/integrations/chatgpt-apps",
    eyebrow: "MCP · streamable HTTP",
    title: "ChatGPT Apps",
    description:
      "Two paths: the Apps SDK preview (recommended long-term) and the Custom GPT Action with inline OpenAPI spec for immediate use.",
    meta: "~8 min",
    glyph: <ChatGptGlyph />,
  },
];

export default function DocsHubPage() {
  return (
    <section className="dev-section">
      <div className="dev-container-narrow">
        <header className="dev-section-header">
          <span className="dev-eyebrow dev-section-header__eyebrow">
            Documentation
          </span>
          <h1 className="dev-h1">Three doors into Onegent.</h1>
          <p className="dev-lead">
            Same engine, three integration surfaces. Pick the one that
            fits how your agent already talks to the world.
          </p>
        </header>

        <div className="dev-doc-cards">
          {DOCS.map((d) => (
            <Link key={d.href} href={d.href} className="dev-doc-card">
              <div className="dev-doc-card-glyph">{d.glyph}</div>
              <div className="dev-doc-card-body">
                <span className="dev-eyebrow">{d.eyebrow}</span>
                <h3 className="dev-doc-card-title">{d.title}</h3>
                <p className="dev-doc-card-desc">{d.description}</p>
              </div>
              <div className="dev-doc-card-foot">
                <span>{d.meta}</span>
                <span aria-hidden="true">→</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ApiGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3" />
      <path d="M15 5c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3" />
    </svg>
  );
}

function ClaudeGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16v10H12l-4 3v-3H4z" />
    </svg>
  );
}

function ChatGptGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9.5c0-1.5 1-2.5 3-2.5s3 1 3 2.5-1 2-2 2.5-1 1-1 2v0.5" />
      <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
    </svg>
  );
}
