import React, { useRef, useState, useMemo, useEffect } from 'react';
import copy from 'copy-to-clipboard';
import { Download, InfoIcon } from 'lucide-react';
import { Tools } from 'librechat-data-provider';
import { Clipboard, CheckMark } from '@librechat/client';
import type { CodeBarProps } from '~/common';
import ResultSwitcher from '~/components/Messages/Content/ResultSwitcher';
import { useToolCallsMapContext, useMessageContext } from '~/Providers';
import { LogContent } from '~/components/Chat/Messages/Content/Parts';
import RunCode from '~/components/Messages/Content/RunCode';
import { useLocalize } from '~/hooks';
import cn from '~/utils/cn';

type CodeBlockProps = Pick<
  CodeBarProps,
  'lang' | 'plugin' | 'error' | 'allowExecution' | 'blockIndex'
> & {
  codeChildren: React.ReactNode;
  classProp?: string;
};

const CODE_EXTENSION_BY_LANG: Record<string, string> = {
  bash: 'sh',
  csharp: 'cs',
  javascript: 'js',
  jsx: 'jsx',
  markdown: 'md',
  python: 'py',
  shell: 'sh',
  sh: 'sh',
  tsx: 'tsx',
  typescript: 'ts',
  yaml: 'yml',
};

function downloadCode(lang: string, codeRef: React.RefObject<HTMLElement>) {
  const codeString = codeRef.current?.textContent;
  if (!codeString) {
    return;
  }
  const normalizedLang = (lang || 'txt').toLowerCase();
  const ext = CODE_EXTENSION_BY_LANG[normalizedLang] ?? normalizedLang.replace(/[^a-z0-9]/g, '') ?? 'txt';
  const filename = `nash-code.${ext || 'txt'}`;
  const blob = new Blob([codeString.trimEnd()], { type: 'text/plain;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

const CodeBar: React.FC<CodeBarProps> = React.memo(
  ({ lang, error, codeRef, blockIndex, plugin = null, allowExecution = true }) => {
    const localize = useLocalize();
    const [isCopied, setIsCopied] = useState(false);
    return (
      <div className="relative flex items-center justify-between rounded-tl-md rounded-tr-md bg-gray-850 px-4 py-2 font-sans text-xs text-gray-400">
        <span className="uppercase tracking-wide">{lang}</span>
        {plugin === true ? (
          <InfoIcon className="ml-auto flex h-4 w-4 gap-2 text-white/50" />
        ) : (
          <div className="flex items-center justify-center gap-4">
            {allowExecution === true && (
              <RunCode lang={lang} codeRef={codeRef} blockIndex={blockIndex} />
            )}
            {/* §9: copy and download in the header, and nothing else. They
                carried their labels as text, which turned the header into a
                row of buttons competing with the language for attention.
                Icon-only, copy first — the commoner action sits nearer the
                code. The words survive as the accessible name and tooltip. */}
            <button
              type="button"
              aria-label={isCopied ? localize('com_ui_copied') : localize('com_ui_copy_code')}
              title={isCopied ? localize('com_ui_copied') : localize('com_ui_copy_code')}
              className={cn(
                'flex items-center rounded transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none',
                error === true ? 'h-4 w-4 items-start text-white/50' : '',
              )}
              onClick={async () => {
                const codeString = codeRef.current?.textContent;
                if (codeString != null) {
                  setIsCopied(true);
                  copy(codeString.trim(), { format: 'text/plain' });

                  setTimeout(() => {
                    setIsCopied(false);
                  }, 3000);
                }
              }}
            >
              {isCopied ? <CheckMark className="h-[15px] w-[15px]" /> : <Clipboard />}
            </button>
            <button
              type="button"
              aria-label={localize('com_ui_download')}
              title={localize('com_ui_download')}
              className="flex items-center rounded transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              onClick={() => downloadCode(lang, codeRef)}
            >
              <Download className="h-[15px] w-[15px]" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    );
  },
);

const CodeBlock: React.FC<CodeBlockProps> = ({
  lang,
  blockIndex,
  codeChildren,
  classProp = '',
  allowExecution = true,
  plugin = null,
  error,
}) => {
  const codeRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolCallsMap = useToolCallsMapContext();
  const { messageId, partIndex } = useMessageContext();
  const key = allowExecution
    ? `${messageId}_${partIndex ?? 0}_${blockIndex ?? 0}_${Tools.execute_code}`
    : '';
  const [currentIndex, setCurrentIndex] = useState(0);

  const fetchedToolCalls = toolCallsMap?.[key];
  const [toolCalls, setToolCalls] = useState(toolCallsMap?.[key] ?? null);

  useEffect(() => {
    if (fetchedToolCalls) {
      setToolCalls(fetchedToolCalls);
      setCurrentIndex(fetchedToolCalls.length - 1);
    }
  }, [fetchedToolCalls]);

  const currentToolCall = useMemo(() => toolCalls?.[currentIndex], [toolCalls, currentIndex]);

  const next = () => {
    if (!toolCalls) {
      return;
    }
    if (currentIndex < toolCalls.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const previous = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const isNonCode = !!(plugin === true || error === true);
  const language = isNonCode ? 'json' : lang;

  return (
    <div
      ref={containerRef}
      className="relative min-w-0 max-w-full overflow-hidden rounded-md bg-gray-900 text-xs text-white/80"
    >
      <CodeBar
        lang={lang}
        error={error}
        codeRef={codeRef}
        blockIndex={blockIndex}
        plugin={plugin === true}
        allowExecution={allowExecution}
      />
      <div className={cn(classProp, 'max-w-full overflow-x-auto overflow-y-auto p-4')}>
        <code
          ref={codeRef}
          className={cn(
            'block',
            isNonCode ? '!whitespace-pre-wrap' : `hljs language-${language} !whitespace-pre`,
          )}
        >
          {codeChildren}
        </code>
      </div>
      {/* No second set of actions. §9 puts the language label and copy +
          download in the header, and that header is always visible — a
          hover-revealed copy floating over the code duplicated every control
          the header already had, so a code block showed Run, copy and download
          twice the moment the pointer entered it. */}
      {allowExecution === true && toolCalls && toolCalls.length > 0 && (
        <>
          <div className="bg-gray-700 p-4 text-xs">
            <div
              className="prose flex flex-col-reverse text-white"
              style={{
                color: 'white',
              }}
            >
              <pre className="shrink-0">
                <LogContent
                  output={(currentToolCall?.result as string | undefined) ?? ''}
                  attachments={currentToolCall?.attachments ?? []}
                  renderImages={true}
                />
              </pre>
            </div>
          </div>
          {toolCalls.length > 1 && (
            <ResultSwitcher
              currentIndex={currentIndex}
              totalCount={toolCalls.length}
              onPrevious={previous}
              onNext={next}
            />
          )}
        </>
      )}
    </div>
  );
};

export default CodeBlock;
