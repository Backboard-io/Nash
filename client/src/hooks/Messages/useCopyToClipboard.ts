import { useCallback, useEffect, useRef } from 'react';
import copy from 'copy-to-clipboard';
import {
  ContentTypes,
  SearchResultData,
  parseEphemeralAgentId,
  stripAgentIdSuffix,
} from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import {
  SPAN_REGEX,
  CLEANUP_REGEX,
  COMPOSITE_REGEX,
  STANDALONE_PATTERN,
  INVALID_CITATION_REGEX,
} from '~/utils/citations';

type Source = {
  link: string;
  title: string;
  attribution?: string;
  type: string;
  typeIndex: number;
  citationKey: string; // Used for deduplication
};

function getRenderedHtml(messageId?: string | null): string | null {
  if (!messageId) {
    return null;
  }
  const container = document.getElementById(messageId);
  if (!container) {
    return null;
  }
  const contentEl = container.querySelector('.message-content');
  if (!contentEl) {
    return null;
  }
  const clone = contentEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, .copy-button, .hover-button').forEach((el) => el.remove());
  // Wrap with explicit light-mode styles so Chrome doesn't inherit the dark page background on paste
  return `<div style="background-color:white;color:#111111;">${clone.innerHTML}</div>`;
}

function copyWithRichText(plainText: string, messageId?: string | null): void {
  const html = getRenderedHtml(messageId);
  if (html && typeof navigator.clipboard?.write === 'function') {
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([plainText], { type: 'text/plain' });
    navigator.clipboard
      .write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })])
      .catch(() => {
        copy(plainText, { format: 'text/plain' });
      });
  } else {
    copy(plainText, { format: 'text/plain' });
  }
}

const refTypeMap: Record<string, string> = {
  search: 'organic',
  ref: 'references',
  news: 'topStories',
  image: 'images',
  video: 'videos',
};

function labelForAgentId(agentId?: string): string {
  if (!agentId) {
    return 'Model';
  }
  const parsed = parseEphemeralAgentId(agentId);
  if (parsed) {
    return parsed.sender || parsed.model || 'Model';
  }
  return stripAgentIdSuffix(agentId) || 'Model';
}

/**
 * Flattens a message's content parts into copyable plain text. Parts that
 * share a groupId are parallel (compare-mode) columns — concatenating them
 * with a bare newline would merge two different models' answers into one
 * unattributed block, so those get a model-name label and a blank-line
 * separator instead. Ungrouped parts (the normal, single-model case) keep
 * the original plain join.
 */
function flattenContentForCopy(content: NonNullable<Pick<TMessage, 'content'>['content']>): string {
  const groups = new Map<number, { agentId?: string; text: string }[]>();
  const ungrouped: string[] = [];
  const groupedPieces: string[] = [];

  content.forEach((part) => {
    if (!part || part.type !== ContentTypes.TEXT) {
      return;
    }
    const textValue = typeof part.text === 'string' ? part.text : (part.text?.value ?? '');
    const groupId = (part as { groupId?: number }).groupId;
    if (groupId == null) {
      ungrouped.push(textValue);
      return;
    }
    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }
    groups.get(groupId)!.push({ agentId: (part as { agentId?: string }).agentId, text: textValue });
  });

  for (const parts of groups.values()) {
    if (parts.length <= 1) {
      groupedPieces.push(...parts.map((p) => p.text));
      continue;
    }
    groupedPieces.push(...parts.map((p) => `**${labelForAgentId(p.agentId)}:**\n${p.text}`));
  }

  const sections: string[] = [];
  if (ungrouped.length) {
    sections.push(ungrouped.join('\n'));
  }
  sections.push(...groupedPieces);
  return sections.join('\n\n');
}

export default function useCopyToClipboard({
  text,
  content,
  messageId,
  searchResults,
}: Partial<Pick<TMessage, 'text' | 'content'>> & {
  messageId?: string | null;
  searchResults?: { [key: string]: SearchResultData };
}) {
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const copyToClipboard = useCallback(
    (setIsCopied: React.Dispatch<React.SetStateAction<boolean>>) => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      setIsCopied(true);

      // Get the message text from content or text
      let messageText = text ?? '';
      if (content) {
        messageText = flattenContentForCopy(content);
      }

      // Early return if no search data
      if (!searchResults || Object.keys(searchResults).length === 0) {
        const cleanedText = messageText
          .replace(INVALID_CITATION_REGEX, '')
          .replace(CLEANUP_REGEX, '');

        copyWithRichText(cleanedText, messageId);
        copyTimeoutRef.current = setTimeout(() => {
          setIsCopied(false);
        }, 3000);
        return;
      }

      // Process citations and build a citation manager
      const citationManager = processCitations(messageText, searchResults);
      let processedText = citationManager.formattedText;

      // Add citations list at the end if we have any
      if (citationManager.citations.size > 0) {
        processedText += '\n\nCitations:\n';
        // Sort citations by their reference number
        const sortedCitations = Array.from(citationManager.citations.entries()).sort(
          (a, b) => a[1].referenceNumber - b[1].referenceNumber,
        );

        // Add each citation to the text
        for (const [_, citation] of sortedCitations) {
          processedText += `[${citation.referenceNumber}] ${citation.link}\n`;
        }
      }

      copyWithRichText(processedText, messageId);
      copyTimeoutRef.current = setTimeout(() => {
        setIsCopied(false);
      }, 3000);
    },
    [text, content, messageId, searchResults],
  );

  return copyToClipboard;
}

/**
 * Process citations in the text and format them properly
 */
function processCitations(text: string, searchResults: { [key: string]: SearchResultData }) {
  // Maps citation keys to their info including reference numbers
  const citations = new Map<
    string,
    {
      referenceNumber: number;
      link: string;
      title?: string;
      source: Source;
    }
  >();

  // Map to track URLs to citation keys for deduplication
  const urlToCitationKey = new Map<string, string>();

  let nextReferenceNumber = 1;
  let formattedText = text;

  // Step 1: Process highlighted text first (simplify by just making it bold in markdown)
  formattedText = formattedText.replace(SPAN_REGEX, (match) => {
    const text = match.replace(/\\ue203|\\ue204|\ue203|\ue204/g, '');
    return `**${text}**`;
  });

  // Step 2: Find all standalone citations and composite citation blocks
  const allCitations: Array<{
    turn: string;
    type: string;
    index: string;
    position: number;
    fullMatch: string;
    isComposite: boolean;
  }> = [];

  // Find standalone citations
  let standaloneMatch: RegExpExecArray | null;
  const standaloneCopy = new RegExp(STANDALONE_PATTERN.source, 'g');
  while ((standaloneMatch = standaloneCopy.exec(formattedText)) !== null) {
    allCitations.push({
      turn: standaloneMatch[1],
      type: standaloneMatch[2],
      index: standaloneMatch[3],
      position: standaloneMatch.index,
      fullMatch: standaloneMatch[0],
      isComposite: false,
    });
  }

  // Find composite citation blocks
  let compositeMatch: RegExpExecArray | null;
  const compositeCopy = new RegExp(COMPOSITE_REGEX.source, 'g');
  while ((compositeMatch = compositeCopy.exec(formattedText)) !== null) {
    const block = compositeMatch[0];
    const blockStart = compositeMatch.index;

    // Extract individual citations within the composite block
    let citationMatch: RegExpExecArray | null;
    const citationPattern = new RegExp(STANDALONE_PATTERN.source, 'g');
    while ((citationMatch = citationPattern.exec(block)) !== null) {
      allCitations.push({
        turn: citationMatch[1],
        type: citationMatch[2],
        index: citationMatch[3],
        position: blockStart + citationMatch.index,
        fullMatch: block, // Store the full composite block
        isComposite: true,
      });
    }
  }

  // Sort citations by their position in the text
  allCitations.sort((a, b) => a.position - b.position);

  // Step 3: Process each citation and build the reference mapping
  const processedCitations = new Set<string>();
  const replacements: Array<[string, string]> = [];
  const compositeCitationsMap = new Map<string, number[]>();

  for (const citation of allCitations) {
    const { turn, type, index, fullMatch, isComposite } = citation;
    const searchData = searchResults[turn];

    if (!searchData) continue;

    const dataType = refTypeMap[type.toLowerCase()] || type.toLowerCase();
    const idx = parseInt(index, 10);

    // Skip if no matching data
    if (!searchData[dataType] || !searchData[dataType][idx]) {
      continue;
    }

    // Get source data
    const sourceData = searchData[dataType][idx];
    const sourceUrl = sourceData.link || '';

    // Skip if no link
    if (!sourceUrl) continue;

    // Check if this URL has already been cited
    let citationKey = urlToCitationKey.get(sourceUrl);

    // If not, create a new citation key
    if (!citationKey) {
      citationKey = `${turn}-${dataType}-${idx}`;
      urlToCitationKey.set(sourceUrl, citationKey);
    }

    const source: Source = {
      link: sourceUrl,
      title: sourceData.title || sourceData.name || '',
      attribution: sourceData.attribution || sourceData.source || '',
      type: dataType,
      typeIndex: idx,
      citationKey,
    };

    // Skip if already processed this citation in a composite block
    if (isComposite && processedCitations.has(fullMatch)) {
      continue;
    }

    let referenceText = '';

    // Check if this source has been cited before
    let existingCitation = citations.get(citationKey);

    if (!existingCitation) {
      // New citation
      existingCitation = {
        referenceNumber: nextReferenceNumber++,
        link: source.link,
        title: source.title,
        source,
      };
      citations.set(citationKey, existingCitation);
    }

    if (existingCitation) {
      // For composite blocks, we need to find all citations and create a combined reference
      if (isComposite) {
        // Parse all citations in this composite block if we haven't processed it yet
        if (!processedCitations.has(fullMatch)) {
          const compositeCitations: number[] = [];
          let citationMatch: RegExpExecArray | null;
          const citationPattern = new RegExp(STANDALONE_PATTERN.source, 'g');

          while ((citationMatch = citationPattern.exec(fullMatch)) !== null) {
            const cTurn = citationMatch[1];
            const cType = citationMatch[2];
            const cIndex = citationMatch[3];
            const cDataType = refTypeMap[cType.toLowerCase()] || cType.toLowerCase();

            const cSource = searchResults[cTurn]?.[cDataType]?.[parseInt(cIndex, 10)];
            if (cSource && cSource.link) {
              // Check if we've already created a citation for this URL
              const cUrl = cSource.link;
              let cKey = urlToCitationKey.get(cUrl);

              if (!cKey) {
                cKey = `${cTurn}-${cDataType}-${cIndex}`;
                urlToCitationKey.set(cUrl, cKey);
              }

              let cCitation = citations.get(cKey);

              if (!cCitation) {
                cCitation = {
                  referenceNumber: nextReferenceNumber++,
                  link: cSource.link,
                  title: cSource.title || cSource.name || '',
                  source: {
                    link: cSource.link,
                    title: cSource.title || cSource.name || '',
                    attribution: cSource.attribution || cSource.source || '',
                    type: cDataType,
                    typeIndex: parseInt(cIndex, 10),
                    citationKey: cKey,
                  },
                };
                citations.set(cKey, cCitation);
              }

              if (cCitation) {
                compositeCitations.push(cCitation.referenceNumber);
              }
            }
          }

          // Sort and deduplicate the composite citations
          const uniqueSortedCitations = [...new Set(compositeCitations)].sort((a, b) => a - b);

          // Create combined reference numbers for all citations in this composite
          referenceText =
            uniqueSortedCitations.length > 0
              ? uniqueSortedCitations.map((num) => `[${num}]`).join('')
              : '';

          processedCitations.add(fullMatch);
          compositeCitationsMap.set(fullMatch, uniqueSortedCitations);
          replacements.push([fullMatch, referenceText]);
        }

        // Skip further processing since we've handled the entire composite block
        continue;
      } else {
        // Single citation
        referenceText = `[${existingCitation.referenceNumber}]`;
        replacements.push([fullMatch, referenceText]);
      }
    }
  }

  // Step 4: Apply all replacements (from longest to shortest to avoid nested replacement issues)
  replacements.sort((a, b) => b[0].length - a[0].length);
  for (const [pattern, replacement] of replacements) {
    formattedText = formattedText.replace(pattern, replacement);
  }

  // Step 5: Remove any orphaned composite blocks at the end of the text
  // This prevents the [1][2][3][4] list that might appear at the end if there's a composite there
  formattedText = formattedText.replace(/\n\s*\[\d+\](\[\d+\])*\s*$/g, '');

  // Step 6: Clean up any remaining citation markers
  formattedText = formattedText.replace(INVALID_CITATION_REGEX, '');
  formattedText = formattedText.replace(CLEANUP_REGEX, '');

  return {
    formattedText,
    citations,
  };
}
