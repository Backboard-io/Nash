import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import TagManager from 'react-gtm-module';
import { Link } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import ReleaseNotesModal from './ReleaseNotesModal';

export default function Footer({ className }: { className?: string }) {
  const { data: config } = useGetStartupConfig();
  const localize = useLocalize();
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);

  const termsOfServiceRender = (
    <Link className="text-text-secondary underline" to="/terms">
      {localize('com_ui_terms_of_service')}
    </Link>
  );

  const customFooterParts =
    typeof config?.customFooter === 'string' ? config.customFooter.split('|') : null;

  useEffect(() => {
    if (config?.analyticsGtmId != null && typeof window.google_tag_manager === 'undefined') {
      const tagManagerArgs = {
        gtmId: config.analyticsGtmId,
      };
      TagManager.initialize(tagManagerArgs);
    }
  }, [config?.analyticsGtmId]);

  const mainContentRender = customFooterParts
    ? customFooterParts.map((text, index) => (
        <React.Fragment key={`main-content-part-${index}`}>
          <ReactMarkdown
            components={{
              a: ({ node: _n, href, children, ...otherProps }) => {
                return (
                  <a
                    className="text-text-secondary underline"
                    href={href}
                    rel="noreferrer"
                    {...otherProps}
                  >
                    {children}
                  </a>
                );
              },

              p: ({ node: _n, ...props }) => <span {...props} />,
            }}
          >
            {text.trim()}
          </ReactMarkdown>
        </React.Fragment>
      ))
    : [];

  const statusUrl = (config as Record<string, unknown>)?.statusPageURL as string | undefined;
  const supportUrl = (config as Record<string, unknown>)?.supportURL as string | undefined;

  const statusRender = statusUrl ? (
    <a
      className="text-text-secondary underline"
      href={statusUrl}
      target={statusUrl.startsWith('http') ? '_blank' : undefined}
      rel="noreferrer"
    >
      Status
    </a>
  ) : null;

  const supportRender = supportUrl ? (
    <a
      className="text-text-secondary underline"
      href={supportUrl}
    >
      Support
    </a>
  ) : null;

  // Legal/support links first, Nash version + scroll text rightmost
  const footerElements = [
    // privacyPolicyRender,
    // termsOfServiceRender,
    // cookiesRender,
    // statusRender,
    // supportRender,
    ...mainContentRender,
  ].filter(Boolean);

  return (
    <div className="relative w-full">
      <div
        className={
          className ??
          'absolute bottom-0 left-0 right-0 hidden items-center justify-center gap-2 px-2 py-2 text-center text-xs text-text-primary sm:flex md:px-[60px]'
        }
        role="contentinfo"
      >
        {footerElements.map((contentRender, index) => {
          const isLastElement = index === footerElements.length - 1;
          return (
            <React.Fragment key={`footer-element-${index}`}>
              {contentRender}
              {!isLastElement && (
                <div
                  key={`separator-${index}`}
                  className="h-2 border-r-[1px] border-border-medium"
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <ReleaseNotesModal
        open={showReleaseNotes}
        onOpenChange={setShowReleaseNotes}
        currentVersion={String(Constants.VERSION)}
      />
    </div>
  );
}
