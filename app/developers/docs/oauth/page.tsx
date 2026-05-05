import { readFile } from "node:fs/promises";
import path from "node:path";

import Link from "next/link";

import { MdxContent } from "../../_components/MdxContent";

import "../../_styles/docs.css";

export const metadata = {
  title: "OAuth 2.0 integration",
  description:
    "Onegent OAuth 2.0 integration guide for third-party agent builders — discovery, DCR, authorization code + PKCE, token exchange, refresh, revoke, scopes, and worked code samples.",
};

async function loadDoc(): Promise<string> {
  const filePath = path.join(process.cwd(), "docs", "60-api-integrations", "oauth.md");
  return readFile(filePath, "utf8");
}

export default async function OAuthDocPage() {
  const source = await loadDoc();

  return (
    <div className="dev-doc-shell">
      <div className="dev-doc-grid">
        <aside className="dev-doc-toc" aria-label="On this page">
          <div className="dev-doc-toc-label">On this page</div>
          <a href="#quick-reference">Quick reference</a>
          <a href="#prerequisites">Prerequisites</a>
          <a href="#end-to-end-overview">Overview</a>
          <a href="#1-discovery">1. Discovery</a>
          <a href="#2-register-a-client">2. Register a client</a>
          <a href="#3-authorization-code--pkce">3. Authorize</a>
          <a href="#4-exchange-the-code-for-tokens">4. Exchange code</a>
          <a href="#5-call-apimcp">5. Call /api/mcp</a>
          <a href="#6-refresh-tokens">6. Refresh</a>
          <a href="#7-revoke-a-token">7. Revoke</a>
          <a href="#8-scopes">8. Scopes</a>
          <a href="#9-working-code-samples">9. Code samples</a>
          <a href="#10-common-errors">10. Errors</a>
          <a href="#11-going-further">11. Going further</a>
        </aside>

        <main className="dev-doc-prose">
          <div className="dev-doc-breadcrumb">
            <Link href="/developers/docs">Docs</Link>
            <span className="dev-doc-breadcrumb-sep">/</span>
            <span>OAuth 2.0 integration</span>
          </div>
          <MdxContent source={source} />
        </main>
      </div>
    </div>
  );
}
