export const metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Onegent.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 prose prose-invert">
      <h1>Terms of Service</h1>
      <p className="text-sm text-gray-400">
        Effective: 2026-04-26 · Last updated: 2026-04-26
      </p>

      <section>
        <h2>1. Introduction</h2>
        <p>
          <strong>
            These Terms govern your access to and use of Onegent.
          </strong>{" "}
          Onegent is the travel execution layer for AI agents and groups. By
          using onegent.one, the Onegent web app, the hosted MCP endpoint at
          /api/mcp, the npm package @onegent/mcp-server, or any Onegent REST API
          endpoint under /api/v1/*, you agree to these Terms. If you do not
          agree, do not use the service.
        </p>
        <p>
          Onegent is currently in private beta. The product may change quickly,
          contain experimental functionality, or be unavailable at times. These
          Terms are written for the beta service and may be updated before or
          when production pricing launches.
        </p>
      </section>

      <section>
        <h2>2. What Onegent Does</h2>
        <p>
          <strong>
            Onegent provides AI-powered booking automation, but it is not the
            booking party.
          </strong>{" "}
          You can ask Onegent to search, compare, and prepare bookings for
          restaurants, hotels, flights, activities, events, and multi-person
          trips. Onegent uses AI models, browser automation, Playwright,
          Stagehand, and related systems to navigate booking sites on your
          behalf.
        </p>
        <p>
          Onegent is an interface and automation layer. We do not own, operate,
          control, or guarantee the restaurants, hotels, airlines, activity
          providers, ticketing platforms, or booking marketplaces that the agent
          visits. The actual booking relationship is between you and the relevant
          venue, provider, merchant, marketplace, or travel supplier.
        </p>
      </section>

      <section>
        <h2>3. Eligibility and Accounts</h2>
        <p>
          <strong>
            You must be at least 16 and provide accurate account information.
          </strong>{" "}
          You may use Onegent only if you are at least 16 years old and legally
          able to agree to these Terms. You must provide accurate information,
          maintain one account per human user, and keep your login credentials
          secure. We use Clerk for authentication and may require multi-factor
          authentication or other verification features.
        </p>
        <p>
          You are responsible for all activity under your account, including
          booking jobs started through your account, API keys, MCP connections,
          or saved credentials. Tell us immediately if you believe your account
          or API key has been compromised.
        </p>
      </section>

      <section>
        <h2>4. Booking Responsibility and Payment</h2>
        <p>
          <strong>
            You are responsible for reviewing and approving any final booking or
            charge.
          </strong>{" "}
          During beta, Onegent does not charge you for using the service. When
          production pricing launches, the planned price is $0.40 per booking,
          but no paid tier is active as of the effective date of these Terms.
        </p>
        <p>
          Bookings may charge your card directly through the venue, hotel,
          airline, activity provider, ticketing provider, or other third-party
          merchant. Onegent is not a merchant of record for beta bookings. Our
          agent may fill in your saved profile and payment information, but it is
          designed to stop before submitting the credit card CVV or final paid
          confirmation. You must explicitly confirm the final charge.
        </p>
        <p>
          You are responsible for cancellation policies, no-show fees, refund
          rules, provider terms, taxes, service fees, resort fees, baggage fees,
          and other charges shown by the third-party provider.
        </p>
      </section>

      <section>
        <h2>5. Acceptable Use</h2>
        <p>
          <strong>
            You may not use Onegent to abuse booking sites, commit fraud, or
            bypass provider rules.
          </strong>{" "}
          You agree not to use Onegent to scrape booking sites at scale, flood
          providers with requests, resell reservations, use fraudulent payment
          instruments, create fake accounts, bypass anti-abuse systems, violate
          booking site terms, or perform illegal activity.
        </p>
        <p>
          Onegent attempts to respect provider terms, robots.txt where
          applicable, rate limits, and reasonable automation boundaries. However,
          you are ultimately responsible for the actions you instruct the agent
          to take, the credentials you provide, and your compliance with
          third-party provider rules.
        </p>
      </section>

      <section>
        <h2>6. API Keys and Developer Use</h2>
        <p>
          <strong>
            Developers are responsible for how they use Onegent APIs and MCP
            integrations.
          </strong>{" "}
          B2B users and developers may receive API keys beginning with
          ogk_live_... to call Onegent REST API endpoints programmatically. You
          must keep API keys confidential, use them only for authorized
          applications, and not expose them in public repositories, frontend
          code, client-side bundles, or logs.
        </p>
        <p>
          You may not use the API, hosted MCP endpoint, or npm package to build
          abusive automation, spam booking providers, misrepresent Onegent, or
          violate the law. We may revoke API keys or suspend access if we detect
          unsafe use, excessive load, abuse, or security risk.
        </p>
      </section>

      <section>
        <h2>7. Beta Availability and Automation Limits</h2>
        <p>
          <strong>
            Onegent is a best-effort automation service and may fail.
          </strong>{" "}
          Booking automation can fail because of site changes, anti-bot systems,
          login walls, CAPTCHAs, provider downtime, limited inventory, inaccurate
          third-party information, model errors, browser failures, or network
          problems. We do not guarantee that Onegent will find availability,
          complete a booking, preserve a price, or avoid provider-side errors.
        </p>
        <p>
          You should independently review important booking details, including
          date, time, location, cancellation policy, room type, flight route,
          passenger details, seat selection, and final price before confirming.
        </p>
      </section>

      <section>
        <h2>8. User Content and Permissions</h2>
        <p>
          <strong>
            You give Onegent permission to process the information needed to run
            your requested tasks.
          </strong>{" "}
          You may provide messages, profile information, travel preferences,
          payment fields, identity information, and other content to operate the
          service. You retain ownership of your content, but you grant Onegent a
          limited license to host, process, transmit, display, and use that
          content to provide, secure, debug, and improve the service.
        </p>
        <p>
          You represent that you have the right to provide any information you
          submit, including information for travelers or group members. Do not
          submit another person&apos;s sensitive information unless you have
          their permission or another lawful basis.
        </p>
      </section>

      <section>
        <h2>9. Third-Party Services</h2>
        <p>
          <strong>
            Third-party sites and providers are governed by their own terms and
            policies.
          </strong>{" "}
          Onegent may interact with OpenTable, Resy, Booking.com, Expedia,
          Hotels.com, Viator, Ticketmaster, SeatGeek, restaurant websites, hotel
          websites, and other third-party services. We do not control those
          services and are not responsible for their availability, content,
          prices, fees, policies, or decisions.
        </p>
        <p>
          Your use of third-party services may be subject to their separate
          terms, privacy policies, cancellation rules, loyalty program terms,
          and dispute processes.
        </p>
      </section>

      <section>
        <h2>10. Suspension and Termination</h2>
        <p>
          <strong>
            We may suspend abusive or risky accounts, and you may stop using
            Onegent at any time.
          </strong>{" "}
          You may delete your account or stop using the service at any time. We
          may suspend, limit, or terminate your access if we believe you violated
          these Terms, created risk for Onegent or third parties, misused
          automation, compromised security, or used the service unlawfully.
        </p>
        <p>
          After termination, some provisions will continue to apply, including
          payment responsibility, disclaimers, limits of liability,
          indemnification, arbitration, and any terms that by their nature should
          survive.
        </p>
      </section>

      <section>
        <h2>11. Disclaimers</h2>
        <p>
          <strong>
            Onegent is provided as is, without warranties.
          </strong>{" "}
          To the maximum extent allowed by law, Onegent disclaims all warranties,
          express or implied, including warranties of merchantability, fitness
          for a particular purpose, non-infringement, availability, accuracy,
          reliability, and successful booking. We do not guarantee that the
          service will be uninterrupted, secure, error-free, or compatible with
          every booking site.
        </p>
      </section>

      <section>
        <h2>12. Limitation of Liability</h2>
        <p>
          <strong>
            Our liability is limited to the greater of $100 or the fees you paid
            to Onegent in the previous 12 months.
          </strong>{" "}
          To the maximum extent allowed by law, Onegent will not be liable for
          indirect, incidental, special, consequential, exemplary, or punitive
          damages, or for lost profits, lost data, lost reservations, missed
          travel, provider penalties, cancellation charges, or third-party
          provider conduct.
        </p>
        <p>
          Because the beta is currently free, your paid fees may be $0. In all
          cases, our total liability will not exceed the greater of $100 or the
          amount you paid Onegent in the 12 months before the event giving rise
          to the claim.
        </p>
      </section>

      <section>
        <h2>13. Indemnification</h2>
        <p>
          <strong>
            You are responsible for claims caused by your misuse of Onegent.
          </strong>{" "}
          You agree to defend, indemnify, and hold harmless Onegent and its
          operators, affiliates, contractors, and service providers from claims,
          damages, losses, liabilities, costs, and expenses arising from your
          misuse of the service, violation of these Terms, violation of law,
          violation of third-party rights, or unauthorized use of another
          person&apos;s data, credentials, or payment instrument.
        </p>
      </section>

      <section>
        <h2>14. Changes to the Service or Terms</h2>
        <p>
          <strong>
            We may modify the service and will give notice before material Terms
            changes.
          </strong>{" "}
          Onegent may add, remove, or change features during beta. If we make
          material changes to these Terms, we will notify users by email at least
          30 days before the changes take effect, unless changes are needed
          sooner for legal, safety, or security reasons. Continued use after the
          effective date means you accept the updated Terms.
        </p>
      </section>

      <section>
        <h2>15. Governing Law and Arbitration</h2>
        <p>
          <strong>
            Delaware law governs these Terms, and disputes are resolved through
            individual binding arbitration.
          </strong>{" "}
          These Terms are governed by the laws of Delaware, USA, without regard
          to conflict-of-law principles. Any dispute arising from or relating to
          these Terms or Onegent will be resolved by binding arbitration under
          the rules of the American Arbitration Association. The seat and venue
          for arbitration will be San Francisco County, California.
        </p>
        <p>
          You and Onegent waive the right to a jury trial and agree to bring
          claims only on an individual basis. Class actions, class arbitrations,
          private attorney general actions, and representative proceedings are
          not permitted to the maximum extent allowed by law.
        </p>
      </section>

      <section>
        <h2>16. Severability and Entire Agreement</h2>
        <p>
          <strong>
            If part of these Terms is unenforceable, the rest still applies.
          </strong>{" "}
          If any provision of these Terms is found invalid or unenforceable, that
          provision will be limited or removed to the minimum extent necessary,
          and the remaining provisions will remain in effect. These Terms,
          together with the Privacy Policy and any written beta or API terms we
          provide, are the entire agreement between you and Onegent regarding the
          service.
        </p>
      </section>

      <section>
        <h2>17. Contact</h2>
        <p>
          <strong>
            Contact us if you have questions about these Terms.
          </strong>{" "}
          For Terms of Service questions, contact support@onegent.one. For
          general beta questions, contact beta@onegent.one.
        </p>
      </section>
    </main>
  );
}
