"use client";

import { useState } from "react";

/**
 * Live code preview card — three tabs (curl / Claude Desktop / TypeScript)
 * with clip-path wipe-in animation per tab change. Each snippet is
 * pre-tokenized as JSX with .tok-* color spans so syntax highlighting
 * works without pulling in a heavyweight highlighter dep (3 small
 * snippets don't justify shiki / prism).
 */
type TabId = "curl" | "claude" | "typescript";

interface Tab {
  id: TabId;
  label: string;
  caption: string;
  raw: string;
  jsx: React.ReactNode;
}

const CURL_RAW = `curl -X POST https://onegent.one/api/v1/execution-jobs \\
  -H "Authorization: Bearer ogk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "request": {
      "scenario": "restaurant",
      "params": {
        "restaurant_name": "Carbone",
        "city": "New York",
        "date": "2026-04-28",
        "time": "19:00",
        "covers": 2
      }
    },
    "profile": {
      "first_name": "Alice",
      "last_name":  "Example",
      "email":      "alice@example.com",
      "phone":      "+14155550123"
    }
  }'`;

const CLAUDE_RAW = `// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "onegent": {
      "command": "npx",
      "args": ["-y", "@onegent/mcp-server"],
      "env": {
        "ONEGENT_API_KEY": "ogk_live_..."
      }
    }
  }
}

// Then in Claude:
//   "Book Carbone in NYC tomorrow 7pm for 2."
// Claude calls book_restaurant → polls get_job_status → relays
// the confirmation code back to you.`;

const TS_RAW = `import "dotenv/config";

const res = await fetch("https://onegent.one/api/v1/execution-jobs", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.ONEGENT_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    request: {
      scenario: "hotel",
      params: {
        destination: "Paris",
        check_in:    "2026-05-12",
        check_out:   "2026-05-14",
        guests: 2,
      },
    },
    profileId: 42,
  }),
});

const { jobId, status } = await res.json();
console.log(\`booking job \${jobId} \${status}\`);`;

const TABS: Tab[] = [
  {
    id: "curl",
    label: "curl",
    caption: "REST · POST /api/v1/execution-jobs",
    raw: CURL_RAW,
    jsx: <CurlSnippet />,
  },
  {
    id: "claude",
    label: "Claude Desktop",
    caption: "MCP · stdio transport",
    raw: CLAUDE_RAW,
    jsx: <ClaudeSnippet />,
  },
  {
    id: "typescript",
    label: "TypeScript",
    caption: "Node 18+ · global fetch",
    raw: TS_RAW,
    jsx: <TsSnippet />,
  },
];

export function CodePreview() {
  const [activeId, setActiveId] = useState<TabId>("curl");
  const [copied, setCopied] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);

  const active = TABS.find((t) => t.id === activeId)!;

  const handleTabChange = (id: TabId) => {
    if (id === activeId) return;
    setActiveId(id);
    setAnimationKey((k) => k + 1);
    setCopied(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(active.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard refused — ignore silently, user can manually select
    }
  };

  return (
    <div className="dev-code-preview" role="region" aria-label="Code preview">
      <div className="dev-code-preview-chrome">
        <div className="dev-code-preview-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="dev-code-preview-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              data-active={tab.id === activeId}
              onClick={() => handleTabChange(tab.id)}
              className="dev-code-tab"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="dev-code-preview-copy"
          data-copied={copied}
          aria-label="Copy code"
        >
          {copied ? <CheckGlyph /> : <CopyGlyph />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      <div className="dev-code-preview-body">
        <pre key={animationKey} className="dev-code-preview-pane">
          {active.jsx}
        </pre>
      </div>

      <div className="dev-code-preview-foot">
        <span>{active.caption}</span>
        <span>{active.raw.split("\n").length} lines</span>
      </div>
    </div>
  );
}

// ─── Tokenized snippets ────────────────────────────────────────────────────
// Hand-tokenized as JSX so we don't need a syntax highlighter dependency.
// Each snippet stays under 30 lines — if any grows large, swap for shiki.

function CurlSnippet() {
  return (
    <>
      <span className="tok-fn">curl</span> <span className="tok-keyword">-X POST</span>{" "}
      <span className="tok-url">https://onegent.one/api/v1/execution-jobs</span>{" "}
      <span className="tok-punct">{"\\"}</span>
      {"\n  "}
      <span className="tok-keyword">-H</span>{" "}
      <span className="tok-string">{`"Authorization: Bearer ogk_live_..."`}</span>{" "}
      <span className="tok-punct">{"\\"}</span>
      {"\n  "}
      <span className="tok-keyword">-H</span>{" "}
      <span className="tok-string">{`"Content-Type: application/json"`}</span>{" "}
      <span className="tok-punct">{"\\"}</span>
      {"\n  "}
      <span className="tok-keyword">-d</span> <span className="tok-string">{`'{`}</span>
      {"\n    "}
      <span className="tok-string">{`"request": {`}</span>
      {"\n      "}
      <span className="tok-prop">{`"scenario"`}</span>: <span className="tok-string">{`"restaurant"`}</span>,
      {"\n      "}
      <span className="tok-prop">{`"params"`}</span>: {"{"}
      {"\n        "}
      <span className="tok-prop">{`"restaurant_name"`}</span>:{" "}
      <span className="tok-string">{`"Carbone"`}</span>,
      {"\n        "}
      <span className="tok-prop">{`"city"`}</span>: <span className="tok-string">{`"New York"`}</span>,
      {"\n        "}
      <span className="tok-prop">{`"date"`}</span>: <span className="tok-string">{`"2026-04-28"`}</span>,
      {"\n        "}
      <span className="tok-prop">{`"time"`}</span>: <span className="tok-string">{`"19:00"`}</span>,
      {"\n        "}
      <span className="tok-prop">{`"covers"`}</span>: <span className="tok-number">2</span>
      {"\n      }"}
      {"\n    },"}
      {"\n    "}
      <span className="tok-prop">{`"profile"`}</span>: {"{"}
      {"\n      "}
      <span className="tok-prop">{`"first_name"`}</span>: <span className="tok-string">{`"Alice"`}</span>,
      {"\n      "}
      <span className="tok-prop">{`"last_name"`}</span>:{"  "}
      <span className="tok-string">{`"Example"`}</span>,
      {"\n      "}
      <span className="tok-prop">{`"email"`}</span>:{"      "}
      <span className="tok-string">{`"alice@example.com"`}</span>,
      {"\n      "}
      <span className="tok-prop">{`"phone"`}</span>:{"      "}
      <span className="tok-string">{`"+14155550123"`}</span>
      {"\n    }"}
      {"\n  "}
      <span className="tok-string">{`}'`}</span>
    </>
  );
}

function ClaudeSnippet() {
  return (
    <>
      <span className="tok-comment">{`// ~/Library/Application Support/Claude/claude_desktop_config.json`}</span>
      {"\n"}
      {"{\n  "}
      <span className="tok-prop">{`"mcpServers"`}</span>: {"{"}
      {"\n    "}
      <span className="tok-prop">{`"onegent"`}</span>: {"{"}
      {"\n      "}
      <span className="tok-prop">{`"command"`}</span>: <span className="tok-string">{`"npx"`}</span>,
      {"\n      "}
      <span className="tok-prop">{`"args"`}</span>: [<span className="tok-string">{`"-y"`}</span>,{" "}
      <span className="tok-string">{`"@onegent/mcp-server"`}</span>],
      {"\n      "}
      <span className="tok-prop">{`"env"`}</span>: {"{"}
      {"\n        "}
      <span className="tok-prop">{`"ONEGENT_API_KEY"`}</span>:{" "}
      <span className="tok-string">{`"ogk_live_..."`}</span>
      {"\n      }"}
      {"\n    }"}
      {"\n  }"}
      {"\n}"}
      {"\n\n"}
      <span className="tok-comment">{`// Then in Claude:`}</span>
      {"\n"}
      <span className="tok-comment">{`//   "Book Carbone in NYC tomorrow 7pm for 2."`}</span>
      {"\n"}
      <span className="tok-comment">{`// Claude calls book_restaurant → polls get_job_status → relays`}</span>
      {"\n"}
      <span className="tok-comment">{`// the confirmation code back to you.`}</span>
    </>
  );
}

function TsSnippet() {
  return (
    <>
      <span className="tok-keyword">import</span>{" "}
      <span className="tok-string">{`"dotenv/config"`}</span>;
      {"\n\n"}
      <span className="tok-keyword">const</span> res = <span className="tok-keyword">await</span>{" "}
      <span className="tok-fn">fetch</span>(
      <span className="tok-string">{`"https://onegent.one/api/v1/execution-jobs"`}</span>, {"{"}
      {"\n  "}
      <span className="tok-prop">method</span>: <span className="tok-string">{`"POST"`}</span>,
      {"\n  "}
      <span className="tok-prop">headers</span>: {"{"}
      {"\n    "}
      <span className="tok-prop">Authorization</span>:{" "}
      <span className="tok-string">{"`Bearer ${"}</span>
      <span className="tok-meta">process.env.ONEGENT_API_KEY</span>
      <span className="tok-string">{"`"}</span>,
      {"\n    "}
      <span className="tok-string">{`"Content-Type"`}</span>:{" "}
      <span className="tok-string">{`"application/json"`}</span>,
      {"\n  },"}
      {"\n  "}
      <span className="tok-prop">body</span>: <span className="tok-meta">JSON</span>.
      <span className="tok-fn">stringify</span>({"{"}
      {"\n    "}
      <span className="tok-prop">request</span>: {"{"}
      {"\n      "}
      <span className="tok-prop">scenario</span>:{" "}
      <span className="tok-string">{`"hotel"`}</span>,
      {"\n      "}
      <span className="tok-prop">params</span>: {"{"}
      {"\n        "}
      <span className="tok-prop">destination</span>:{" "}
      <span className="tok-string">{`"Paris"`}</span>,
      {"\n        "}
      <span className="tok-prop">check_in</span>:{"    "}
      <span className="tok-string">{`"2026-05-12"`}</span>,
      {"\n        "}
      <span className="tok-prop">check_out</span>:{"   "}
      <span className="tok-string">{`"2026-05-14"`}</span>,
      {"\n        "}
      <span className="tok-prop">guests</span>: <span className="tok-number">2</span>,
      {"\n      },"}
      {"\n    },"}
      {"\n    "}
      <span className="tok-prop">profileId</span>: <span className="tok-number">42</span>,
      {"\n  }),"}
      {"\n});"}
      {"\n\n"}
      <span className="tok-keyword">const</span> {"{ jobId, status }"} ={" "}
      <span className="tok-keyword">await</span> res.<span className="tok-fn">json</span>();
      {"\n"}
      <span className="tok-meta">console</span>.<span className="tok-fn">log</span>(
      <span className="tok-string">{"`booking job ${jobId} ${status}`"}</span>);
    </>
  );
}

function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}
