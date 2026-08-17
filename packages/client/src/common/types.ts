import { NotificationSeverity } from './enum';

export type TShowToast = {
  message: string;
  severity?: NotificationSeverity;
  showIcon?: boolean;
  duration?: number;
  status?: 'error' | 'success' | 'warning' | 'info';
  /** A single inline action, e.g. Undo after a destructive step. DESIGN.md §5:
   *  a single item acts immediately and offers undo IN the toast — no confirm
   *  dialog. Confirms are reserved for containers and multi-selections. */
  action?: { label: string; onClick: () => void };
};

export type Option = Record<string, unknown> & {
  label?: string;
  value: string | number | null;
};

export type OptionWithIcon = Option & { icon?: React.ReactNode };
export type DropdownValueSetter = (value: string | Option | OptionWithIcon) => void;
export type MentionOption = OptionWithIcon & {
  type: string;
  value: string;
  description?: string;
};

export interface SelectedValues {
  endpoint: string | null;
  model: string | null;
  modelSpec: string | null;
}
