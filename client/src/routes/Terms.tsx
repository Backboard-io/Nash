import LegalLayout from './LegalLayout';

const sections = [
  {
    title: '1. Eligibility',
    body: [
      'You must be at least 13 years old to use Nash. If you are under the age of majority in your jurisdiction, you may only use Nash with the consent of a parent or legal guardian.',
    ],
  },
  {
    title: '2. Your Account',
    bullets: [
      'Nash signs you in with your Backboard API key. You are responsible for keeping that key secret and for all activity that happens under it.',
      'If you believe your key has been compromised, rotate it in your Backboard account settings immediately.',
    ],
  },
  {
    title: '3. Use of the Service',
    body: [
      'Nash provides a chat interface to AI models, file uploads, custom agents, memories, and related tools, powered by the Backboard API.',
      'You agree to use the service only for lawful, authorized purposes, to comply with applicable laws and regulations, and not to use it to develop or distribute harmful, abusive, or infringing content.',
    ],
  },
  {
    title: '4. Acceptable Use',
    bullets: [
      'Do not generate, share, or disseminate unlawful or harmful content.',
      'Do not upload or share personal data without proper authorization.',
      'Do not interfere with or disrupt the service or its infrastructure.',
    ],
  },
  {
    title: '5. Data & Privacy',
    bullets: [
      'You retain ownership of any data you input into the service ("User Data").',
      'Your conversations, files, and memories are processed and stored through the Backboard API using your own API key.',
      'Model outputs are probabilistic and factual accuracy is not guaranteed — always verify important information.',
      'See the Privacy Policy for more information.',
    ],
  },
  {
    title: '6. Open Source',
    body: [
      'The Nash software is open source and released under the MIT License. Nothing in these Terms restricts your rights under that license to use, modify, and distribute the software itself.',
      'These Terms govern your use of a hosted instance of the service, not the source code.',
    ],
  },
  {
    title: '7. Third-Party Services',
    body: [
      'Nash depends on third-party services — most notably the Backboard API and the AI model providers it routes to. Your use of those services is subject to their respective terms, and we are not responsible for their functionality, availability, or compliance.',
    ],
  },
  {
    title: '8. Disclaimers',
    bullets: [
      'The service is provided "as is" and "as available."',
      'We do not warrant that outputs will be accurate, complete, or suitable for any particular purpose.',
      'AI responses may contain errors, hallucinations, or biases — human oversight is required.',
      'All warranties are disclaimed to the maximum extent permitted by law.',
    ],
  },
  {
    title: '9. Limitation of Liability',
    bullets: [
      'To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the service.',
    ],
  },
  {
    title: '10. Termination',
    bullets: [
      'We may suspend or terminate your access if you breach these Terms or we detect misuse or risk to the system.',
      'You may stop using the service at any time.',
    ],
  },
  {
    title: '11. Modifications to the Terms',
    body: [
      'We may update these Terms periodically and will notify you of material changes.',
      'Continued use of the service constitutes acceptance of the updated Terms.',
    ],
  },
];

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="August 13, 2026">
      <p>
        These Terms of Service govern your access to and use of Nash, an open-source AI chat
        application that connects to the Backboard API.
      </p>
      <p>By accessing or using Nash, you agree to be bound by these Terms. If you do not agree, do not use Nash.</p>

      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <h2>{section.title}</h2>
            {section.body?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.bullets ? (
              <ul className="list-disc space-y-2 pl-6">
                {section.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </LegalLayout>
  );
}
