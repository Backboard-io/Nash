import {
  OGDialog,
  OGDialogContent,
  OGDialogTitle,
  OGDialogDescription,
} from '@librechat/client';
import { useAuthContext } from '~/hooks/AuthContext';
import ApiKeyLoginForm from './ApiKeyLoginForm';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: 'login' | 'register';
}

export default function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const { error, apiKeyLogin } = useAuthContext();

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-full max-w-md border-border-light bg-surface-primary px-6 py-6 text-text-primary">
        <OGDialogTitle className="sr-only">Sign in to Nash</OGDialogTitle>
        <OGDialogDescription className="sr-only">
          Sign in with your Backboard API key.
        </OGDialogDescription>

        {/* Logo + subtitle */}
        <div className="mb-5 flex flex-col items-center gap-1">
          <img
            src="assets/nash.png"
            className="h-8 w-auto object-contain dark:hidden"
            alt="Nash"
          />
          <img
            src="assets/nash_dark.png"
            className="hidden h-8 w-auto object-contain dark:block"
            alt="Nash"
          />
          <p className="mt-1.5 text-xs text-text-secondary">
            Sign in and we'll continue your message in full chat
          </p>
        </div>

        <ApiKeyLoginForm onSubmit={apiKeyLogin} error={error ? String(error) : null} />
      </OGDialogContent>
    </OGDialog>
  );
}
