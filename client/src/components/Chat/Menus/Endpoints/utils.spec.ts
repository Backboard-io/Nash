import { filterEndpointsByTier } from './utils';
import type { Endpoint } from '~/common';

describe('filterEndpointsByTier', () => {
  const endpoints: Endpoint[] = [
    {
      value: 'openAI',
      label: 'OpenAI',
      hasModels: true,
      icon: null,
      models: [
        { name: 'openai/gpt-4o-mini', tiers: ['fast'] },
        { name: 'openai/o3', tiers: ['powerful'] },
      ],
    },
    {
      value: 'google',
      label: 'Google',
      hasModels: true,
      icon: null,
      models: [{ name: 'google/gemma-3-12b-it', tiers: ['free'] }],
    },
  ];

  it('returns all endpoints unchanged when no tier is active', () => {
    expect(filterEndpointsByTier(endpoints, null)).toEqual(endpoints);
  });

  it('keeps only matching models and removes empty providers', () => {
    expect(filterEndpointsByTier(endpoints, 'fast')).toEqual([
      {
        value: 'openAI',
        label: 'OpenAI',
        hasModels: true,
        icon: null,
        models: [{ name: 'openai/gpt-4o-mini', tiers: ['fast'] }],
      },
    ]);
  });

  it('supports the free tier for open-source buckets', () => {
    expect(filterEndpointsByTier(endpoints, 'free')).toEqual([
      {
        value: 'google',
        label: 'Google',
        hasModels: true,
        icon: null,
        models: [{ name: 'google/gemma-3-12b-it', tiers: ['free'] }],
      },
    ]);
  });
});
