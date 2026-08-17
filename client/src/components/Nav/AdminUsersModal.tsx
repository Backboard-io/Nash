import React, { useState, useCallback } from 'react';
import {
  Search,
  Shield,
  User,
  X,
  Users,
  CheckCircle2,
  Check,
  UserX,
  UserCheck,
  EyeOff,
  RefreshCw,
} from 'lucide-react';
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminUser } from 'librechat-data-provider';
import type { TDialogProps } from '~/common';
import { cn } from '~/utils';

const AVATAR_GRADIENTS = [
  'from-blue-500 to-violet-600',
  'from-violet-500 to-violet-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-blue-600',
  'from-indigo-500 to-purple-600',
];

function avatarGradient(str: string): string {
  let hash = 0;
  for (const ch of str) {
    hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function UserAvatar({
  name,
  email,
  size = 'md',
  disabled,
}: {
  name?: string | null;
  email: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}) {
  const label = name || email;
  const initial = label[0]?.toUpperCase() ?? '?';
  const gradient = avatarGradient(email);
  return (
    <div
      className={cn(
        'flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white shadow-sm transition-all duration-200',
        gradient,
        size === 'sm' && 'h-7 w-7 text-xs',
        size === 'md' && 'h-9 w-9 text-sm',
        size === 'lg' && 'h-11 w-11 text-base',
        disabled && 'opacity-40 grayscale',
      )}
    >
      {initial}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border-light px-4 py-2.5 last:border-b-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span
        className={cn(
          'max-w-[200px] truncate text-xs',
          mono && 'font-mono',
          muted ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ─── Animated checkbox ─── */
function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      aria-checked={checked}
      aria-label="Select user"
      className={cn(
        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all duration-150 active:scale-90',
        checked
          ? 'border-blue-500 bg-blue-500 shadow-sm shadow-blue-200 dark:shadow-blue-900/40'
          : 'border-border-medium bg-transparent hover:border-blue-400',
      )}
    >
      {checked && (
        <Check
          className="h-2.5 w-2.5 text-white animate-in zoom-in-75 duration-100"
          strokeWidth={3}
        />
      )}
    </button>
  );
}

/* ─── Left panel: user list item ─── */
function UserListItem({
  user,
  isSelected,
  isChecked,
  onSelect,
  onCheck,
}: {
  user: AdminUser;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: () => void;
  onCheck: () => void;
}) {
  const isDisabled = user.active === false;
  return (
    <div
      className={cn(
        'group flex w-full items-center transition-all duration-150',
        isSelected ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-surface-hover',
        isDisabled && 'opacity-50',
      )}
    >
      {/* Checkbox */}
      <div className="flex items-center pl-3 pr-1.5 py-2.5">
        <Checkbox checked={isChecked} onChange={onCheck} />
      </div>

      {/* Card body */}
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-3 text-left"
      >
        <UserAvatar name={user.name} email={user.email} size="sm" disabled={isDisabled} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'truncate text-[13px] font-medium transition-colors duration-100',
                isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-text-primary',
              )}
            >
              {user.name || user.username || user.email}
            </span>
            {user.role === 'ADMIN' && (
              <Shield className="h-3 w-3 flex-shrink-0 text-blue-500" />
            )}
            {isDisabled && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <EyeOff className="h-2 w-2" />
                disabled
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-text-secondary">{user.email}</p>
        </div>
      </button>
    </div>
  );
}

/* ─── Right panel: user detail ─── */
function UserDetail({
  user,
  onRoleUpdated,
}: {
  user: AdminUser;
  onRoleUpdated: () => void;
}) {
  const queryClient = useQueryClient();
  const [savedField, setSavedField] = useState<string | null>(null);

  const flash = useCallback((field: string) => {
    setSavedField(field);
    setTimeout(() => setSavedField(null), 2000);
  }, []);

  const roleMutation = useMutation(
    (role: string) => dataService.setAdminUserRole(user.id, role),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminUsers]);
        flash('role');
        onRoleUpdated();
      },
    },
  );

  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* User header */}
      <div className="border-b border-border-light px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <UserAvatar name={user.name} email={user.email} size="lg" disabled={user.active === false} />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-text-primary">
                  {user.name || user.username || user.email}
                </h3>
                {savedField === 'role' && (
                  <CheckCircle2 className="h-4 w-4 text-brand-purple animate-in fade-in zoom-in-75 duration-200" />
                )}
              </div>
              <p className="text-sm text-text-secondary">{user.email}</p>
              <div className="mt-1.5 flex items-center gap-2">
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    <Shield className="h-2.5 w-2.5" />
                    Admin
                  </span>
                )}
                {user.active === false && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    <EyeOff className="h-2.5 w-2.5" />
                    Disabled
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => roleMutation.mutate(isAdmin ? 'USER' : 'ADMIN')}
            disabled={roleMutation.isLoading}
            className={cn(
              'flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all active:scale-[0.97]',
              isAdmin
                ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-950/50',
            )}
          >
            {roleMutation.isLoading ? '...' : isAdmin ? 'Demote to User' : 'Promote to Admin'}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 px-6 py-5">
        <div className="overflow-hidden rounded-xl border border-border-light">
          <DetailRow label="Provider" value={user.provider || 'apikey'} muted />
          {user.createdAt && (
            <DetailRow label="Joined" value={new Date(user.createdAt).toLocaleDateString()} />
          )}
        </div>

        {roleMutation.isError && (
          <p className="rounded-xl bg-red-50 px-4 py-2.5 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
            Failed to update. Please try again.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Main modal ─── */
export default function AdminUsersModal({ open, onOpenChange }: TDialogProps) {
  const [search, setSearch] = useState('');
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [actionSuccess, setActionSuccess] = useState<'disabled' | 'enabled' | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch: refetchUsers, isFetching: isFetchingUsers } = useQuery(
    [QueryKeys.adminUsers, search],
    () => dataService.getAdminUsers(search || undefined),
    {
      staleTime: 15_000,
      keepPreviousData: true,
      enabled: open,
    },
  );

  const disableMutation = useMutation(
    (userIds: string[]) => dataService.disableAdminUsers(userIds),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminUsers]);
        setSelectedUserIds(new Set());
        setActionSuccess('disabled');
        setTimeout(() => setActionSuccess(null), 2500);
      },
    },
  );

  const enableMutation = useMutation(
    (userIds: string[]) => dataService.enableAdminUsers(userIds),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminUsers]);
        setSelectedUserIds(new Set());
        setActionSuccess('enabled');
        setTimeout(() => setActionSuccess(null), 2500);
      },
    },
  );

  const allUsers = data?.users ?? [];
  const filteredUsers = showActiveOnly ? allUsers.filter((u) => u.active !== false) : allUsers;
  const detailUser = allUsers.find((u) => u.id === detailUserId) ?? null;

  const toggleSelection = useCallback((userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const selectionCount = selectedUserIds.size;

  // Infer intent: if ALL selected users are disabled → enable action, otherwise disable
  const allSelectedDisabled =
    selectionCount > 0 &&
    Array.from(selectedUserIds).every((id) => {
      const u = allUsers.find((u) => u.id === id);
      return u?.active === false;
    });

  const isEnableMode = allSelectedDisabled;
  const isBusy = disableMutation.isLoading || enableMutation.isLoading;

  const handleAction = useCallback(() => {
    const ids = Array.from(selectedUserIds);
    if (ids.length === 0) return;
    if (isEnableMode) {
      enableMutation.mutate(ids);
    } else {
      disableMutation.mutate(ids);
    }
  }, [selectedUserIds, isEnableMode, enableMutation, disableMutation]);

  return (
    <Transition appear show={open}>
      <Dialog as="div" className="relative z-50" onClose={onOpenChange}>
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 dark:bg-black/70" aria-hidden="true" />
        </TransitionChild>

        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0 translate-y-2 scale-[0.98]"
          enterTo="opacity-100 translate-y-0 scale-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100 translate-y-0 scale-100"
          leaveTo="opacity-0 translate-y-2 scale-[0.98]"
        >
          <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6">
            <DialogPanel className="flex h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-background shadow-2xl">

              {/* ── Left panel: nav + list ── */}
              <div className="flex w-72 flex-shrink-0 flex-col border-r border-border-light">

                {/* Header */}
                <div className="border-b border-border-light px-4 pb-3 pt-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-blue-500" />
                      <h2 className="text-sm font-semibold text-text-primary">User Management</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Search + filters */}
                <div className="border-b border-border-light px-3 py-2 space-y-2">
                    {/* Search + refresh */}
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary" />
                        <input
                          type="text"
                          placeholder="Search users..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="w-full rounded-lg border border-border-light bg-surface-secondary/50 py-1.5 pl-8 pr-3 text-xs text-text-primary placeholder-text-secondary transition-all focus:border-blue-500 focus:bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          queryClient.invalidateQueries([QueryKeys.adminUsers]);
                          refetchUsers();
                        }}
                        disabled={isFetchingUsers}
                        className="flex-shrink-0 rounded-lg border border-border-light bg-surface-secondary/50 p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                        aria-label="Refresh user list"
                        title="Refresh user list"
                      >
                        <RefreshCw
                          className={cn('h-3.5 w-3.5', isFetchingUsers && 'animate-spin')}
                        />
                      </button>
                    </div>

                    {/* Active users filter */}
                    <button
                      type="button"
                      onClick={() => setShowActiveOnly((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
                    >
                      <div
                        className={cn(
                          'flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border transition-all duration-150',
                          showActiveOnly
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-border-medium bg-transparent',
                        )}
                      >
                        {showActiveOnly && (
                          <Check className="h-2 w-2 text-white animate-in zoom-in-75 duration-100" strokeWidth={3} />
                        )}
                      </div>
                      <span>Active users only</span>
                    </button>

                    {/* Enable / Disable action button — slides in when users are selected */}
                    {selectionCount > 0 && (
                      <button
                        type="button"
                        onClick={handleAction}
                        disabled={isBusy}
                        className={cn(
                          'flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.97]',
                          'animate-in slide-in-from-top-1 fade-in duration-200',
                          isBusy && 'cursor-not-allowed opacity-60',
                          actionSuccess
                            ? 'bg-violet-50 text-brand-purple dark:bg-violet-950/30 dark:text-violet-400'
                            : isEnableMode
                              ? 'bg-violet-50 text-brand-purple hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-400 dark:hover:bg-violet-950/50'
                              : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50',
                        )}
                      >
                        {actionSuccess ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 animate-in zoom-in-75 duration-200" />
                            {actionSuccess === 'enabled' ? 'Enabled successfully' : 'Disabled successfully'}
                          </>
                        ) : isBusy ? (
                          <>
                            <span className={cn(
                              'h-3 w-3 animate-spin rounded-full border border-t-transparent',
                              isEnableMode ? 'border-brand-purple' : 'border-red-400',
                            )} />
                            {isEnableMode ? 'Enabling…' : 'Disabling…'}
                          </>
                        ) : isEnableMode ? (
                          <>
                            <UserCheck className="h-3.5 w-3.5" />
                            Enable {selectionCount} user{selectionCount > 1 ? 's' : ''}
                          </>
                        ) : (
                          <>
                            <UserX className="h-3.5 w-3.5" />
                            Disable {selectionCount} user{selectionCount > 1 ? 's' : ''}
                          </>
                        )}
                      </button>
                    )}
                  </div>

                {/* List body */}
                <div className="flex-1 overflow-y-auto">
                  {isLoading && allUsers.length === 0 ? (
                      <div className="space-y-px p-2">
                        {[...Array(6)].map((_, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 rounded-lg px-2 py-2"
                            style={{ animationDelay: `${i * 50}ms` }}
                          >
                            <div className="h-7 w-7 animate-pulse rounded-full bg-surface-tertiary" />
                            <div className="flex-1 space-y-1.5">
                              <div className="h-3 w-24 animate-pulse rounded bg-surface-tertiary" />
                              <div className="h-2.5 w-36 animate-pulse rounded bg-surface-tertiary" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : filteredUsers.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <User className="mb-2 h-8 w-8 text-text-secondary/30" />
                        <p className="text-sm text-text-secondary">
                          {search ? 'No users found' : showActiveOnly ? 'No active users' : 'No users yet'}
                        </p>
                        {showActiveOnly && allUsers.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowActiveOnly(false)}
                            className="mt-2 text-xs text-blue-500 hover:underline"
                          >
                            Show all users
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="py-1">
                        {filteredUsers.map((user) => (
                          <UserListItem
                            key={user.id}
                            user={user}
                            isSelected={detailUserId === user.id}
                            isChecked={selectedUserIds.has(user.id)}
                            onSelect={() => setDetailUserId(user.id)}
                            onCheck={() => toggleSelection(user.id)}
                          />
                        ))}
                      </div>
                  )}
                </div>
              </div>

              {/* ── Right panel ── */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {detailUser ? (
                  <UserDetail
                    key={detailUser.id}
                    user={detailUser}
                    onRoleUpdated={() => {
                      /* role label refreshes via query invalidation */
                    }}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-secondary">
                      <Users className="h-8 w-8 text-text-secondary/40" />
                    </div>
                    <p className="text-sm font-medium text-text-primary">Select a user</p>
                    <p className="mt-1 max-w-[220px] text-xs text-text-secondary">
                      Choose someone from the list to view and manage their account
                    </p>
                  </div>
                )}
              </div>
            </DialogPanel>
          </div>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}
