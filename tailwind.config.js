/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // These resolve via CSS variables (defined in src/index.css for both
        // the dark default and the [data-theme="light"] override) so every
        // existing bg-background/text-primary/etc. class automatically
        // follows the active theme — no component needed to change.
        background: 'var(--color-background)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          alt: 'var(--color-surface-alt)',
        },
        border: 'var(--color-border)',
        text: {
          primary: 'var(--color-text-primary)',
          muted: 'var(--color-text-muted)',
        },
        // Left as fixed values on purpose — gold/success/danger are designed
        // to read correctly against both a dark and a light background.
        accent: {
          gold: '#FFD700',
          'gold-soft': 'rgba(255,215,0,0.12)',
        },
        success: '#20d58a',
        danger: '#ff5260',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        marquee: 'marquee 30s linear infinite',
      },
    },
  },
  plugins: [],
}
