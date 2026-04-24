import { readFile } from "node:fs/promises";
import path from "node:path";

import Link from "next/link";

import { MdxContent } from "../../../_components/MdxContent";

import "../../../_styles/docs.css";

export const metadata = {
  title: "API Reference",
  description: "Onegent /api/v1 REST reference — endpoints, schemas, error codes, lifecycle.",
};

async function loadDoc(): Promise<string> {
  const filePath = path.join(process.cwd(), "docs", "api", "v1.md");
  return readFile(filePath, "utf8");
}

export default async function ApiV1DocPage() {
  const source = await loadDoc();

  return (
    <div className="dev-doc-shell">
      <div className="dev-doc-grid">
        <aside className="dev-doc-toc" aria-label="On this page">
          <div className="dev-doc-toc-label">On this page</div>
          {/* TOC is markdown-static for now — JS-driven scroll-spy is
              a follow-up; the heading IDs are linkable today. */}
          <a href="#authentication">Authentication</a>
          <a href="#endpoints">Endpoints</a>
          <a href="#scenarios">Scenarios</a>
          <a href="#errors">Errors</a>
          <a href="#lifecycle">Job lifecycle</a>
          <a href="#quickstart">curl quickstart</a>
        </aside>

        <main className="dev-doc-prose">
          <div className="dev-doc-breadcrumb">
            <Link href="/developers/docs">Docs</Link>
            <span className="dev-doc-breadcrumb-sep">/</span>
            <span>API Reference</span>
          </div>
          <MdxContent source={source} />
        </main>
      </div>
    </div>
  );
}
