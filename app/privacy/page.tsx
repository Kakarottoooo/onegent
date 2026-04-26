export const metadata = {
  title: "Privacy Policy",
  description: "How Onegent collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 prose prose-invert">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-gray-400">
        Effective: 2026-04-26 · Last updated: 2026-04-26
      </p>

      <section>
        <h2>1. Introduction</h2>
        <p>
          <strong>
            Onegent collects only the data needed to operate AI-powered booking
            automation safely and transparently.
          </strong>{" "}
          Onegent is the travel execution layer for AI agents and groups. Users
          tell Onegent what to book, such as restaurants, hotels, flights,
          activities, and multi-person trips, and our AI agent helps search,
          compare, and prepare bookings through real booking sites. This Privacy
          Policy explains what information we collect, how we use it, who we
          share it with, how long we keep it, and what rights you have.
        </p>
        <p>
          Onegent is currently in private beta, is pre-revenue, and has no paid
          tier. This policy applies to onegent.one, the Onegent web app, our REST
          API, the hosted MCP endpoint at /api/mcp, and the npm package
          @onegent/mcp-server when connected to Onegent services.
        </p>
      </section>

      <section>
        <h2>2. Information We Collect</h2>
        <p>
          <strong>
            We collect account, profile, booking, chat, telemetry, notification,
            and security data.
          </strong>{" "}
          The categories of information we collect include:
        </p>
        <ul>
          <li>
            <strong>Account data:</strong> email address, name, profile photo if
            provided, authentication identifiers, and session information through
            Clerk.
          </li>
          <li>
            <strong>Booking profiles:</strong> first and last name, email,
            phone number, billing address, card number, card expiry, passport
            details, date of birth, known traveler number, and driver&apos;s
            license information. Sensitive booking profile fields are encrypted
            at rest using AES-256-GCM.
          </li>
          <li>
            <strong>Booking job history:</strong> venues searched or booked,
            travel dates and times, providers used, booking status,
            success/failure results, and the agent decision trace used for audit
            and debugging.
          </li>
          <li>
            <strong>Chat history:</strong> user messages, AI replies, structured
            intent state, and conversational context needed to run the service.
          </li>
          <li>
            <strong>Telemetry:</strong> page views, click events, and feature
            usage. We do not use third-party ad trackers.
          </li>
          <li>
            <strong>Push notification data:</strong> browser push endpoint and
            cryptographic keys, only if you opt in.
          </li>
          <li>
            <strong>Device and IP data:</strong> server logs, IP address,
            request metadata, and security logs collected through Vercel,
            Railway, and related infrastructure.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. How We Use Information</h2>
        <p>
          <strong>
            We use your data to operate bookings, improve reliability, protect
            accounts, and comply with legal obligations.
          </strong>{" "}
          We use your information to authenticate your account, save your
          booking preferences, run AI booking jobs, prepare booking forms, show
          booking history, debug failures, prevent abuse, send optional push
          notifications, and improve product quality. We also use logs and
          telemetry to detect security issues, investigate system errors, and
          understand which beta features are working.
        </p>
        <p>
          Onegent&apos;s agent may use Anthropic Claude, OpenAI GPT, or Google
          Generative AI to reason about booking tasks, parse natural language,
          and extract structured booking intent. We aim to send only the task
          context needed for the model to perform the requested action and avoid
          sending unnecessary payment details.
        </p>
      </section>

      <section>
        <h2>4. AI Booking Automation and Payment Data</h2>
        <p>
          <strong>
            Onegent may prepare booking forms, but the user must approve the
            final charge.
          </strong>{" "}
          Onegent uses Playwright, Stagehand, and sometimes Browserbase to
          navigate booking sites such as OpenTable, Resy, Booking.com, Expedia,
          Hotels.com, Viator, Ticketmaster, SeatGeek, restaurant websites, hotel
          websites, and other providers discovered through Google Places or web
          search. The agent may fill saved profile and payment information into
          booking forms on your behalf.
        </p>
        <p>
          Onegent is designed to stop before submitting the credit card CVV or
          final paid confirmation. You must review and confirm the final charge.
          We are not a merchant of record for beta bookings. Charges are made by
          the venue, travel provider, ticketing provider, or other third-party
          booking site.
        </p>
      </section>

      <section>
        <h2>5. Third Parties We Use</h2>
        <p>
          <strong>
            We share information with service providers only as needed to run
            Onegent.
          </strong>{" "}
          Our infrastructure providers include Neon for managed Postgres
          database hosting in US-East, Vercel for web and API hosting,
          Railway for worker hosting in US-West, Clerk for authentication and
          sessions, and Browserbase for remote headless browser sessions when
          needed.
        </p>
        <p>
          Our AI providers include Anthropic as the primary reasoning model,
          OpenAI for secondary natural language understanding and extraction,
          and Google Generative AI as an optional backup model. When you opt in
          to push notifications, browser notification delivery may involve Apple,
          Google, or Mozilla push services under the web-push standard.
        </p>
        <p>
          We do not sell personal data. We do not use Google Analytics, Mixpanel,
          Segment, third-party ad trackers, or advertising SDKs.
        </p>
      </section>

      <section>
        <h2>6. Booking Provider Sites</h2>
        <p>
          <strong>
            Booking providers receive information only when needed to complete
            the booking flow you requested.
          </strong>{" "}
          When the agent navigates third-party booking sites, it may enter your
          name, contact details, preferences, and payment fields into provider
          forms to prepare a reservation or purchase. These providers have their
          own privacy policies, cancellation policies, payment rules, and data
          practices. You should review the final provider page before approving
          any booking or payment.
        </p>
      </section>

      <section>
        <h2>7. Data Retention</h2>
        <p>
          <strong>
            We keep data only for the period needed to provide the service,
            maintain records, and protect security.
          </strong>{" "}
          Booking profiles and booking jobs are retained until you delete them.
          Chat history is retained for 12 months unless you delete it earlier.
          Telemetry is retained for 90 days. Server logs, including Vercel and
          Railway logs, are retained for 30 days unless a longer period is
          needed for security, fraud prevention, legal compliance, or dispute
          resolution.
        </p>
      </section>

      <section>
        <h2>8. Your Choices and Rights</h2>
        <p>
          <strong>
            You can access, correct, export, delete, or withdraw consent for
            your data.
          </strong>{" "}
          You can view much of your data through /tasks, /profile, and /memory.
          You can correct profile and chat information inline where editing is
          available. You can delete booking profiles and chat sessions in the
          app. For a full export or full account deletion, email
          support@onegent.one. We aim to complete full account deletion requests
          within 30 days, unless we need to retain limited information for legal,
          security, or dispute-resolution reasons.
        </p>
        <p>
          You may opt out of telemetry, push notifications, and API key issuance
          individually where those controls are available. You may also contact
          us if you cannot find a control in the product.
        </p>
      </section>

      <section>
        <h2>9. GDPR and CCPA Rights</h2>
        <p>
          <strong>
            Depending on where you live, you may have additional privacy rights.
          </strong>{" "}
          If GDPR applies to you, you may have the right to access your data,
          correct inaccurate data, request erasure, restrict or object to
          processing, receive a portable copy of your data, and lodge a complaint
          with a supervisory authority. If CCPA or similar US state privacy laws
          apply to you, you may have the right to know what personal information
          we collect, request deletion, correct inaccurate information, opt out
          of sale or sharing, and exercise rights without discrimination.
        </p>
        <p>
          Onegent does not sell personal information. We also will not retaliate
          against you for exercising privacy rights.
        </p>
      </section>

      <section>
        <h2>10. Security</h2>
        <p>
          <strong>
            We use technical and organizational safeguards to protect your data,
            but no system is perfectly secure.
          </strong>{" "}
          Sensitive booking profile fields are encrypted at rest. Access to
          production systems is limited to authorized operators. We use managed
          infrastructure, authentication controls, logging, and least-privilege
          practices where practical. Because Onegent operates booking automation
          across third-party sites, you should review final booking details
          carefully before confirming any charge.
        </p>
      </section>

      <section>
        <h2>11. Children</h2>
        <p>
          <strong>
            Onegent is not intended for children.
          </strong>{" "}
          The service is not intended for users under 16. In the United States,
          Onegent is not intended for children under 13 under COPPA. If we learn
          that we collected personal information from a child in a way that
          violates applicable law, we will delete it.
        </p>
      </section>

      <section>
        <h2>12. Changes to This Policy</h2>
        <p>
          <strong>
            We may update this Privacy Policy as Onegent evolves.
          </strong>{" "}
          If we make material changes, we will provide notice by email or through
          the product before the changes take effect when required by law. The
          effective date and last-updated date above show when this policy was
          last revised.
        </p>
      </section>

      <section>
        <h2>13. Contact</h2>
        <p>
          <strong>
            Contact us if you have questions or privacy requests.
          </strong>{" "}
          For privacy questions, data export requests, deletion requests, or
          rights requests, contact support@onegent.one. For general beta
          questions, contact beta@onegent.one.
        </p>
      </section>
    </main>
  );
}
