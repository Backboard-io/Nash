import React, { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { Label, OGDialog, OGDialogTrigger, OGDialogTemplate } from '@librechat/client';
import type t from 'librechat-data-provider';
import { useLocalize, TranslationKeys, useAgentCategories } from '~/hooks';
import { cn, renderAgentAvatar } from '~/utils';
/* §4. **Use** is the card's primary — --t1 fill on --app text. **Install** is
   `.ghost.outlined`: the step before the thing you came for, not the thing
   itself, and a grid of white Install buttons made every uninstalled card
   shout louder than the one you had already set up. */
import { primaryAction, secondaryAction } from '~/components/ui/actionButton';
import { isEphemeralAgent } from '~/common';
import AgentDetailContent from './AgentDetailContent';
import AgentCardMenu from './AgentCardMenu';

interface AgentCardProps {
  agent: t.Agent;
  onSelect?: (agent: t.Agent) => void;
  onStartChat?: () => void;
  onDelete?: (agentId: string) => void;
  /** Start using the persona (begin a chat). Falls back to opening the detail dialog. */
  onUse?: (agent: t.Agent) => void;
  /** Open the persona in the editor. Offered in the ⋯ menu. */
  onEdit?: (agent: t.Agent) => void;
  /** Copy the persona into a new one the user owns. Offered in the ⋯ menu. */
  onDuplicate?: (agent: t.Agent) => void;
  /**
   * Who to credit under the name when the persona carries no author of its own
   * — the signed-in user, because they wrote it.
   */
  ownerName?: string;
  /**
   * Install a catalogue persona — copy the template into the user's own
   * personas. Explore cards lead with this instead of Use: the catalogue rows
   * are read-only templates that belong to nobody, so "using" one directly was
   * starting a chat against an agent the account does not have.
   */
  onInstall?: (agent: t.Agent) => void;
  /** The user's copy of this template, once they have installed it. */
  installedAgent?: t.Agent;
  /** This card's install is in flight. */
  isInstalling?: boolean;
  /** Owned personas show Use + Edit; explore personas show Install, then Use. */
  variant?: 'owned' | 'explore';
  /** Grid keeps the stacked card; list lays the same parts out in a row. */
  view?: 'grid' | 'list';
  className?: string;
}

/**
 * A persona card: avatar · name · byline · 2-line description · actions.
 *
 * §3's card rhythm, literally — 16 of padding, one 12px gap on the container,
 * no child carrying its own margin. It used to pin the action row to the
 * bottom with `mt-auto` over a full-bleed divider, which §3 rules out by name:
 * a grid stretches cards to match, so pinning the footer opened a hole in the
 * middle of every card whose description ran short, and the divider drew a line
 * across it to make sure you looked. The actions are now just the last child at
 * the same gap, and short cards are padded by the grid rather than from inside.
 */
const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onSelect,
  onStartChat,
  onDelete,
  onUse,
  onEdit,
  onDuplicate,
  ownerName,
  onInstall,
  installedAgent,
  isInstalling = false,
  variant = 'owned',
  view = 'grid',
  className = '',
}) => {
  const localize = useLocalize();
  const { categories } = useAgentCategories();
  const [isOpen, setIsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = onDelete != null && !isEphemeralAgent(agent.id ?? '');
  const isList = view === 'list';

  /**
   * The line under the name. A persona Backboard ships is signed "Backboard";
   * anything else falls back to its category. The category was the only thing
   * here, which meant every card in the Pre-built tab repeated the word
   * "Prebuilt" under its own name — a subtitle that restated the tab heading
   * and told you nothing about the card it was on.
   */
  const authorName = (agent as { author_name?: string }).author_name;

  /**
   * An installed persona is somebody else's work sitting in your list. It keeps
   * their name and it is **read-only** — editing it would quietly fork the
   * catalogue copy while still crediting the original author for whatever you
   * changed. Duplicate is the way to make an editable one, and that copy is
   * yours and signed accordingly. Edit still *appears* in the menu, greyed with
   * a tooltip pointing at Duplicate; §4 says disabled means unreachable, not
   * hidden.
   */
  const isInstalledCopy = (agent as { installed_from?: string }).installed_from != null;

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

  /**
   * Backboard signs what Backboard ships, and that survives installation — the
   * user did not write those instructions. A persona with no author is one the
   * user wrote, so it is signed with their name. Category is the last resort.
   */
  const byline = authorName ?? (variant === 'owned' ? ownerName : undefined) ?? categoryLabel;
  const canEdit = onEdit != null && !isInstalledCopy;

  /**
   * A catalogue persona is installed before it can be used, and Use then runs
   * against the user's own copy rather than the template — the template has no
   * owner, so chatting with it directly asks the backend for an agent the
   * account does not have.
   */
  const needsInstall = variant === 'explore' && installedAgent == null;

  const handleUse = (target: t.Agent) =>
    onUse?.(variant === 'explore' ? (installedAgent ?? target) : target);

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
    <>
    <OGDialog open={isOpen} onOpenChange={handleOpenChange}>
      <OGDialogTrigger asChild>
        <div
          className={cn(
            /* §3: a card is radius 13 with 16 of padding and one 12px gap;
               §1 puts it on --surface, one step above the page, rising a single
               step to --elevated under the pointer. It was radius 16 on --hover,
               which is the pointer fill — so a card at rest already looked
               hovered, and hovering it moved nowhere new. */
            /* No `overflow-hidden`. The ⋯ menu is absolutely positioned inside
               this card, so clipping to the card's box cut the menu off — and
               in list view, where the row is barely taller than the trigger,
               clipped it away entirely so nothing appeared at all. The radius
               still clips the card's own background; the avatar tile does its
               own clipping. */
            'group relative rounded-[13px]',
            /* The Bookmarks folder card's geometry, exactly: padding 16, one
               12px gap, radius 13. This card had been sized independently and
               kept being adjusted by eye — the fix is to stop having a second
               opinion about it. */
            'cursor-pointer select-none p-4',
            'nash-card transition-colors duration-hover hover:bg-surface-hover',
            /* A list row is the same parts on one line: header, then the
               description taking the slack, then the action at the end. */
            isList
              ? 'flex flex-row items-center gap-4'
              : 'flex h-full flex-col gap-3',
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
          {/* The ⋯, top right. Edit and Duplicate live here now, and Delete
              behind the confirm — a lone trash glyph made the destructive
              action the easiest thing on the card to hit. */}
          {(onEdit || onDuplicate || canDelete) && (
            <div
              /* A list row is one line, so the ⋯ sits in it and centres with
                 everything else. Pinned to the corner it floated at the top of
                 a 66px row instead of beside the action it belongs to. */
              className={cn(
                'z-10 flex items-center',
                isList ? 'order-last shrink-0' : 'absolute right-3 top-3',
              )}
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <AgentCardMenu
                onEdit={canEdit ? () => onEdit?.(agent) : undefined}
                editDisabledHint={
                  onEdit != null && !canEdit ? localize('com_agents_edit_locked') : undefined
                }
                onDuplicate={onDuplicate ? () => onDuplicate(agent) : undefined}
                onDelete={canDelete ? () => setConfirmDelete(true) : undefined}
              />
            </div>
          )}

          {/* "Installed" is a chip in the corner, not a word wedged into the
              byline — beside the author it read as part of the author's name
              ("Backboard ✓ Installed") and pushed a two-word line to four. */}
          {variant === 'explore' && installedAgent != null && (
            <span
              /* Inline in a list row: the corner is where the action already
                 is, so an absolutely-placed chip landed on top of Use. */
              className={cn(
                'z-10 flex shrink-0 items-center gap-[4px] rounded-[7px] bg-surface-active px-[9px] py-[4px] text-[11.5px] font-medium leading-[16px] text-text-secondary',
                isList ? 'order-1' : 'absolute right-3 top-3',
              )}
            >
              <Check className="size-3 shrink-0" aria-hidden="true" />
              {localize('com_ui_installed')}
            </span>
          )}

          {/* Header: avatar + name + byline. The 4px between a label and the
              value under it (§3) — not the 12 that separates the card's blocks,
              which is the gap the container is already carrying. */}
          <div className={cn('flex items-center gap-2', isList ? 'w-[220px] shrink-0' : 'pr-6')}>
            {/* The 26px tile the Bookmarks folder card puts its glyph in. The
                avatar was `size: 'sm'`, which is 48–56px — most of why this
                card kept reading as tall however the padding was tuned. */}
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center overflow-hidden rounded-[8px] bg-surface-hover text-text-secondary group-hover:bg-surface-active">
              {renderAgentAvatar(agent, { size: 'icon', showBorder: false })}
            </span>
            {/* 2, not 4. §3 gives a label and its value 4, but that assumes
                two lines of similar weight; a 15px semibold name over a 12.5px
                byline already separates itself by size, and the 4 read as a
                gap rather than as one block. */}
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <Label className="line-clamp-1 cursor-pointer text-[14px] font-medium leading-[21px] text-text-primary">
                {agent.name}
              </Label>
              {byline && (
                /* --t4, under a 13.5 name: §2's meta line. It was 14px --t2,
                   which made the subtitle louder than the title above it. */
                <span className="line-clamp-1 text-[12px] leading-[17px] text-text-tertiary">
                  {byline}
                </span>
              )}
            </div>
          </div>

          {/* Description. §3.2: no description, no slot — the card is shorter
              rather than holding an empty gap open. */}
          {agent.description && (
            <p
              id={`agent-${agent.id}-description`}
              className={cn(
                'text-[12.5px] leading-[20px] text-text-secondary-alt',
                isList ? 'line-clamp-1 min-w-0 flex-1' : 'line-clamp-2',
              )}
              aria-label={localize('com_agents_description_card', {
                description: agent.description,
              })}
            >
              {agent.description}
            </p>
          )}

          {/* Actions — one more child at the card's gap, no divider and no
              footer pin. §4 `.primary.sm` for the card's one action: a --t1
              fill with --app text, the same treatment as "New folder". It
              cannot collide with the card underneath it the way the old
              --elevated fill did, because it is not on the surface ladder at
              all. Edit stays `.ghost` — one primary per card. */}
          {/* §3: the gap belongs to the container. This carried `mt-1` on top of
              the card's 12px gap, so the action row sat 16 from the description
              while every other pair in the card sat at 12. */}
          {/* List order: header · description · Installed · action · ⋯. The
              right padding that used to sit here was clearing an absolutely
              positioned ⋯; both are in the flow now, so it goes. */}
          <div className={cn('flex items-center gap-2', isList && 'order-2 ml-auto shrink-0')}>
            {needsInstall ? (
              <button
                type="button"
                disabled={isInstalling}
                onClick={stop(onInstall, openDetail)}
                className={secondaryAction}
              >
                {isInstalling && <Spinner className="size-3.5" aria-hidden="true" />}
                {isInstalling ? localize('com_agents_installing') : localize('com_ui_install')}
              </button>
            ) : (
              <button
                type="button"
                onClick={stop(handleUse, openDetail)}
                className={primaryAction}
              >
                {localize('com_ui_use')}
              </button>
            )}
          </div>
        </div>
      </OGDialogTrigger>

      <AgentDetailContent
        agent={agent}
        onStartChat={onStartChat}
        onInstall={onInstall}
        installedAgent={installedAgent}
        isInstalling={isInstalling}
        variant={variant}
      />
    </OGDialog>

    {/* Controlled, because the ⋯ opens it rather than a trigger wrapping the
        card — a nested OGDialogTrigger inside the card's own trigger would make
        the whole card open the confirm. Mounted only when the card can actually
        be deleted. §7's destructive shape: the question with the subject in it,
        what else it affects, and a red verb. */}
    {canDelete && (
    <OGDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <OGDialogTemplate
        title={localize('com_ui_delete_persona_title', {
          0: agent.name || localize('com_ui_agent'),
        })}
        className="w-11/12 max-w-[450px]"
        main={
          <p className="text-left text-[13.5px] leading-[20px] text-text-secondary">
            {localize('com_ui_delete_persona_body')}
          </p>
        }
        selection={{
          selectHandler: () => onDelete?.(agent.id ?? ''),
          selectClasses:
            'bg-surface-destructive hover:bg-surface-destructive-hover text-white',
          selectText: localize('com_ui_delete'),
        }}
      />
    </OGDialog>
    )}
    </>
  );
};

export default AgentCard;
