import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import { Banner } from '../Banners';

function AuthLayout({
  children,
  header,
  subheader,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  subheader?: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const appTitle = startupConfig?.appTitle ?? 'Nash';

  const DisplayError = () => {
    if (hasStartupConfigError) {
      return <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>;
    } else if (error != null && error) {
      return <ErrorMessage>{localize(error)}</ErrorMessage>;
    }
    return null;
  };

  return (
    <div className="flex min-h-screen w-full bg-surface-primary">
      {/* Brand panel. The backdrop is a literal transcription of the Figma
          "Hero Panel" (Login — Dark, 580x674): four blurred #635BFF blobs, a
          diagonal sheen and a vignette, over #0A0C10. Radii are expressed as
          percentages of the panel (Figma px / 580 wide / 674 tall) so the
          composition scales with the viewport exactly as the artboard does. */}
      <div
        className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-14 text-white lg:flex"
        style={{ backgroundColor: '#0A0C10' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            filter: 'blur(55px)',
            background: [
              'radial-gradient(52.07% 41.69% at 83.3% 81.7%, rgba(99,91,255,0.90) 0%, rgba(99,91,255,0) 72%)',
              'radial-gradient(45.52% 38.43% at 15.5% 82.3%, rgba(99,91,255,0.55) 0%, rgba(99,91,255,0) 70%)',
              'radial-gradient(41.72% 35.76% at 26.7% 28.6%, rgba(99,91,255,0.75) 0%, rgba(99,91,255,0) 72%)',
              'radial-gradient(50.00% 41.69% at 92.0% 15.0%, rgba(99,91,255,0.60) 0%, rgba(99,91,255,0) 72%)',
            ].join(','),
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(50.9deg, rgba(99,91,255,0) 38%, rgba(99,91,255,0.10) 47%, rgba(99,91,255,0.16) 50%, rgba(99,91,255,0.10) 53%, rgba(99,91,255,0) 62%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(20.86% 27.74% at 50% 77.8%, rgba(10,12,16,0) 0%, rgba(10,12,16,0.28) 55%, rgba(10,12,16,0.70) 100%)',
          }}
        />
        <span className="relative z-10 text-2xl font-semibold">{appTitle}</span>
        <div className="relative z-10 max-w-2xl">
          <h2 className="text-4xl font-bold leading-tight">
            Every AI model.
            <br />
            <span className="whitespace-nowrap">One workspace. Zero lock-in.</span>
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
            Switch anytime. Your memory, your data, and your budget stay with you, not with any one AI
            company.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex w-full flex-col lg:w-1/2">
        <Banner />
        <div className="flex items-center justify-between px-8 pt-8 sm:px-12 lg:px-14">
          <img
            src="assets/nash.png"
            className="h-8 w-auto object-contain dark:hidden lg:hidden"
            alt={localize('com_ui_logo', { 0: appTitle })}
          />
          <img
            src="assets/nash_dark.png"
            className="hidden h-8 w-auto object-contain dark:block lg:dark:hidden"
            alt={localize('com_ui_logo', { 0: appTitle })}
          />
          <ThemeSelector returnThemeOnly />
        </div>

        <main className="flex flex-1 flex-col justify-center px-8 sm:px-12 lg:px-14">
          <div className="mx-auto w-full max-w-sm">
            {!hasStartupConfigError && !isFetching && (
              <header className="mb-6">
                <h1 className="text-3xl font-bold text-text-primary" style={{ userSelect: 'none' }}>
                  {header}
                </h1>
                {subheader != null && subheader !== '' && (
                  <p className="mt-1 text-sm text-text-secondary">{subheader}</p>
                )}
              </header>
            )}
            <DisplayError />
            {children}
          </div>
        </main>

        <div className="px-8 pb-8 pt-6 sm:px-12 lg:px-14">
          <p className="text-xs text-text-tertiary">
            By continuing, you agree to {appTitle}&apos;s{' '}
            <a href="/terms" className="hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy" className="hover:underline">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
