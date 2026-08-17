import type { ReactNode } from 'react';
import LegalLayout from './LegalLayout';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <h2>{title}</h2>
    <div className="space-y-3">{children}</div>
  </section>
);

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="July 3, 2025">
      <p>
        Nash ("we", "our", or "us") provides an AI chat platform and related infrastructure.
        This Privacy Policy explains what information we collect, how we use it, when we share
        it, and the choices available to you when you use our website, apps, and services.
      </p>

      <Section title="1. Information We Collect">
        <h3>Information you provide</h3>
        <p>
          Account information such as your display name and the Backboard API key you sign in
          with (stored encrypted, server-side). Content, files, metadata, and configuration
          details submitted through the Services. Support tickets, surveys, and feedback.
        </p>

        <h3>Information collected automatically</h3>
        <p>
          IP address, device details, browser type, and timestamps. Usage details including API
          calls, model selections, memory operations, and feature interactions. Cookies used for
          authentication, analytics, and security.
        </p>

        <h3>Information from third parties</h3>
        <p>
          The Backboard API, which processes your chats and files. Third-party LLM providers when
          users route requests to them.
        </p>
      </Section>

      <Section title="2. How We Use Information">
        <p>
          We use the information described above to provide and maintain the Services,
          authenticate and secure accounts, optimize memory, retrieval, embeddings, or model
          routing, communicate service updates and notices, conduct analytics to understand
          product usage, and comply with legal requirements. We do not sell personal
          information.
        </p>
      </Section>

      <Section title="3. Legal Bases (GDPR and UK-GDPR)">
        <p>
          For individuals in protected jurisdictions, we process data under performance of a
          contract, legitimate interests including product improvement and security, compliance
          with legal obligations, and consent when required, such as for optional marketing.
        </p>
      </Section>

      <Section title="4. How We Share Information">
        <p>
          We share information only when necessary for the operation of the Services, including
          cloud hosting providers, the Backboard API, third-party LLM providers when selected by
          the user, and legal authorities when required by law. We do not authorize partners to use
          your information for advertising or unrelated profiling.
        </p>
      </Section>

      <Section title="5. How We Handle AI Data">
        <p>
          Content sent through the platform is processed only to provide inference, memory,
          retrieval, embeddings, or related features. When memory features are enabled, stored
          content follows the user's configuration. Users can delete memory at any time. We do
          not train proprietary models on customer data. Third-party providers used through
          routing options follow their own data practices.
        </p>
      </Section>

      <Section title="6. International Data Transfers">
        <p>
          We host data in AWS regions located in Canada and the United States. If personal
          information is transferred outside your jurisdiction, we use recognized safeguards such
          as Standard Contractual Clauses or equivalent mechanisms.
        </p>
      </Section>

      <Section title="7. Data Retention">
        <p>
          We retain personal information as long as necessary for the purposes described in this
          policy. Account information is kept while the account is active. Memory data follows
          user-selected retention and deletion policies. Users may delete their account and its
          data at any time from Settings.
        </p>
      </Section>

      <Section title="8. Your Rights">
        <p>
          Depending on applicable law, you may have the right to access the data we hold about
          you, correct inaccurate information, request deletion, object to certain processing,
          receive a copy of your data, or withdraw consent. Requests can be submitted to
          privacy@backboard.io.
        </p>
      </Section>

      <Section title="9. Security">
        <p>
          We use administrative, technical, and physical safeguards including encryption in transit
          and at rest, access controls, audit logging, and regular security reviews. No system is
          completely secure, but we follow industry standards to reduce risk.
        </p>
      </Section>

      <Section title="10. Childrens Privacy">
        <p>
          Our Services are not directed to children under 16. We do not knowingly collect
          information from them.
        </p>
      </Section>

      <Section title="11. Contact / Changes to This Policy">
        <p>
          We may update this Privacy Policy as our Services evolve. Substantial changes will be
          communicated through our website. Contact: privacy@backboard.io.
        </p>
      </Section>
    </LegalLayout>
  );
}
