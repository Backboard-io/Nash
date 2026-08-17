import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export default function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-10 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            to="/c/new"
            className="flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft size={16} />
            Back to Nash
          </Link>
          <span className="text-border-light">|</span>
          <div className="flex gap-4 text-sm text-text-secondary">
            <Link to="/privacy" className="hover:text-text-primary transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-text-primary transition-colors">Terms of Service</Link>
          </div>
        </div>

        <header className="mb-8 border-b border-border-light pb-6">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-text-secondary">Last updated: {lastUpdated}</p>
        </header>

        <div className="prose prose-neutral dark:prose-invert max-w-none break-words [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text-primary [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-medium [&_p]:text-text-secondary [&_p]:leading-relaxed [&_li]:text-text-secondary [&_li]:leading-relaxed [&_a]:text-text-primary [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>

        <footer className="mt-12 border-t border-border-light pt-6 text-center text-xs text-text-secondary">
          <p>© {new Date().getFullYear()} Nash</p>
          <div className="mt-2 flex justify-center gap-4">
            <Link to="/privacy" className="hover:text-text-primary transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-text-primary transition-colors">Terms</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
