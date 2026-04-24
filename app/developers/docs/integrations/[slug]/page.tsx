import { readFile } from "node:fs/promises";
import path from "node:path";

import Link from "next/link";
import { notFound } from "next/navigation";

import { MdxContent } from "../../../_components/MdxContent";

import "../../../_styles/docs.css";

const ALLOWED_SLUGS = ["claude-mcp", "chatgpt-apps"] as const;
type AllowedSlug = (typeof ALLOWED_SLUGS)[number];

const META: Record<AllowedSlug, { title: string; description: string; eyebrow: string }> = {
  "claude-mcp": {
    title: "Claude Desktop",
    description: "Install Onegent's MCP server in Claude Desktop and book your first reservation.",
    eyebrow: "MCP · stdio",
  },
  "chatgpt-apps": {
    title: "ChatGPT Apps",
    description: "Two paths: Apps SDK preview (recommended long-term) and Custom GPT Action.",
    eyebrow: "MCP · streamable HTTP",
  },
};

export async function generateStaticParams() {
  return ALLOWED_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isAllowed(slug)) return {};
  const m = META[slug];
  return { title: m.title, description: m.description };
}

function isAllowed(slug: string): slug is AllowedSlug {
  return (ALLOWED_SLUGS as readonly string[]).includes(slug);
}

async function loadDoc(slug: AllowedSlug): Promise<string> {
  const filePath = path.join(process.cwd(), "docs", "integrations", `${slug}.md`);
  return readFile(filePath, "utf8");
}

export default async function IntegrationDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isAllowed(slug)) notFound();

  const source = await loadDoc(slug);
  const meta = META[slug];

  return (
    <div className="dev-doc-shell">
      <div className="dev-doc-grid">
        <aside className="dev-doc-toc" aria-label="On this page">
          <div className="dev-doc-toc-label">On this page</div>
          <a href="#prerequisites">Prerequisites</a>
          <a href="#install">Install</a>
          <a href="#verify">Verify</a>
          <a href="#first-booking">First booking</a>
          <a href="#troubleshooting">Troubleshooting</a>
        </aside>

        <main className="dev-doc-prose">
          <div className="dev-doc-breadcrumb">
            <Link href="/developers/docs">Docs</Link>
            <span className="dev-doc-breadcrumb-sep">/</span>
            <span>{meta.eyebrow}</span>
            <span className="dev-doc-breadcrumb-sep">/</span>
            <span>{meta.title}</span>
          </div>
          <MdxContent source={source} />
        </main>
      </div>
    </div>
  );
}
