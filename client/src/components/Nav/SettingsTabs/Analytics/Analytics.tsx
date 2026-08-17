import React, { useMemo } from 'react';
import { Button, Spinner } from '@librechat/client';
import {
  Activity,
  BarChart3,
  CalendarDays,
  Coins,
  MessageSquare,
} from 'lucide-react';
import type * as t from 'librechat-data-provider';
import { useGetAnalyticsQuery } from '~/data-provider';
import { cn, formatModelName } from '~/utils';

const heatClasses = [
  'bg-surface-tertiary',
  'bg-teal-100 dark:bg-teal-950',
  'bg-teal-200 dark:bg-teal-900',
  'bg-teal-400 dark:bg-teal-700',
  'bg-teal-600 dark:bg-teal-500',
];

const EMPTY_SUMMARY: t.AnalyticsSummary = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  creditUsdMicros: 0,
  messageCount: 0,
  activeDays: 0,
  mainModel: '',
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildEmptyActivity() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 365 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (364 - index));
    return {
      date: localDateKey(day),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      creditUsdMicros: 0,
      messageCount: 0,
    };
  });
}

function normalizeSummary(summary?: Partial<t.AnalyticsSummary> | null): t.AnalyticsSummary {
  return {
    inputTokens: numberValue(summary?.inputTokens),
    outputTokens: numberValue(summary?.outputTokens),
    totalTokens: numberValue(summary?.totalTokens),
    creditUsdMicros: numberValue(summary?.creditUsdMicros),
    messageCount: numberValue(summary?.messageCount),
    activeDays: numberValue(summary?.activeDays),
    mainModel: typeof summary?.mainModel === 'string' ? summary.mainModel : '',
  };
}

function normalizeActivity(
  activity?: Array<Partial<t.AnalyticsActivityBucket>> | null,
): t.AnalyticsActivityBucket[] {
  if (!Array.isArray(activity)) {
    return buildEmptyActivity();
  }
  return activity.map((bucket, index) => ({
    date: typeof bucket?.date === 'string' && bucket.date ? bucket.date : String(index),
    inputTokens: numberValue(bucket?.inputTokens),
    outputTokens: numberValue(bucket?.outputTokens),
    totalTokens: numberValue(bucket?.totalTokens),
    creditUsdMicros: numberValue(bucket?.creditUsdMicros),
    messageCount: numberValue(bucket?.messageCount),
  }));
}

function normalizeModels(models?: Array<Partial<t.AnalyticsModelRank>> | null) {
  if (!Array.isArray(models)) {
    return [];
  }
  return models
    .filter((model) => typeof model?.model === 'string' && model.model)
    .map((model) => ({
      model: model.model as string,
      totalTokens: numberValue(model.totalTokens),
    }));
}

function formatTokens(value: number) {
  const amount = Number(value || 0);
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(amount >= 10_000 ? 0 : 1)}K`;
  }
  return amount.toLocaleString();
}

function formatCredits(micros: number) {
  const dollars = Number(micros || 0) / 1_000_000;
  if (dollars > 0 && dollars < 0.01) {
    return `$${dollars.toFixed(4)}`;
  }
  return dollars.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const dateOnlyRegex = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(value: string) {
  if (!value) {
    return 'Never';
  }

  const dateOnlyMatch = dateOnlyRegex.exec(value);
  if (dateOnlyMatch) {
    const [, yearPart, monthPart, dayPart] = dateOnlyMatch;
    const year = Number(yearPart);
    const month = Number(monthPart);
    const day = Number(dayPart);
    const parsed = new Date(0);
    parsed.setFullYear(year, month - 1, day);
    parsed.setHours(0, 0, 0, 0);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return value;
    }

    return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return value;
}

function mainModelLabel(model: string) {
  return model ? formatModelName(model) : 'Not enough data';
}

function responseStatus(error: unknown) {
  return (
    (error as { response?: { status?: number }; status?: number })?.response?.status ??
    (error as { status?: number })?.status
  );
}

function responseMessage(error: unknown) {
  const data = (error as { response?: { data?: { message?: string; error?: string } } })?.response
    ?.data;
  return data?.message || data?.error || '';
}

function analyticsErrorText(error: unknown) {
  const status = responseStatus(error);
  if (status === 404) {
    return 'Analytics API is not available yet. Restart the backend, then retry.';
  }
  return responseMessage(error) || 'Analytics could not be refreshed. Showing an empty view.';
}

function SummaryTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-xl font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function ActivityHeatmap({ activity }: { activity: t.AnalyticsActivityBucket[] }) {
  const maxTokens = Math.max(1, ...activity.map((bucket) => bucket.totalTokens || 0));
  const weeks = Array.from({ length: Math.ceil(activity.length / 7) }, (_, index) =>
    activity.slice(index * 7, index * 7 + 7),
  );

  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-text-primary">Token activity</h3>
        <span className="text-xs text-text-secondary">365 days</span>
      </div>
      <div className="pb-1">
        <div className="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-0.5 sm:gap-1">
          {weeks.map((week, weekIndex) => (
            <div key={week[0]?.date ?? weekIndex} className="grid grid-rows-7 gap-0.5 sm:gap-1">
              {week.map((bucket) => {
                const ratio = bucket.totalTokens > 0 ? bucket.totalTokens / maxTokens : 0;
                const level = ratio === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
                return (
                  <div
                    key={bucket.date}
                    title={`${formatDate(bucket.date)}: ${formatTokens(bucket.totalTokens)} tokens`}
                    className={cn('aspect-square rounded-[2px] sm:rounded-[3px]', heatClasses[level])}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1 text-[11px] text-text-secondary">
        <span>Less</span>
        {heatClasses.map((className, index) => (
          <span key={className} className={cn('h-2.5 w-2.5 rounded-[2px]', className)} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function ActivityInsights({
  summary,
  activity,
}: {
  summary: t.AnalyticsSummary;
  activity: t.AnalyticsActivityBucket[];
}) {
  const lastActive = [...activity].reverse().find((bucket) => bucket.messageCount > 0)?.date ?? '';
  const averageTokens =
    summary.activeDays > 0 ? Math.round(summary.totalTokens / summary.activeDays) : 0;

  return (
    <div className="grid gap-2 rounded-lg border border-border-light bg-surface-secondary p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-secondary">Active days</span>
        <span className="font-medium text-text-primary">{summary.activeDays}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-secondary">Average per active day</span>
        <span className="font-medium text-text-primary">{formatTokens(averageTokens)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-secondary">Last active</span>
        <span className="font-medium text-text-primary">{formatDate(lastActive)}</span>
      </div>
    </div>
  );
}

function ModelRanking({ models }: { models: t.AnalyticsModelRank[] }) {
  if (!models.length) {
    return (
      <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-3 text-sm text-text-secondary">
        Model ranking will appear after tracked chats complete.
      </div>
    );
  }

  const top = Math.max(1, models[0]?.totalTokens ?? 1);
  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary p-3">
      <h3 className="mb-3 text-sm font-medium text-text-primary">Models</h3>
      <div className="grid gap-3">
        {models.slice(0, 6).map((model) => {
          const width = Math.max(6, Math.round((model.totalTokens / top) * 100));
          return (
            <div key={model.model} className="grid gap-1">
              <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-text-primary">
                  {formatModelName(model.model)}
                </span>
                <span className="shrink-0 text-xs text-text-secondary">
                  {formatTokens(model.totalTokens)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                <div className="h-full rounded-full bg-teal-500" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border-light bg-surface-secondary px-4 py-6 text-center text-sm text-text-secondary">
      Personal analytics will appear after your next completed chat.
    </div>
  );
}

function AnalyticsContent({ data }: { data: Partial<t.AnalyticsResponse> }) {
  const summary = normalizeSummary(data.summary);
  const activity = normalizeActivity(data.activity);
  const models = normalizeModels(data.models);
  const hasData = summary.messageCount > 0;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <SummaryTile
          label="Tokens used"
          value={formatTokens(summary.totalTokens)}
          icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <SummaryTile
          label="Credits used"
          value={formatCredits(summary.creditUsdMicros)}
          icon={<Coins className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <SummaryTile
          label="Messages"
          value={formatTokens(summary.messageCount)}
          icon={<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <SummaryTile
          label="Main model"
          value={mainModelLabel(summary.mainModel)}
          icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
        />
      </div>

      {!hasData && <EmptyState />}

      <ActivityHeatmap activity={activity} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <ModelRanking models={models} />
        <ActivityInsights summary={summary} activity={activity} />
      </div>
    </div>
  );
}

function Analytics() {
  const analyticsQuery = useGetAnalyticsQuery();

  const fallbackData = useMemo<Partial<t.AnalyticsResponse>>(
    () => ({
      scope: 'personal',
      selector: {
        personal: { id: 'personal', name: 'Personal' },
        organizations: [],
      },
      summary: EMPTY_SUMMARY,
      activity: buildEmptyActivity(),
      models: [],
      members: [],
    }),
    [],
  );
  const analyticsData = analyticsQuery.data ?? fallbackData;

  return (
    <div className="flex flex-col gap-4 p-1 text-sm text-text-primary">
      <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <CalendarDays className="h-4 w-4 text-text-secondary" aria-hidden="true" />
        <span className="truncate">Personal usage</span>
      </div>

      {analyticsQuery.isLoading && !analyticsQuery.data ? (
        <div className="flex h-40 items-center justify-center text-text-secondary">
          <Spinner className="size-5" />
        </div>
      ) : analyticsQuery.isError || !analyticsQuery.data ? (
        <>
          <div className="rounded-lg border border-border-light bg-surface-secondary px-4 py-4 text-sm text-text-secondary">
            <div>{analyticsErrorText(analyticsQuery.error)}</div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => analyticsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
          <AnalyticsContent data={analyticsData} />
        </>
      ) : (
        <AnalyticsContent data={analyticsData} />
      )}
    </div>
  );
}

export default React.memo(Analytics);
