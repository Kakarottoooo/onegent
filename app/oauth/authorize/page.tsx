/**
 * OAuth 2.0 authorization endpoint (RFC 6749 §4.1).
 *
 * MCP clients (ChatGPT Apps, Claude.ai web) redirect users here with
 * ?client_id=...&redirect_uri=...&scope=...&state=...&code_challenge=...
 * &code_challenge_method=S256&response_type=code
 *
 * We:
 *   1. Validate every parameter against the registered oauth_client row.
 *   2. Require Clerk sign-in (modal gate, returns to this URL).
 *   3. Render a branded consent screen showing the requesting client's
 *      name and per-scope explanations.
 *   4. Approve / Deny submit to /oauth/authorize/decide which mints the
 *      authorization code and redirects back to redirect_uri.
 *
 * PKCE is mandatory — we accept S256 only (declared in /.well-known/
 * oauth-authorization-server). No code without a code_challenge.
 */

import { auth, currentUser } from "@clerk/nextjs/server";

import { getOAuthClient } from "@/lib/db";

import { SignInGate } from "./_components/SignInGate";
import "./oauth.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPE_DESCRIPTIONS: Record<string, { title: string; body: string }> = {
  book: {
    title: "Start booking jobs on your behalf",
    body: "Reserve restaurants, book hotels, purchase flight tickets, and buy activity tickets through Onegent's automation. The agent always pauses before submitting your CVV — you confirm every charge.",
  },
  read: {
    title: "View status and audit trails",
    body: "Read the status, step-by-step trace, and final receipts of any booking job created on your behalf. No personal data beyond what you booked.",
  },
};

interface AuthorizeQuery {
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function buildReturnUrl(q: AuthorizeQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (typeof v === "string" && v.length) params.set(k, v);
  }
  return `/oauth/authorize?${params.toString()}`;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const q: AuthorizeQuery = {
    client_id: asString(raw.client_id),
    redirect_uri: asString(raw.redirect_uri),
    scope: asString(raw.scope),
    state: asString(raw.state),
    response_type: asString(raw.response_type),
    code_challenge: asString(raw.code_challenge),
    code_challenge_method: asString(raw.code_challenge_method),
  };

  // ── Parameter validation (no redirect on these — we don't trust the
  // redirect_uri until we've matched it against the client row, otherwise
  // we'd be an open redirect)
  if (!q.client_id) return <ErrorScreen title="Missing client_id" body="The request is missing client_id." />;
  if (!q.redirect_uri) return <ErrorScreen title="Missing redirect_uri" body="The request is missing redirect_uri." />;
  if (q.response_type !== "code")
    return <ErrorScreen title="Unsupported response_type" body="Only response_type=code is supported." />;
  if (!q.code_challenge)
    return <ErrorScreen title="PKCE required" body="This server requires PKCE — code_challenge must be supplied." />;
  if (q.code_challenge_method !== "S256")
    return <ErrorScreen title="Unsupported PKCE method" body="Only code_challenge_method=S256 is accepted." />;

  const client = await getOAuthClient(q.client_id);
  if (!client)
    return (
      <ErrorScreen
        title="Unknown client"
        body={`No OAuth client registered with id "${q.client_id}". Contact the integration owner.`}
      />
    );

  if (!client.redirect_uris.includes(q.redirect_uri))
    return (
      <ErrorScreen
        title="redirect_uri mismatch"
        body="The redirect_uri does not match any URI registered for this client. Onegent refuses to redirect to unregistered URIs to prevent token theft."
      />
    );

  const requestedScopes = (q.scope ?? "")
    .split(/[\s+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (requestedScopes.length === 0)
    return <ErrorScreen title="Missing scope" body="At least one scope must be requested." />;

  const badScopes = requestedScopes.filter((s) => !client.allowed_scopes.includes(s));
  if (badScopes.length)
    return (
      <ErrorScreen
        title="Scope not allowed"
        body={`The client is not allowed to request: ${badScopes.join(", ")}. Allowed scopes for this client: ${client.allowed_scopes.join(", ")}.`}
      />
    );

  // ── Clerk gate
  const { userId } = await auth();
  const returnUrl = buildReturnUrl(q);

  if (!userId) {
    return (
      <ConsentShell>
        <ConsentHeader clientName={client.name} eyebrow="Sign in to authorize" />
        <p className="oauth-prose">
          <strong>{client.name}</strong> wants to connect to your Onegent
          account. Sign in to review what it&rsquo;s asking for and decide
          whether to approve.
        </p>
        <div className="oauth-actions">
          <SignInGate returnUrl={returnUrl} />
        </div>
        <ConsentFooter />
      </ConsentShell>
    );
  }

  const user = await currentUser();
  const userEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "your Onegent account";

  return (
    <ConsentShell>
      <ConsentHeader clientName={client.name} eyebrow="Authorize access" />

      <div className="oauth-account">
        <div className="oauth-account__avatar" aria-hidden="true">
          {(user?.firstName?.[0] ?? userEmail[0] ?? "O").toUpperCase()}
        </div>
        <div className="oauth-account__meta">
          <span className="oauth-account__label">Signed in as</span>
          <span className="oauth-account__email">{userEmail}</span>
        </div>
      </div>

      <p className="oauth-prose">
        <strong>{client.name}</strong> is requesting permission to act on
        your behalf. Granting access lets it use the capabilities listed
        below until you revoke them.
      </p>

      <ul className="oauth-scopes">
        {requestedScopes.map((scope) => {
          const meta = SCOPE_DESCRIPTIONS[scope];
          return (
            <li key={scope} className="oauth-scope">
              <div className="oauth-scope__check" aria-hidden="true">✓</div>
              <div className="oauth-scope__body">
                <span className="oauth-scope__title">
                  {meta?.title ?? scope}
                </span>
                {meta?.body && <span className="oauth-scope__desc">{meta.body}</span>}
                <code className="oauth-scope__code">{scope}</code>
              </div>
            </li>
          );
        })}
      </ul>

      <form action="/oauth/authorize/decide" method="POST" className="oauth-actions">
        <input type="hidden" name="client_id" value={q.client_id} />
        <input type="hidden" name="redirect_uri" value={q.redirect_uri} />
        <input type="hidden" name="scope" value={requestedScopes.join(" ")} />
        <input type="hidden" name="state" value={q.state ?? ""} />
        <input type="hidden" name="code_challenge" value={q.code_challenge} />
        <input
          type="hidden"
          name="code_challenge_method"
          value={q.code_challenge_method}
        />
        <button
          type="submit"
          name="decision"
          value="deny"
          className="oauth-cta oauth-cta--ghost"
          formNoValidate
        >
          Deny
        </button>
        <button
          type="submit"
          name="decision"
          value="approve"
          className="oauth-cta oauth-cta--primary"
        >
          Approve {client.name}
        </button>
      </form>

      <ConsentFooter />
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="oauth-page">
      <div className="oauth-card">
        <BrandMark />
        {children}
      </div>
    </div>
  );
}

function ConsentHeader({ clientName, eyebrow }: { clientName: string; eyebrow: string }) {
  return (
    <div className="oauth-header">
      <span className="oauth-eyebrow">{eyebrow}</span>
      <h1 className="oauth-title">
        Allow <span className="oauth-title__client">{clientName}</span>
        <br />
        to use your Onegent account?
      </h1>
    </div>
  );
}

function ConsentFooter() {
  return (
    <p className="oauth-fineprint">
      You can revoke access any time from your{" "}
      <a href="/developers/keys">developer dashboard</a>. Onegent never
      shares your booking history with the client beyond the jobs created
      under this authorization.
    </p>
  );
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <ConsentShell>
      <div className="oauth-header">
        <span className="oauth-eyebrow oauth-eyebrow--danger">Cannot authorize</span>
        <h1 className="oauth-title">{title}</h1>
      </div>
      <p className="oauth-prose">{body}</p>
      <ConsentFooter />
    </ConsentShell>
  );
}

/**
 * Inline brand mark — same geometry as app/icon.tsx (cream ring + horizon
 * on deep ink navy) but rendered as static SVG so it lives inside the
 * consent card without the OG image roundtrip.
 */
function BrandMark() {
  return (
    <div className="oauth-brand" aria-label="Onegent">
      <svg viewBox="0 0 64 64" className="oauth-brand__mark" aria-hidden="true">
        <defs>
          <linearGradient id="oauthBrandBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0a0e1a" />
            <stop offset="100%" stopColor="#1a2238" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="url(#oauthBrandBg)" />
        <circle cx="32" cy="32" r="20" stroke="#f5e6c8" strokeWidth="2.5" fill="none" />
        <line x1="6" y1="32" x2="58" y2="32" stroke="#f5e6c8" strokeWidth="2.5" />
      </svg>
      <span className="oauth-brand__wordmark">Onegent</span>
    </div>
  );
}
