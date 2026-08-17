import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MoreVertical,
  Pencil,
  PlugZap,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { Spinner, TooltipAnchor } from '@librechat/client';
import type { MCPServerStatus } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { popMenu } from '~/utils/motion';
import { cn } from '~/utils';

interface MCPCardActionsProps {
  serverName: string;
  serverStatus?: MCPServerStatus;
  isInitializing: boolean;
  canCancel: boolean;
  hasCustomUserVars: boolean;
  canEdit: boolean;
  /**
   * Focus returns here when the edit dialog closes. Typed for the element it
   * actually points at now — the ⋯ button — rather than the div the old icon
   * strip used.
   */
  editButtonRef?: React.MutableRefObject<HTMLDivElement | HTMLButtonElement | null>;
  onEditClick: (e: React.MouseEvent) => void;
  onConfigClick: (e: React.MouseEvent) => void;
  onInitialize: () => void;
  onCancel: (e: React.MouseEvent) => void;
  onRevoke?: () => void;
  onDelete?: (e: React.MouseEvent) => void;
}

/**
 * The ⋯ on an MCP server card — the same control the bookmark, persona, file
 * and memory cards carry, in the same corner.
 *
 * It replaces a strip of up to six icon buttons. Two of them were the same
 * trash can (Revoke OAuth access and Delete server), which is a coin flip
 * between "sign out of this" and "destroy this"; the rest needed a tooltip
 * each to be readable at all. In a menu every action states itself.
 *
 * The spinner stays inline while a server is connecting: that is status, not
 * an action, and it carries its own cancel.
 */
export default function MCPCardActions({
  serverName,
  serverStatus,
  isInitializing,
  canCancel,
  hasCustomUserVars,
  canEdit,
  editButtonRef,
  onEditClick,
  onConfigClick,
  onInitialize,
  onCancel,
  onRevoke,
  onDelete,
}: MCPCardActionsProps) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = 200;

  const connectionState = serverStatus?.connectionState;
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const isDisconnected = connectionState === 'disconnected';
  const isError = connectionState === 'error';

  /** §7: measured and drawn fixed, so a scrolling list cannot clip it. */
  const place = useCallback(() => {
    const trigger = wrapRef.current;
    if (trigger == null) {
      return;
    }
    const r = trigger.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 180;
    const below = r.bottom + 6;
    const flip = below + height > window.innerHeight - 8;
    setPos({
      top: flip ? Math.max(8, r.top - 6 - height) : below,
      left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) {
      place();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapRef.current?.contains(target) !== true &&
        menuRef.current?.contains(target) !== true
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const item = (
    key: string,
    Icon: React.ComponentType<any>,
    label: string,
    action?: (e: React.MouseEvent) => void,
    destructive = false,
  ) =>
    action == null ? null : (
      <button
        key={key}
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          action(e);
        }}
        className={cn(
          'flex w-full items-center gap-[10px] rounded-[8px] px-[10px] py-[9px] text-left text-[13px] leading-[19px] transition-colors',
          destructive
            ? 'text-text-destructive hover:bg-surface-active'
            : 'text-text-secondary hover:bg-surface-active hover:text-text-primary',
        )}
      >
        <Icon className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
        {label}
      </button>
    );

  /* Connecting: the spinner is the whole control, and cancels on hover. */
  if (isInitializing || isConnecting) {
    return canCancel ? (
      <TooltipAnchor
        description={localize('com_ui_cancel')}
        side="top"
        className="group grid size-7 place-items-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-active focus:outline-none"
        aria-label={localize('com_ui_cancel')}
        role="button"
        onClick={onCancel}
      >
        <div className="relative size-4">
          <Spinner className="size-4 group-hover:opacity-0" />
          <X className="absolute inset-0 size-4 text-text-destructive opacity-0 group-hover:opacity-100" />
        </div>
      </TooltipAnchor>
    ) : (
      <div className="grid size-7 place-items-center">
        <Spinner
          className="size-4"
          aria-label={localize('com_nav_mcp_status_connecting', { 0: serverName })}
        />
      </div>
    );
  }

  const revoke = serverStatus?.requiresOAuth && onRevoke ? () => onRevoke() : undefined;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        ref={editButtonRef as React.MutableRefObject<HTMLButtonElement | null>}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={localize('com_ui_more_options')}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          'grid size-7 place-items-center rounded-[7px] transition-colors',
          open
            ? 'bg-surface-active text-text-primary'
            : 'text-text-tertiary hover:bg-surface-active hover:text-text-primary',
        )}
      >
        <MoreVertical className="h-[15px] w-[15px]" aria-hidden="true" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              {...popMenu}
              ref={menuRef}
              role="menu"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
              className="fixed z-[200] rounded-[12px] bg-surface-hover p-[6px] shadow-[0_10px_28px_rgba(16,18,24,0.14)] ring-1 ring-inset ring-border-light dark:shadow-[0_12px_34px_rgba(0,0,0,0.4)] dark:ring-0"
            >
              {canEdit && item('edit', Pencil, localize('com_ui_edit'), onEditClick)}
              {(isDisconnected || isError) &&
                item('connect', PlugZap, localize('com_nav_mcp_connect'), () => onInitialize())}
              {isConnected &&
                item('reconnect', RefreshCw, localize('com_nav_mcp_reconnect'), () =>
                  onInitialize(),
                )}
              {isConnected &&
                hasCustomUserVars &&
                item('configure', SlidersHorizontal, localize('com_ui_configure'), onConfigClick)}
              {(revoke != null || onDelete != null) && (
                <div className="my-[5px] h-px bg-border-light" role="separator" />
              )}
              {/* Revoke and Delete used to be the same trash glyph side by
                  side. Named, they are plainly different things. */}
              {item('revoke', PlugZap, localize('com_ui_revoke'), revoke, true)}
              {item('delete', Trash2, localize('com_ui_delete'), onDelete, true)}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
