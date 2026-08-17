import { useState, useRef, useEffect, useMemo, memo, useCallback } from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { Spinner, useCombobox } from '@librechat/client';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import type { TPromptGroup } from 'librechat-data-provider';
import type { PromptOption } from '~/common';
import VariableDialog from '~/components/Prompts/Groups/VariableDialog';
import { removeCharIfLast, detectVariables } from '~/utils';
import { usePromptGroupsContext } from '~/Providers';
import MentionItem from './MentionItem';
import { useLocalize } from '~/hooks';
import store from '~/store';

const commandChar = '/';

const PopoverContainer = memo(
  ({
    index,
    children,
    isVariableDialogOpen,
    variableGroup,
    setVariableDialogOpen,
    textAreaRef,
  }: {
    index: number;
    children: React.ReactNode;
    isVariableDialogOpen: boolean;
    variableGroup: TPromptGroup | null;
    setVariableDialogOpen: (isOpen: boolean) => void;
    textAreaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  }) => {
    const showPromptsPopover = useRecoilValue(store.showPromptsPopoverFamily(index));
    return (
      <>
        {showPromptsPopover ? children : null}
        <VariableDialog
          open={isVariableDialogOpen}
          onClose={() => {
            setVariableDialogOpen(false);
            requestAnimationFrame(() => {
              textAreaRef.current?.focus();
            });
          }}
          group={variableGroup}
        />
      </>
    );
  },
);

const ROW_HEIGHT = 44;

function PromptsCommand({
  index,
  textAreaRef,
  submitPrompt,
}: {
  index: number;
  textAreaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  submitPrompt: (textPrompt: string) => void;
}) {
  const localize = useLocalize();
  const { allPromptGroups, hasAccess } = usePromptGroupsContext();
  const { data, isLoading } = allPromptGroups;
  const showPromptsPopover = useRecoilValue(store.showPromptsPopoverFamily(index));

  const [activeIndex, setActiveIndex] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isVariableDialogOpen, setVariableDialogOpen] = useState(false);
  const [variableGroup, setVariableGroup] = useState<TPromptGroup | null>(null);
  const setShowPromptsPopover = useSetRecoilState(store.showPromptsPopoverFamily(index));

  const promptFilterInputId = `chat-prompt-command-filter-${index}`;

  const prompts = useMemo(() => data?.promptGroups, [data]);
  const promptsMap = useMemo(() => data?.promptsMap, [data]);

  const { open, setOpen, searchValue, setSearchValue, matches } = useCombobox({
    value: '',
    options: prompts ?? [],
  });

  const handleSelect = useCallback(
    (group?: TPromptGroup, e?: React.KeyboardEvent<HTMLInputElement>) => {
      if (!group) {
        return;
      }

      setSearchValue('');
      setOpen(false);
      setShowPromptsPopover(false);

      if (textAreaRef.current) {
        removeCharIfLast(textAreaRef.current, commandChar);
      }

      const hasVariables = detectVariables(group.productionPrompt?.prompt ?? '');
      if (hasVariables) {
        if (e && e.key === 'Tab') {
          e.preventDefault();
        }
        setVariableGroup(group);
        setVariableDialogOpen(true);
        return;
      } else {
        submitPrompt(group.productionPrompt?.prompt ?? '');
      }
    },
    [setSearchValue, setOpen, setShowPromptsPopover, textAreaRef, submitPrompt],
  );

  useEffect(() => {
    if (!showPromptsPopover) {
      return;
    }
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [showPromptsPopover]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(0);
    } else {
      setVariableGroup(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!matches.length) {
      return;
    }
    const currentActiveItem = document.getElementById(`prompt-item-${activeIndex}`);
    currentActiveItem?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }, [activeIndex, matches.length]);

  if (!hasAccess) {
    return null;
  }

  const rowRenderer = ({
    index,
    key,
    style,
  }: {
    index: number;
    key: string;
    style: React.CSSProperties;
  }) => {
    const mention = matches[index] as PromptOption;
    const group = promptsMap?.[mention.id];
    return (
      <MentionItem
        index={index}
        type="prompt"
        key={key}
        style={style}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }
          timeoutRef.current = null;
          handleSelect(group);
        }}
        name={mention.label ?? ''}
        icon={mention.icon}
        description={mention.description}
        isActive={index === activeIndex}
      />
    );
  };

  return (
    <PopoverContainer
      index={index}
      isVariableDialogOpen={isVariableDialogOpen}
      variableGroup={variableGroup}
      setVariableDialogOpen={setVariableDialogOpen}
      textAreaRef={textAreaRef}
    >
      <div className="absolute bottom-28 z-50 w-full space-y-2 isolate">
        <div
          className="popover border-token-border-light rounded-2xl border bg-surface-tertiary-alt p-2 shadow-lg"
          onMouseDown={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <input
            // The user expects focus to transition to the input field when the popover is opened
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            ref={inputRef}
            id={promptFilterInputId}
            name={`promptCommandFilter-${index}`}
            placeholder={localize('com_ui_command_usage_placeholder')}
            className="mb-1 w-full border-0 bg-surface-tertiary-alt p-2 text-sm focus:outline-none dark:text-gray-200"
            autoComplete="off"
            value={searchValue}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                setShowPromptsPopover(false);
                textAreaRef.current?.focus();
              }
              if (e.key === 'ArrowDown') {
                if (!matches.length) {
                  return;
                }
                e.preventDefault();
                setActiveIndex((prevIndex) => (prevIndex + 1) % matches.length);
              } else if (e.key === 'ArrowUp') {
                if (!matches.length) {
                  return;
                }
                e.preventDefault();
                setActiveIndex((prevIndex) => (prevIndex - 1 + matches.length) % matches.length);
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                const activeMention = matches[activeIndex] as PromptOption | undefined;
                const activeGroup = activeMention ? promptsMap?.[activeMention.id] : undefined;
                handleSelect(activeGroup, e);
              } else if (e.key === 'Backspace' && searchValue === '') {
                e.preventDefault();
                setOpen(false);
                setShowPromptsPopover(false);
                textAreaRef.current?.focus();
              }
            }}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              timeoutRef.current = setTimeout(() => {
                setOpen(false);
                setShowPromptsPopover(false);
              }, 500);
            }}
          />
          <div className="max-h-40 overflow-y-auto">
            {(() => {
              if (isLoading && open) {
                return (
                  <div className="flex h-32 items-center justify-center text-text-primary">
                    <Spinner />
                  </div>
                );
              }

              if (!isLoading && open) {
                return (
                  <div className="max-h-40">
                    <AutoSizer disableHeight>
                      {({ width }) => (
                        <List
                          width={width}
                          overscanRowCount={5}
                          rowHeight={ROW_HEIGHT}
                          rowCount={matches.length}
                          rowRenderer={rowRenderer}
                          scrollToIndex={activeIndex}
                          height={Math.min(matches.length * ROW_HEIGHT, 160)}
                        />
                      )}
                    </AutoSizer>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        </div>
      </div>
    </PopoverContainer>
  );
}

export default memo(PromptsCommand);
