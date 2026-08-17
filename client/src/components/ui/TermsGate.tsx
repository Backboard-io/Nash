import { Link } from 'react-router-dom';
import { useAcceptTermsMutation } from '~/data-provider';

interface TermsGateProps {
  onDecline: () => void;
}

export default function TermsGate({ onDecline }: TermsGateProps) {
  const acceptTermsMutation = useAcceptTermsMutation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-primary p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-border-light bg-surface-secondary p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-purple text-white font-bold text-lg">
            N
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Terms of Service</h1>
        </div>

        <p className="mb-5 text-sm text-text-secondary">
          Before continuing, please review and accept Nash&apos;s Terms of Service and Privacy Policy.
        </p>

        <div className="mb-6 max-h-64 overflow-y-auto rounded-xl border border-border-light bg-surface-primary p-5 text-sm text-text-primary leading-relaxed">
          <p className="mb-3 font-semibold">By using Nash, you agree that:</p>
          <ul className="space-y-2 list-none">
            <li>• You must be 13 or older to use Nash</li>
            <li>• You will not use Nash to generate harmful, illegal, or abusive content</li>
            <li>• We do not sell your data or use your conversations to train AI models</li>
            <li>• AI responses may be inaccurate — always verify important information</li>
          </ul>
          <p className="mt-4 text-text-secondary">
            Read the full{' '}
            <Link
              to="/terms"
              target="_blank"
              className="text-brand-purple hover:underline dark:text-violet-400"
            >
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link
              to="/privacy"
              target="_blank"
              className="text-brand-purple hover:underline dark:text-violet-400"
            >
              Privacy Policy
            </Link>{' '}
            for complete details.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onDecline}
            className="flex-1 rounded-xl border border-border-heavy bg-surface-primary px-4 py-3 text-sm text-text-primary transition-colors hover:bg-surface-active"
          >
            Decline &amp; Sign Out
          </button>
          <button
            type="button"
            onClick={() => acceptTermsMutation.mutate()}
            disabled={acceptTermsMutation.isLoading}
            className="flex-1 rounded-xl bg-brand-purple px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-purple-pressed disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {acceptTermsMutation.isLoading ? 'Saving…' : 'I Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
