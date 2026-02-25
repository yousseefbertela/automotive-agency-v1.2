/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        carbg: '#0f172a',
        carcard: '#1e293b',
        caraccent: '#f59e0b',
        carmuted: '#64748b',
      },
    },
  },
  plugins: [],
}
