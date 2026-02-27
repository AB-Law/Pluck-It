/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}"
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#050509",
        surface: "#12121a",
        accent: "#f97316"
      }
    }
  },
  plugins: []
};

