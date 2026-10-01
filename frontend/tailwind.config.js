/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        flood: {
          dark: "#0b1329",
          card: "#111c38",
          border: "#1e2e56",
          primary: "#38bdf8",
          accent: "#0ea5e9",
        }
      }
    },
  },
  plugins: [],
}
