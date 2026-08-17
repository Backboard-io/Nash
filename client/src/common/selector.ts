import React from 'react';
import { TStartupConfig } from 'librechat-data-provider';

import type { TModelTier } from 'librechat-data-provider';

export interface Endpoint {
  value: string;
  label: string;
  hasModels: boolean;
  models?: Array<{ name: string; isGlobal?: boolean; isPremium?: boolean; tiers?: TModelTier[] }>;
  icon: React.ReactNode;
  agentNames?: Record<string, string>;
  assistantNames?: Record<string, string>;
  modelIcons?: Record<string, string | undefined>;
}

export interface SelectedValues {
  endpoint: string | null;
  model: string | null;
  modelSpec: string | null;
}

export interface ModelSelectorProps {
  startupConfig: TStartupConfig | undefined;
  /** 'default' renders the bordered header trigger; 'pill' renders the rounded composer pill. */
  variant?: 'default' | 'pill';
}
