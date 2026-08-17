import { Link } from 'react-router-dom';
import { useAcceptTermsMutation } from '~/data-provider';
import { primaryAction, secondaryAction } from '~/components/ui/actionButton';
import { cn } from '~/utils';

interface TermsGateProps {
  onDecline: () => void;
}

const TERMS = [
  'You must be 13 or older to use Nash',
  'You will not use Nash to generate harmful, illegal, or abusive content',
  'We do not sell your data or use your conversations to train AI models',
  'AI responses may be inaccurate — always verify important information',
  'Paid plans renew monthly and can be cancelled anytime',
];

export default function TermsGate({ onDecline }: TermsGateProps) {
  const acceptTermsMutation = useAcceptTermsMutation();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-primary p-4 sm:p-6">
      <div
        className={cn(
          'w-full max-w-[520px] rounded-2xl bg-surface-hover p-5 sm:p-7',
          'shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light',
          'dark:shadow-[0_12px_34px_rgba(0,0,0,0.35)] dark:ring-0',
        )}
      >
        <h1 className="text-[22px] font-semibold leading-[30px] tracking-[-0.3px] text-text-primary">
          Terms of Service
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-[20px] text-text-secondary">
          Before continuing, please review and accept Nash&apos;s Terms of Service and Privacy
          Policy.
        </p>

        <div className="mt-5 max-h-[46vh] overflow-y-auto rounded-[13px] bg-surface-active p-4 sm:max-h-[300px] sm:p-5">
          <p className="text-[13.5px] font-medium leading-[20px] text-text-primary">
            By using Nash, you agree that:
          </p>
          <ul className="mt-2.5 list-disc space-y-1.5 pl-[18px] text-[13.5px] leading-[20px] text-text-primary marker:text-text-tertiary">
            {TERMS.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] leading-[18px] text-text-secondary-alt">
            Read the full{' '}
            <Link to="/terms" target="_blank" className="text-text-primary underline underline-offset-2">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank" className="text-text-primary underline underline-offset-2">
              Privacy Policy
            </Link>{' '}
            for complete details.
          </p>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onDecline}
            className={cn(secondaryAction, 'h-[40px] justify-center px-[18px] text-[13.5px]')}
          >
            Decline &amp; sign out
          </button>
          <button
            type="button"
            onClick={() => acceptTermsMutation.mutate()}
            disabled={acceptTermsMutation.isLoading}
            className={cn(primaryAction, 'h-[40px] justify-center px-[18px] text-[13.5px]')}
          >
            {acceptTermsMutation.isLoading ? 'Saving…' : 'I accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
