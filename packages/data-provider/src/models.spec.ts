import {
  getModelName,
  getModelTiers,
  hasModelTier,
  tModelConfigSchema,
  type TModelConfig,
} from './models';

describe('model config helpers', () => {
  it('returns the raw string model name unchanged', () => {
    expect(getModelName('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    expect(getModelTiers('openai/gpt-4o-mini')).toEqual([]);
  });

  it('reads structured model metadata', () => {
    const model: TModelConfig = {
      name: 'openai/o3',
      tiers: ['powerful', 'fast'],
    };

    expect(getModelName(model)).toBe('openai/o3');
    expect(getModelTiers(model)).toEqual(['powerful', 'fast']);
    expect(hasModelTier(model, 'powerful')).toBe(true);
    expect(hasModelTier(model, 'free')).toBe(false);
  });

  it('validates the supported tier values', () => {
    expect(() =>
      tModelConfigSchema.parse({
        name: 'google/gemini-2.5-flash',
        tiers: ['fast'],
      }),
    ).not.toThrow();

    expect(() =>
      tModelConfigSchema.parse({
        name: 'google/gemini-2.5-flash',
        tiers: ['cheap'],
      }),
    ).toThrow();
  });
});
