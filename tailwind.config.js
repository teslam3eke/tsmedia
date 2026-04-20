/** @type {import('tailwindcss').Config} */
// Tailwind CSS v4 — design tokens are defined in src/index.css via @theme {}
// This file documents the design system for reference.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang TC"',
          '"Noto Sans TC"',
          'sans-serif',
        ],
      },
      colors: {
        background: '#fafafa',
        foreground: '#0f172a',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
