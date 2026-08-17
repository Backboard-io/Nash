export const ErrorMessage = ({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) => (
  <div
    role="alert"
    aria-live="assertive"
    data-testid={testId}
    className="relative mt-6 rounded-xl border border-red-500/20 bg-red-50/50 px-6 py-4 text-red-700 shadow-sm transition-all dark:bg-red-950/30 dark:text-red-100"
  >
    {children}
  </div>
);
