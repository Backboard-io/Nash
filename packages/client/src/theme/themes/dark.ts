import { IThemeRGB } from '../types';

/**
 * Dark theme
 * RGB values extracted from the existing dark mode CSS variables
 */
export const darkTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '228 229 232', // #E4E5E8 (Figma)
  'rgb-text-secondary': '162 165 171', // #A2A5AB (Figma)
  'rgb-text-secondary-alt': '139 142 149', // #8B8E95 (Figma)
  'rgb-text-tertiary': '104 107 114', // #686B72 (Figma)
  'rgb-text-warning': '245 158 11', // #f59e0b (amber-500)

  // Ring colors (not defined in dark mode, using default)
  'rgb-ring-primary': '139 142 149', // #8B8E95 (Figma)

  // Header colors
  'rgb-header-primary': '8 9 11', // #08090B (Figma)
  'rgb-header-hover': '19 21 23', // #131517 (Figma)
  'rgb-header-button-hover': '30 32 36', // #1E2024 (Figma)

  // Surface colors
  'rgb-surface-active': '30 32 36', // #1E2024 (Figma)
  'rgb-surface-active-alt': '36 38 43', // #24262B (Figma)
  'rgb-surface-hover': '24 26 30', // #181A1E (Figma)
  'rgb-surface-hover-alt': '30 32 36', // #1E2024 (Figma)
  'rgb-surface-primary': '8 9 11', // #08090B (Figma)
  'rgb-surface-primary-alt': '13 15 18', // #0D0F12 (Figma)
  'rgb-surface-primary-contrast': '19 21 23', // #131517 (Figma)
  'rgb-surface-secondary': '19 21 23', // #131517 (Figma)
  'rgb-surface-secondary-alt': '30 32 36', // #1E2024 (Figma)
  'rgb-surface-tertiary': '30 32 36', // #1E2024 (Figma)
  'rgb-surface-tertiary-alt': '36 38 43', // #24262B (Figma)
  'rgb-surface-dialog': '19 21 23', // #131517 (Figma)
  'rgb-surface-submit': '99 91 255', // #635BFF (Figma)
  'rgb-surface-submit-hover': '79 72 217', // #4F48D9 (Figma)
  'rgb-surface-destructive': '139 34 56', // #8B2238 (Figma)
  'rgb-surface-destructive-hover': '163 41 67', // #A32943 (Figma)
  'rgb-surface-chat': '19 21 23', // #131517 (Figma)

  // Border colors
  'rgb-border-light': '46 48 54', // #2E3036 (Figma)
  'rgb-border-medium': '46 48 54', // #2E3036 (Figma)
  'rgb-border-medium-alt': '46 48 54', // #2E3036 (Figma)
  'rgb-border-heavy': '62 65 72', // #3E4148 (Figma)
  'rgb-border-xheavy': '104 107 114', // #686B72 (Figma)

  // Brand colors
  'rgb-brand-purple': '99 91 255', // #635BFF (Figma)

  // Presentation
  'rgb-presentation': '33 33 33', // #212121 (gray-800)

  // Utility colors (mapped to existing colors for backwards compatibility)
  'rgb-background': '33 33 33', // Same as surface-primary
  'rgb-foreground': '255 255 255', // Same as text-primary
  'rgb-primary': '66 66 66', // Same as surface-active
  'rgb-primary-foreground': '255 255 255', // Same as surface-primary-contrast
  'rgb-secondary': '42 42 42', // Same as surface-secondary
  'rgb-secondary-foreground': '193 193 193', // Same as text-secondary
  'rgb-muted': '56 56 56', // Same as surface-tertiary
  'rgb-muted-foreground': '140 140 140', // Same as text-tertiary
  'rgb-accent': '82 82 82', // Same as surface-active-alt
  'rgb-accent-foreground': '255 255 255', // Same as text-primary
  'rgb-destructive-foreground': '255 255 255', // Same as text-primary
  'rgb-border': '82 82 82', // Same as border-medium
  'rgb-input': '66 66 66', // Same as border-light
  'rgb-ring': '255 255 255', // Same as ring-primary
  'rgb-card': '42 42 42', // Same as surface-secondary
  'rgb-card-foreground': '255 255 255', // Same as text-primary
};
