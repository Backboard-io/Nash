import React, { useMemo, useState } from 'react';
import { TError } from 'librechat-data-provider';

type ProviderValue = {
  error?: TError;
  setError: React.Dispatch<React.SetStateAction<boolean>>;
};
const ApiErrorBoundaryContext = React.createContext<ProviderValue | undefined>(undefined);

export const ApiErrorBoundaryProvider = ({
  value,
  children,
}: {
  value: ProviderValue;
  children: React.ReactNode;
}) => {
  const [error, setError] = useState(false);
  // Memoized: an inline object literal here is a NEW context value on every
  // provider render, re-rendering every consumer (App included) for no
  // state change.
  const fallback = useMemo(() => ({ error, setError }), [error]);
  return (
    <ApiErrorBoundaryContext.Provider value={value ?? fallback}>
      {children}
    </ApiErrorBoundaryContext.Provider>
  );
};

export const useApiErrorBoundary = () => {
  const context = React.useContext(ApiErrorBoundaryContext);

  if (context === undefined) {
    throw new Error('useApiErrorBoundary must be used inside ApiErrorBoundaryProvider');
  }

  return context;
};
