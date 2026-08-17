import React, { memo, useMemo, useRef, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { PermissionTypes, Permissions, apiBaseUrl, FileSources } from 'librechat-data-provider';
import MermaidErrorBoundary from '~/components/Messages/Content/MermaidErrorBoundary';
import CodeBlock from '~/components/Messages/Content/CodeBlock';
import Mermaid from '~/components/Messages/Content/Mermaid';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import { useCodeBlockContext } from '~/Providers';
import {
  getFileType,
  getDownloadableFile,
  handleDoubleClick,
  shouldGenerateFileExport,
} from '~/utils';
import DownloadableImage from './DownloadableImage';
import DownloadableFileCard from './DownloadableFileCard';
import { useAttachmentLink } from './Parts/LogLink';
import { resolveImageSource } from './imageUrl';
import store from '~/store';

type TCodeProps = {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
};

export const code: React.ElementType = memo(({ className, children }: TCodeProps) => {
  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];
  const isMath = lang === 'math';
  const isMermaid = lang === 'mermaid';
  const isSingleLine = typeof children === 'string' && children.split('\n').length === 1;

  const { getNextIndex, resetCounter } = useCodeBlockContext();
  const blockIndex = useRef(getNextIndex(isMath || isMermaid || isSingleLine)).current;

  useEffect(() => {
    resetCounter();
  }, [children, resetCounter]);

  if (lang === 'export') {
    return null;
  } else if (isMath) {
    return <>{children}</>;
  } else if (isMermaid) {
    const content = typeof children === 'string' ? children : String(children);
    return (
      <MermaidErrorBoundary code={content}>
        <Mermaid id={`mermaid-${blockIndex}`}>{content}</Mermaid>
      </MermaidErrorBoundary>
    );
  } else if (isSingleLine) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return (
      <CodeBlock
        lang={lang ?? 'text'}
        codeChildren={children}
        blockIndex={blockIndex}
        allowExecution={canRunCode}
      />
    );
  }
});

export const codeNoExecution: React.ElementType = memo(({ className, children }: TCodeProps) => {
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];

  if (lang === 'export') {
    return null;
  } else if (lang === 'math') {
    return children;
  } else if (lang === 'mermaid') {
    const content = typeof children === 'string' ? children : String(children);
    return <Mermaid>{content}</Mermaid>;
  } else if (typeof children === 'string' && children.split('\n').length === 1) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return <CodeBlock lang={lang ?? 'text'} codeChildren={children} allowExecution={false} />;
  }
});

type TAnchorProps = {
  href: string;
  children: React.ReactNode;
  exportContent?: string;
};

type ResolvedDownload = {
  isFile: boolean;
  file_id: string;
  filename: string;
  downloadUrl: string;
  source?: string;
  exportContent?: string;
};

/** Flatten a markdown anchor's children down to its visible text. */
function anchorText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(anchorText).join('');
  }
  if (React.isValidElement(node)) {
    return anchorText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

export const a: React.ElementType = memo(({ href, children, exportContent }: TAnchorProps) => {
  const user = useRecoilValue(store.user);

  const resolved = useMemo<ResolvedDownload>(() => {
    // 1. A real Nash file path → authenticated /api/files download.
    if (user?.id) {
      const match = href.match(new RegExp(`(?:files|outputs)/${user.id}/([^\\s]+)`));
      if (match && match[0]) {
        const filepath = match[0];
        const parts = filepath.split('/');
        const filename = parts.pop() ?? '';
        const file_id = parts.pop() ?? '';
        const base = `${apiBaseUrl()}/api`;
        return {
          isFile: true,
          file_id,
          filename,
          downloadUrl: filepath.startsWith('files/')
            ? `${base}/${filepath}`
            : `${base}/files/${filepath}`,
          source: FileSources.local,
        };
      }
    }

    // 2. A file the assistant offered as a plain link, e.g. "[sample.html](sample.html)".
    //    Render the download card too; the download streams from the href.
    const file = getDownloadableFile(href, anchorText(children));
    if (file) {
      return {
        isFile: true,
        file_id: '',
        filename: file.filename,
        downloadUrl: href,
        exportContent: shouldGenerateFileExport(href) ? exportContent : undefined,
      };
    }

    return {
      isFile: false,
      file_id: '',
      filename: '',
      downloadUrl: '',
    };
  }, [user?.id, href, children, exportContent]);

  const { handleDownload } = useAttachmentLink({
    href: resolved.downloadUrl,
    filename: resolved.filename,
    file_id: resolved.file_id,
    user: user?.id,
    source: resolved.source,
    exportContent: resolved.exportContent,
  });

  if (!resolved.isFile) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  const extension = resolved.filename.split('.').pop();
  const fileType = getFileType(extension);
  const meta = [fileType.title, extension?.toUpperCase()].filter(Boolean).join(' · ');

  return (
    <DownloadableFileCard
      filename={resolved.filename}
      meta={meta}
      fileType={fileType}
      onDownload={handleDownload}
    />
  );
});

type TParagraphProps = {
  children: React.ReactNode;
};

export const p: React.ElementType = memo(({ children }: TParagraphProps) => {
  return <p className="mb-2 whitespace-pre-wrap">{children}</p>;
});

type TPreProps = {
  children: React.ReactNode;
};

export const pre: React.ElementType = memo(({ children }: TPreProps) => {
  return (
    <pre className="m-0 min-w-0 max-w-full overflow-hidden bg-transparent p-0">
      {children}
    </pre>
  );
});

type TTableProps = {
  children: React.ReactNode;
};

export const table: React.ElementType = memo(({ children }: TTableProps) => {
  return (
    <div className="max-w-full overflow-x-auto">
      <table>{children}</table>
    </div>
  );
});

type TImageProps = {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

export const img: React.ElementType = memo(({ src, alt, title, className }: TImageProps) => {
  const fixedSrc = useMemo(() => {
    return resolveImageSource(src);
  }, [src]);

  if (!fixedSrc) {
    return null;
  }

  // Nash-owned image renderer: every chat image — whether the model wrote it
  // inline via markdown or it arrived as a generated-media attachment — gets
  // the same lightbox + always-visible download button. The LLM has no say in
  // the download UI, which is the whole point.
  return <DownloadableImage src={fixedSrc} alt={alt || title} className={className} variant="inline" />;
});
