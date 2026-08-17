import { IThemeRGB } from '../types';

/**
 * Default light theme
 * RGB values extracted from the existing CSS variables
 */
export const defaultTheme: IThemeRGB = {
  // Text colors
  'rgb-text-primary': '15 17 21', // #0F1115 (Figma)
  'rgb-text-secondary': '74 78 87', // #4A4E57 (Figma)
  'rgb-text-secondary-alt': '107 112 120', // #6B7078 (Figma)
  'rgb-text-tertiary': '155 160 168', // #9BA0A8 (Figma)
  'rgb-text-warning': '245 158 11', // #f59e0b (amber-500)

  // Ring colors
  'rgb-ring-primary': '107 112 120', // #6B7078 (Figma)

  // Header colors
  'rgb-header-primary': '255 255 255', // #FFFFFF (Figma)
  'rgb-header-hover': '246 246 247', // #F6F6F7 (Figma)
  'rgb-header-button-hover': '236 237 239', // #ECEDEF (Figma)

  // Surface colors
  'rgb-surface-active': '228 230 234', // #E4E6EA (Figma)
  'rgb-surface-active-alt': '236 237 239', // #ECEDEF (Figma)
  'rgb-surface-hover': '236 237 239', // #ECEDEF (Figma)
  'rgb-surface-hover-alt': '228 230 234', // #E4E6EA (Figma)
  'rgb-surface-primary': '255 255 255', // #FFFFFF (Figma)
  'rgb-surface-primary-alt': '246 246 247', // #F6F6F7 (Figma)
  'rgb-surface-primary-contrast': '236 237 239', // #ECEDEF (Figma)
  'rgb-surface-secondary': '246 246 247', // #F6F6F7 (Figma)
  'rgb-surface-secondary-alt': '228 230 234', // #E4E6EA (Figma)
  'rgb-surface-tertiary': '246 246 247', // #F6F6F7 (Figma)
  'rgb-surface-tertiary-alt': '255 255 255', // #FFFFFF (Figma)
  'rgb-surface-dialog': '255 255 255', // #FFFFFF (Figma)
  'rgb-surface-submit': '99 91 255', // #635BFF (Figma)
  'rgb-surface-submit-hover': '79 72 217', // #4F48D9 (Figma)
  'rgb-surface-destructive': '196 52 78', // #C4344E (Figma)
  'rgb-surface-destructive-hover': '168 44 67', // #A82C43 (Figma)
  'rgb-surface-chat': '246 246 247', // #F6F6F7 (Figma)

  // Border colors
  'rgb-border-light': '231 232 234', // #E7E8EA (Figma)
  'rgb-border-medium': '210 213 218', // #D2D5DA (Figma)
  'rgb-border-medium-alt': '231 232 234', // #E7E8EA (Figma)
  'rgb-border-heavy': '155 160 168', // #9BA0A8 (Figma)
  'rgb-border-xheavy': '107 112 120', // #6B7078 (Figma)

  // Brand colors
  'rgb-brand-purple': '99 91 255', // #635BFF (Figma)

  // Presentation
  'rgb-presentation': '255 255 255', // #fff (white)

  // Utility colors (mapped to existing colors for backwards compatibility)
  'rgb-background': '255 255 255', // Same as surface-primary
  'rgb-foreground': '17 17 17', // Same as text-primary
  'rgb-primary': '235 235 235', // Same as surface-active
  'rgb-primary-foreground': '0 0 0', // Same as surface-primary-contrast
  'rgb-secondary': '247 247 248', // Same as surface-secondary
  'rgb-secondary-foreground': '66 66 66', // Same as text-secondary
  'rgb-muted': '250 250 250', // Same as surface-tertiary
  'rgb-muted-foreground': '120 120 120', // Same as text-tertiary
  'rgb-accent': '245 245 245', // Same as surface-active-alt
  'rgb-accent-foreground': '17 17 17', // Same as text-primary
  'rgb-destructive-foreground': '17 17 17', // Same as text-primary
  'rgb-border': '215 215 215', // Same as border-medium
  'rgb-input': '230 230 230', // Same as border-light
  'rgb-ring': '180 180 180', // Same as ring-primary
  'rgb-card': '247 247 248', // Same as surface-secondary
  'rgb-card-foreground': '17 17 17', // Same as text-primary
};
