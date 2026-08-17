import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import releaseNotesData from '~/data/releaseNotes.json';

type ReleaseNotesModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVersion: string;
};

type ReleaseNote = {
  body: string;
  publishedAt: string;
  tagName: string;
  title: string;
};

const releaseNotes = releaseNotesData as ReleaseNote[];

function formatReleaseDate(isoDate: string) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function ReleaseNotesModal({
  open,
  onOpenChange,
  currentVersion,
}: ReleaseNotesModalProps) {
  return (
    <Transition appear show={open}>
      <Dialog as="div" className="relative z-50" onClose={onOpenChange}>
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black opacity-50 dark:opacity-80" aria-hidden="true" />
        </TransitionChild>

        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
            <DialogPanel className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-background shadow-2xl backdrop-blur-2xl animate-in sm:rounded-2xl">
              <DialogTitle
                className="flex items-center justify-between border-b border-border-light p-6 pb-4"
                as="div"
              >
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">Release Notes</h2>
                  <p className="mt-1 text-sm text-text-secondary">
                    Local copy of Nash releases for this private repo.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-[7px] opacity-70 transition-opacity hover:opacity-100 focus:outline-none"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close release notes"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5 text-text-primary"
                  >
                    <line x1="18" x2="6" y1="6" y2="18" />
                    <line x1="6" x2="18" y1="6" y2="18" />
                  </svg>
                </button>
              </DialogTitle>

              <div className="max-h-[calc(90vh-92px)] overflow-y-auto p-6">
                <div className="space-y-6">
                  {releaseNotes.map((release) => {
                    const isCurrent =
                      release.tagName === currentVersion || release.title === currentVersion;

                    return (
                      <section
                        key={`${release.tagName}-${release.publishedAt}`}
                        className="rounded-xl border border-border-light bg-surface-primary-alt p-5"
                      >
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <h3 className="text-base font-semibold text-text-primary">
                            {release.title || release.tagName}
                          </h3>
                          {isCurrent && (
                            <span className="rounded-full bg-brand-purple/10 px-2 py-0.5 text-xs font-medium text-brand-purple dark:text-violet-400">
                              Current
                            </span>
                          )}
                          <span className="text-xs text-text-secondary">
                            {formatReleaseDate(release.publishedAt)}
                          </span>
                        </div>

                        <div className="release-notes-markdown text-sm text-text-primary">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ node: _n, href, children, ...props }) => (
                                <a
                                  className="underline underline-offset-2"
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  {...props}
                                >
                                  {children}
                                </a>
                              ),
                              p: ({ node: _n, className, ...props }) => (
                                <p className={`mb-3 last:mb-0 ${className ?? ''}`.trim()} {...props} />
                              ),
                              ul: ({ node: _n, className, ...props }) => (
                                <ul
                                  className={`mb-3 list-disc space-y-1 pl-5 last:mb-0 ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              ol: ({ node: _n, className, ...props }) => (
                                <ol
                                  className={`mb-3 list-decimal space-y-1 pl-5 last:mb-0 ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              h1: ({ node: _n, className, ...props }) => (
                                <h4
                                  className={`mb-3 text-lg font-semibold text-text-primary ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              h2: ({ node: _n, className, ...props }) => (
                                <h5
                                  className={`mb-2 mt-4 text-base font-semibold text-text-primary ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              h3: ({ node: _n, className, ...props }) => (
                                <h6
                                  className={`mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-text-secondary ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              code: ({ node: _n, className, ...props }) => (
                                <code
                                  className={`rounded bg-surface-secondary px-1 py-0.5 ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              pre: ({ node: _n, className, ...props }) => (
                                <pre
                                  className={`mb-3 overflow-x-auto rounded-lg bg-surface-secondary p-3 text-xs ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              table: ({ node: _n, className, ...props }) => (
                                <div className="mb-3 overflow-x-auto">
                                  <table
                                    className={`min-w-full border-collapse text-left ${className ?? ''}`.trim()}
                                    {...props}
                                  />
                                </div>
                              ),
                              th: ({ node: _n, className, ...props }) => (
                                <th
                                  className={`border-b border-border-medium px-3 py-2 font-semibold ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                              td: ({ node: _n, className, ...props }) => (
                                <td
                                  className={`border-b border-border-light px-3 py-2 align-top ${className ?? ''}`.trim()}
                                  {...props}
                                />
                              ),
                            }}
                          >
                            {release.body || 'No release notes available.'}
                          </ReactMarkdown>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            </DialogPanel>
          </div>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}
