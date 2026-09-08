/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#050607',
        surface: {
          DEFAULT: '#101316',
          alt: '#15191d',
        },
        border: '#252a2e',
        accent: {
          gold: '#FFD700',
          'gold-soft': 'rgba(255,215,0,0.12)',
        },
        text: {
          primary: '#ffffff',
          muted: '#92989e',
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
