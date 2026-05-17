# Onegent

**Live:** [onegent.one](https://onegent.one/)

An autonomous decision agent that closes the entire loop — search, compare, filter, recommend, execute, observe, and learn — across travel, dining, commerce, and event booking. The user approves; the agent does everything else.

Built solo over 12+ months. 1,000+ commits. Production deployment on Vercel.

---

## What It Does

Most "AI agents" stop at recommendation. Onegent goes one step further: once a plan is approved, it autonomously drives real booking platforms (Booking.com, OpenTable, Resy, Expedia, Hotels.com, and others) to completion — pausing only at the payment step so the user retains control of their credit card.

### Planning Layer

Natural-language input is translated into structured plans across eight domains:

| Domain | Capabilities |
|--------|--------------|
| **Restaurants** | Dates, business dinners, dietary constraints, time windows |
| **Hotels** | Business travel, weekend trips, honeymoons, family stays |
| **Flights** | Lowest fare, red-eye avoidance, time filters |
| **Credit Cards** | Portfolio gap analysis, sign-up bonus ranking |
| **Electronics** | Laptops, phones, headphones with comparison logic |
| **Event Tickets** | Real Ticketmaster inventory |
| **Gifts** | Three-tier suggestions via Google Shopping |
| **Fitness** | 12 activity types across ClassPass / Mindbody |

### Autopilot Execution

After approval, Onegent executes the booking end-to-end:

- **Hotels:** full flow on Booking.com / Expedia / Hotels.com — search, room selection, form fill, pause at payment
- **Restaurants:** waterfall fallback chain — OpenTable → Resy → Yelp → official restaurant site
- Autonomous recovery on failure: time-slot fallback, venue substitution, retry with backoff
- Live browser streaming to the user (SSE screenshot feed at ~6 fps)
- Web Push notification on completion

### Decision Room (Group Decisions)

Two users submit independent constraints → AI merges conflicts → real-time voting → mutual confirmation locks the booking.

### Continuous Learning

Three-tier feedback loop (live cards / 24-hour post-action / session-level preference extraction) → preferences persisted and synced across devices → ranking weights auto-adjusted over time.

---

## Architecture

```
 ┌────────────────────────────────────────────────────────────┐
 │  Next.js 14 App Router  (Vercel)                           │
 │  - Task/session UI    - Decision Room    - Live SSE stream │
 └───────────────┬────────────────────────────────────────────┘
                 │
 ┌───────────────▼────────────────────────────────────────────┐
 │  Planning Layer                                            │
 │  - NLU (MiniMax)  - Domain routers  - Plan generation      │
 │  - Google Places · SerpAPI · Tavily · Ticketmaster         │
 └───────────────┬────────────────────────────────────────────┘
                 │ approved plan
 ┌───────────────▼────────────────────────────────────────────┐
 │  Execution Layer  (long-running Railway workers)           │
 │  - BrowserProvider interface (6 platform providers)        │
 │  - Stagehand + GPT-4o-mini (AI perception)                 │
 │  - Playwright (deterministic RPA fallback)                 │
 │  - Claude Haiku (visual confirmation)                      │
 │  - Audit-trail logging  - Retry / dead-letter / handoff    │
 └───────────────┬────────────────────────────────────────────┘
                 │
 ┌───────────────▼────────────────────────────────────────────┐
 │  Postgres (Neon)  · Clerk auth  · Web Push (VAPID)         │
 └────────────────────────────────────────────────────────────┘
```

Exposed as both a consumer-facing PWA and a **REST API + MCP server**, so external AI agents can trigger real-world booking execution programmatically.

---

## Engineering Challenges Solved

These are the problems that turned out to actually matter — the things you don't see in the demo but decide whether the agent works in production:

**1. AI-first with deterministic fallback.**
Pure AI-driven browser automation (Stagehand alone) fails on edge-case DOMs, anti-bot defenses, and pages that re-render mid-interaction. Pure deterministic scripts (Playwright alone) break the moment a vendor changes their HTML. Onegent uses a hybrid: Stagehand drives open-ended steps (search, filter, navigate), and hand-written Playwright takes over at the steps where a single wrong click costs the user a real reservation. The handoff between the two is the hard part.

**2. Multi-provider waterfall with health signals.**
For restaurants: OpenTable → Resy → Yelp → official site. For hotels: Booking → Expedia → Hotels.com. Each provider has its own failure modes (login walls, captchas, time-slot unavailability, geo-blocks). The orchestrator tracks per-provider success rate and routes new jobs toward currently-healthy providers, not just the cheapest.

**3. Payment-safety handoff.**
The agent completes every step *up to* the final CVV submission, then pauses and hands control to the user. Credit card data never enters the automation surface. This was the design boundary that made the product trustworthy enough to deploy.

**4. Long-running job orchestration.**
A booking flow can take 30 seconds or 5 minutes depending on provider latency and retries. Long-running Railway workers, Postgres-backed execution state, and SSE streaming back to the browser were chosen over the simpler serverless function model because real bookings outlive any reasonable request timeout.

**5. Continuous learning without bloating context.**
Three-tier feedback (immediate / 24-hour / session) compresses raw user signals into a small preference vector that fits in the agent's context budget on the next run. Naively concatenating feedback into the prompt would blow past the token limit within a week of use.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 14 (App Router) · TypeScript · Tailwind | Server components for SSE streaming, native PWA support |
| AI — language | MiniMax (NLU, ranking, review parsing) | Cost-efficient on Chinese + English mixed input |
| AI — vision | Claude Haiku | Visual confirmation of booking pages |
| AI — browser | Stagehand + GPT-4o-mini | Open-ended page interaction with self-healing selectors |
| Automation — fallback | Playwright | Deterministic execution where AI is too unreliable |
| Discovery APIs | Google Places · SerpAPI · Tavily · Ticketmaster | Real-time inventory across domains |
| Storage | Neon Postgres · localStorage | Execution state + per-device preference cache |
| Auth | Clerk | OAuth, magic link, session management out of the box |
| Push | Web Push (VAPID) · PWA | Native-feeling notifications without an app store |
| Workers | Railway long-running workers | Bookings outlive serverless function timeouts |
| Deploy | Vercel | Edge SSR, instant rollback |

---

## Local Development

```bash
npm install
cp .env.local.example .env.local   # fill in API keys
npm run dev
```

**Required environment variables:**
`ANTHROPIC_API_KEY` · `POSTGRES_URL` · `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` · `CLERK_SECRET_KEY` · `GOOGLE_PLACES_API_KEY`

Full environment variable list: [`docs/00-start-here/PROJECT_SUMMARY.md`](./docs/00-start-here/PROJECT_SUMMARY.md)

---

## Documentation

Detailed architecture, execution flows, database schema, and version history:

- [docs/INDEX.md](./docs/INDEX.md) — full doc index
- [docs/00-start-here/PROJECT_SUMMARY.md](./docs/00-start-here/PROJECT_SUMMARY.md) — system summary
- [docs/00-start-here/PHASE_STATUS.md](./docs/00-start-here/PHASE_STATUS.md) — current phase
- [docs/10-coordination/README.md](./docs/10-coordination/README.md) — coordination notes

Some internal docs are written in Chinese for development velocity. The system, code, and public-facing surface are in English.

---

## Status

Live deployment with active iteration. Core flows (restaurant + hotel booking) are demo-stable; payment-safety handoff is the boundary the product is designed around. Built and operated solo as a learning vehicle for production agent systems.

Contact: see [my GitHub profile](https://github.com/kakarottoooo) or [ziweiguo.com](https://www.ziweiguo.com).
