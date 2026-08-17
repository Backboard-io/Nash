import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Label, OGDialog, OGDialogTrigger, OGDialogTemplate } from '@librechat/client';
import type t from 'librechat-data-provider';
import { useLocalize, TranslationKeys, useAgentCategories } from '~/hooks';
import { cn, renderAgentAvatar } from '~/utils';
import { isEphemeralAgent } from '~/common';
import AgentDetailContent from './AgentDetailContent';

interface AgentCardProps {
  agent: t.Agent;
  onSelect?: (agent: t.Agent) => void;
  onStartChat?: () => void;
  onDelete?: (agentId: string) => void;
  /** Start using the persona (begin a chat). Falls back to opening the detail dialog. */
  onUse?: (agent: t.Agent) => void;
  /** Open the persona in the editor. When provided, an "Edit" action is shown. */
  onEdit?: (agent: t.Agent) => void;
  /** Owned personas show Use + Edit; explore personas show Use. */
  variant?: 'owned' | 'explore';
  className?: string;
}

/**
 * Card component to display persona (agent) information with inline actions and
 * an integrated detail dialog. Matches the teal Persona Marketplace design:
 * teal avatar · title · category subtitle · 2-line description · divider · actions.
 */
const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onSelect,
  onStartChat,
  onDelete,
  onUse,
  onEdit,
  variant = 'owned',
  className = '',
}) => {
  const localize = useLocalize();
  const { categories } = useAgentCategories();
  const [isOpen, setIsOpen] = useState(false);

  const categoryLabel = useMemo(() => {
    if (!agent.category) {
      return '';
    }
    const category = categories.find((cat) => cat.value === agent.category);
    if (category) {
      if (category.label && category.label.startsWith('com_')) {
        return localize(category.label as TranslationKeys);
      }
      return category.label;
    }
    return agent.category.charAt(0).toUpperCase() + agent.category.slice(1);
  }, [agent.category, categories, localize]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open && onSelect) {
      onSelect(agent);
    }
  };

  const openDetail = () => {
    handleOpenChange(true);
  };

  const stop = (handler?: (agent: t.Agent) => void, fallback?: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (handler) {
      handler(agent);
    } else if (fallback) {
      fallback();
    }
  };

  return (
    <OGDialog open={isOpen} onOpenChange={handleOpenChange}>
      <OGDialogTrigger asChild>
        <div
          className={cn(
            'group relative flex h-full flex-col overflow-hidden rounded-2xl',
            'cursor-pointer select-none p-5',
            'bg-surface-tertiary transition-colors duration-150 hover:bg-surface-hover',
            className,
          )}
          aria-label={localize('com_agents_agent_card_label', {
            name: agent.name,
            description: agent.description ?? '',
          })}
          aria-describedby={agent.description ? `agent-${agent.id}-description` : undefined}
          tabIndex={0}
          role="button"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsOpen(true);
            }
          }}
        >
          {/* Delete action: hover on desktop, always visible on mobile */}
          {onDelete && !isEphemeralAgent(agent.id ?? '') && (
            <div
              className="absolute right-3 top-3 z-10 flex items-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <OGDialog>
                <OGDialogTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-destructive"
                    aria-label={localize('com_ui_delete_agent')}
                    title={localize('com_ui_delete_agent')}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </OGDialogTrigger>
                <OGDialogTemplate
                  title={localize('com_ui_delete_agent')}
                  className="max-w-[450px]"
                  main={
                    <p className="text-left text-sm text-text-secondary">
                      {localize('com_ui_delete_agent_confirm')}
                    </p>
                  }
                  selection={{
                    selectHandler: () => onDelete(agent.id ?? ''),
                    selectClasses:
                      'bg-surface-destructive hover:bg-surface-destructive-hover text-white',
                    selectText: localize('com_ui_delete'),
                  }}
                />
              </OGDialog>
            </div>
          )}

          {/* Header: avatar + title + category */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <div className="overflow-hidden rounded-full">
                {renderAgentAvatar(agent, { size: 'sm', showBorder: false })}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <Label className="line-clamp-1 cursor-pointer text-[13px] font-semibold leading-none text-text-primary">
                {agent.name}
              </Label>
              {categoryLabel && (
                <span className="mt-1 text-sm font-normal text-text-secondary">{categoryLabel}</span>
              )}
            </div>
          </div>

          {/* Description */}
          {agent.description && (
            <p
              id={`agent-${agent.id}-description`}
              className="mt-3 line-clamp-2 text-sm font-light leading-relaxed text-text-secondary"
              aria-label={localize('com_agents_description_card', {
                description: agent.description,
              })}
            >
              {agent.description}
            </p>
          )}

          {/* Divider + action row */}
          <div className="mt-auto pt-4">
            <div className="-mx-5 border-t border-border-light" />
            <div className="mt-3 flex items-center gap-1">
              <button
                type="button"
                onClick={stop(onUse, openDetail)}
                className="rounded-lg bg-surface-hover px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-active-alt"
              >
                {localize('com_ui_use')}
              </button>
              {onEdit && (
                <button
                  type="button"
                  onClick={stop(onEdit, openDetail)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                >
                  {localize('com_ui_edit')}
                </button>
              )}
            </div>
          </div>
        </div>
      </OGDialogTrigger>

      <AgentDetailContent agent={agent} onStartChat={onStartChat} />
    </OGDialog>
  );
};

export default AgentCard;
