import React, { useState, useEffect } from 'react';
import { Button, Spinner } from '@librechat/client';
import { KeyRound, ExternalLink } from 'lucide-react';

interface ApiKeyLoginFormProps {
  onSubmit: (apiKey: string) => void;
  error?: string | null;
}

export default function ApiKeyLoginForm({ onSubmit, error }: ApiKeyLoginFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stop loading when an error comes back
  useEffect(() => {
    if (error) {
      setIsSubmitting(false);
    }
  }, [error]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (trimmed && !isSubmitting) {
      setIsSubmitting(true);
      onSubmit(trimmed);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="apikey-input"
          className="text-sm font-medium text-text-primary"
        >
          Backboard API Key
        </label>
        <p className="text-xs text-text-secondary">
          Get your key from{' '}
          <a
            href="https://app.backboard.io/settings"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-brand-purple hover:underline"
          >
            app.backboard.io/settings
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <div className="relative">
          <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            id="apikey-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your API key"
            className="w-full rounded-xl border border-border-medium bg-surface-primary py-3 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand-purple focus:outline-none focus:ring-1 focus:ring-brand-purple dark:bg-surface-secondary"
            autoComplete="off"
            disabled={isSubmitting}
            autoFocus
          />
        </div>
      </div>
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
      <Button
        type="submit"
        disabled={isSubmitting || !apiKey.trim()}
        className="w-full rounded-xl bg-brand-purple py-3 text-sm font-medium text-brand-purple-foreground hover:bg-brand-purple-hover disabled:opacity-50"
      >
        {isSubmitting ? (
          <Spinner className="size-4" />
        ) : (
          'Start chatting'
        )}
      </Button>
    </form>
  );
}
