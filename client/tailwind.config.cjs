// const { fontFamily } = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    // Include component library files
    '../packages/client/src/**/*.{js,jsx,ts,tsx}',
  ],
  // darkMode: 'class',
  darkMode: ['class'],
  theme: {
    fontFamily: {
      sans: ['Poppins', 'Inter', 'sans-serif'],
      mono: ['Roboto Mono', 'monospace'],
    },
    // fontFamily: {
    //   sans: ['Söhne', 'sans-serif'],
    //   mono: ['Söhne Mono', 'monospace'],
    // },
    extend: {
      width: {
        authPageWidth: '370px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-out-left': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        'slide-out-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'slide-in-left': 'slide-in-left 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'slide-out-left': 'slide-out-left 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'slide-out-right': 'slide-out-right 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
      },
      colors: {
        gray: {
          20: '#F6F6F7',
          50: '#F4F4F5',
          100: '#ECEDEF',
          200: '#E7E8EA',
          300: '#D2D5DA',
          400: '#9BA0A8',
          500: '#6B7078',
          600: '#4A4E57',
          700: '#2E3036',
          800: '#1E2024',
          850: '#131517',
          900: '#0D0F12',
        },
        'brand-purple': 'var(--brand-purple)',
        'brand-purple-hover': 'var(--brand-purple-hover)',
        'brand-purple-pressed': 'var(--brand-purple-pressed)',
        'brand-purple-foreground': 'var(--brand-purple-foreground)',
        presentation: 'var(--presentation)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-secondary-alt': 'var(--text-secondary-alt)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-warning': 'var(--text-warning)',
        'text-destructive': 'var(--text-destructive)',
        'ring-primary': 'var(--ring-primary)',
        'header-primary': 'var(--header-primary)',
        'header-hover': 'var(--header-hover)',
        'header-button-hover': 'var(--header-button-hover)',
        'surface-active': 'var(--surface-active)',
        'surface-active-alt': 'var(--surface-active-alt)',
        'surface-hover': 'var(--surface-hover)',
        'surface-hover-alt': 'var(--surface-hover-alt)',
        'surface-primary': 'var(--surface-primary)',
        'surface-primary-alt': 'var(--surface-primary-alt)',
        'surface-primary-contrast': 'var(--surface-primary-contrast)',
        'surface-secondary': 'var(--surface-secondary)',
        'surface-secondary-alt': 'var(--surface-secondary-alt)',
        'surface-tertiary': 'var(--surface-tertiary)',
        'surface-tertiary-alt': 'var(--surface-tertiary-alt)',
        'surface-dialog': 'var(--surface-dialog)',
        'surface-submit': 'var(--surface-submit)',
        'surface-submit-hover': 'var(--surface-submit-hover)',
        'surface-destructive': 'var(--surface-destructive)',
        'surface-destructive-hover': 'var(--surface-destructive-hover)',
        'surface-chat': 'var(--surface-chat)',
        'border-light': 'var(--border-light)',
        'border-medium': 'var(--border-medium)',
        'border-medium-alt': 'var(--border-medium-alt)',
        'border-heavy': 'var(--border-heavy)',
        'border-xheavy': 'var(--border-xheavy)',
        'border-destructive': 'var(--border-destructive)',
        /* These are test styles */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ['switch-unchecked']: 'hsl(var(--switch-unchecked))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('tailwindcss-radix'),
    // require('@tailwindcss/typography'),
  ],
};
