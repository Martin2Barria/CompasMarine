/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-gray': '#394049',
        'brand-red': '#921E30',
      }
    },
  },
  plugins: [],
}