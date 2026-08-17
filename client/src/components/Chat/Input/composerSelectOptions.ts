// Single source of truth for the image-model and voice option lists, shared by
// Settings → Preferences (user-wide defaults) and the composer's per-chat
// pickers so both always offer the exact same choices. A `type` alias (not an
// interface) keeps these assignable to the broader `OptionWithIcon` that
// Preferences' combobox expects.
export type SelectOption = { value: string; label: string };

export const DEFAULT_OPTION: SelectOption = { value: '', label: 'Default' };

// Curated image models — must match the backend allow-list in
// api/routes/chat.py (IMAGE_MODELS). Values are "<provider>/<model_name>"; an
// empty value means "use the deploy default".
export const IMAGE_MODEL_OPTIONS: SelectOption[] = [
  DEFAULT_OPTION,
  {
    value: 'openrouter/google/gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image',
  },
];

// OpenAI TTS voices (no /voices route exists; mirrors the server default set).
export const TTS_VOICE_VALUES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

export const TTS_VOICE_OPTIONS: SelectOption[] = [
  DEFAULT_OPTION,
  ...TTS_VOICE_VALUES.map((v) => ({
    value: v,
    label: v.charAt(0).toUpperCase() + v.slice(1),
  })),
];
