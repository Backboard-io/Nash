import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-6">
    <h2 className="mt-10 text-lg font-semibold text-text-primary border-b border-border-light pb-2">{title}</h2>
    <div className="mt-4 space-y-3">{children}</div>
  </section>
);

const Q = ({ q, children }: { q: string; children: React.ReactNode }) => (
  <div>
    <p className="font-medium text-text-primary">{q}</p>
    <div className="mt-1 text-sm text-text-secondary leading-relaxed">{children}</div>
  </div>
);

export default function Docs() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <div className="mx-auto max-w-3xl px-6 py-12">

        {/* Header nav */}
        <div className="mb-10 flex items-center gap-4">
          <Link
            to="/c/new"
            className="flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-brand-purple"
          >
            <ArrowLeft size={16} />
            Back to Nash
          </Link>
          <span className="text-border-medium">|</span>
          <div className="flex gap-4 text-sm text-text-secondary">
            <Link to="/privacy" className="hover:text-brand-purple transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-brand-purple transition-colors">Terms</Link>
          </div>
        </div>

        <header className="mb-8 border-b border-border-light pb-6">
          <h1 className="text-3xl font-bold tracking-tight">Help & FAQ</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Can't find your answer? Contact your Nash deployment operator.
          </p>
        </header>

        {/* Jump links */}
        <nav className="mb-10 flex flex-wrap gap-x-4 gap-y-1 text-sm text-brand-purple">
          {[
            ['#getting-started', 'Getting Started'],
            ['#models', 'Models'],
            ['#data', 'Your Data'],
            ['#account', 'Account'],
            ['#troubleshooting', 'Troubleshooting'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="hover:underline">
              {label}
            </a>
          ))}
        </nav>

        <Section id="getting-started" title="Getting Started">
          <Q q="What is Nash?">
            Nash gives you access to 100+ AI models — including GPT-4o, Claude, Gemini, Llama, and
            more — through a single chat interface. You can switch models mid-conversation, compare
            responses, and save your history across devices.
          </Q>
          <Q q="How do I choose a model?">
            Click the model selector at the top of any conversation. Models are grouped by
            provider. Model availability and usage are governed by your Backboard account.
          </Q>
          <Q q="Is there a mobile app?">
            Not yet. Nash runs in any modern browser and is fully responsive on mobile. A native app
            is on the roadmap.
          </Q>
        </Section>

        <Section id="models" title="Models">
          <Q q="Which models can I use?">
            Whatever your Backboard account can reach — Nash lists the live model catalog from the
            Backboard API using your key. Usage is billed by Backboard, not by Nash.
          </Q>
          <Q q="What counts as a token?">
            Tokens are the unit AI models use to measure text. Roughly 1 token ≈ 4 characters of
            English text. Both your input (prompt) and the model's output (response) count as
            usage on your Backboard account.
          </Q>
        </Section>

        <Section id="data" title="Your Data">
          <Q q="Do you use my conversations to train AI models?">
            No. Your conversation content is never used to train AI models — by Nash or any of our
            underlying model providers under our agreements.
          </Q>
          <Q q="Where is my data stored?">
            Your account data and conversation history are stored securely on Backboard.io
            infrastructure, hosted in AWS (US region). See our{' '}
            <Link to="/privacy" className="text-brand-purple hover:underline">
              Privacy Policy
            </Link>{' '}
            for details.
          </Q>
          <Q q="How do I delete my conversation history?">
            Open <strong>Settings → Data Controls</strong> from the account menu and click{' '}
            <strong>Delete all conversations</strong>. This is immediate and permanent.
          </Q>
          <Q q="How do I delete my account?">
            Account deletion removes all your data from the deployment within 30 days. To
            request account deletion, contact your Nash deployment operator.
          </Q>
          <Q q="Can I export my data?">
            Data export is coming soon. In the meantime, contact your Nash deployment operator
            and they can provide an export manually.
          </Q>
        </Section>

        <Section id="account" title="Account">
          <Q q="How do I sign in?">
            Paste your Backboard API key on the login page — get one from{' '}
            <strong>app.backboard.io/settings</strong>. There are no passwords; the key is your
            credential, stored encrypted server-side for the session.
          </Q>
          <Q q="How do I sign out everywhere / rotate my credential?">
            Rotate your API key in your Backboard account settings, then sign in again with the
            new key. Old sessions stop working once their key is invalid.
          </Q>
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <Q q="A model isn't responding / I'm getting errors.">
            Try refreshing the page. If the problem persists, contact your Nash deployment
            operator with the model name and a description of the error.
          </Q>
          <Q q="I'm being logged out unexpectedly.">
            Sessions last 30 days by default and slide with activity. If you're being logged out
            much sooner, check that cookies are enabled in your browser and that no browser
            extension is blocking them.
          </Q>
          <Q q="Something else isn't working.">
            Contact your Nash deployment operator with your browser, OS, and a description of
            the issue.
          </Q>
        </Section>

        <footer className="mt-16 border-t border-border-light pt-6 text-center text-xs text-text-secondary">
          <p>© {new Date().getFullYear()} Nash</p>
          <div className="mt-2 flex justify-center gap-4">
            <Link to="/privacy" className="hover:text-brand-purple transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-brand-purple transition-colors">Terms</Link>
          </div>
        </footer>

      </div>
    </div>
  );
}
