/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        deck: {
          a: '#00d2ff',
          b: '#ff6b35',
        },
        surface: {
          900: '#0a0a0f',
          800: '#111118',
          700: '#1a1a25',
          600: '#22222f',
          500: '#2a2a3a',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
