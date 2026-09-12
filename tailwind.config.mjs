/** @type {import('tailwindcss').Config} */
// Colors resolve from CSS variables (see src/index.css) so the whole app flips
// between dark and light via a single [data-theme] attribute on <html>.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./src/**/*.{js,jsx,html}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        app:          v('--c-app'),
        panel:        v('--c-panel'),
        'panel-2':    v('--c-panel-2'),
        border:       v('--c-border'),
        accent:       v('--c-accent'),
        'accent-dim': v('--c-accent-dim'),
        'accent-2':   v('--c-accent-2'),
        dim:          v('--c-dim'),
        success:      v('--c-success'),
        warning:      v('--c-warning'),
        error:        v('--c-error'),
        // Neutrals remapped to theme vars so text-white / text-gray-* / bg-white|black/*
        // (used all over the app) stay legible in both themes.
        white: v('--c-white'),
        black: v('--c-black'),
        gray: {
          100: v('--c-gray-100'),
          200: v('--c-gray-200'),
          300: v('--c-gray-300'),
          400: v('--c-gray-400'),
          500: v('--c-gray-500'),
          600: v('--c-gray-600'),
          700: v('--c-gray-700'),
          800: v('--c-gray-800'),
          900: v('--c-gray-900'),
          950: v('--c-gray-950'),
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      keyframes: {
        // Translucent flash sweeping down the card and back — the busy state.
        'shimmer-y': {
          '0%, 100%': { transform: 'translateY(-120%)' },
          '50%':      { transform: 'translateY(120%)' },
        },
        twinkle: {
          '0%, 100%': { opacity: '.15', transform: 'scale(.7)' },
          '50%':      { opacity: '1',   transform: 'scale(1.15)' },
        },
        // One quiet entrance for a panel that appears when there is something in it.
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'none' },
        },
        // Left-to-right sweep marking the step that is running right now.
        'step-sweep': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'shimmer-y': 'shimmer-y 2s ease-in-out infinite',
        twinkle: 'twinkle 4s ease-in-out infinite',
        'fade-up': 'fade-up .3s ease-out both',
        'step-sweep': 'step-sweep 1.6s ease-in-out infinite',
      },
      boxShadow: {
        'accent-glow': '0 0 0 1px rgb(var(--c-accent) / 0.4), 0 4px 20px -4px rgb(var(--c-accent) / 0.35)',
      },
    },
  },
  plugins: [],
}
