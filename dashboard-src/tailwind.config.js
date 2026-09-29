/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "rgb(var(--void-rgb) / <alpha-value>)", ink: "rgb(var(--ink-rgb) / <alpha-value>)", panel: "rgb(var(--panel-rgb) / <alpha-value>)", raise: "rgb(var(--raise-rgb) / <alpha-value>)",
        line: "rgb(var(--line-rgb) / <alpha-value>)", line2: "rgb(var(--line2-rgb) / <alpha-value>)", fg: "rgb(var(--fg-rgb) / <alpha-value>)", dim: "rgb(var(--dim-rgb) / <alpha-value>)", faint: "rgb(var(--faint-rgb) / <alpha-value>)",
        cyan: "rgb(var(--cyan-rgb) / <alpha-value>)", violet: "rgb(var(--violet-rgb) / <alpha-value>)", ok: "rgb(var(--ok-rgb) / <alpha-value>)", warn: "rgb(var(--warn-rgb) / <alpha-value>)", bad: "rgb(var(--bad-rgb) / <alpha-value>)", brand: "rgb(var(--brand-rgb) / <alpha-value>)", onbrand: "rgb(var(--onbrand-rgb) / <alpha-value>)", hero: "rgb(var(--hero-rgb) / <alpha-value>)", info: "rgb(var(--info-rgb) / <alpha-value>)",
      },
      borderRadius: { none: "0", sm: "6px", DEFAULT: "6px", md: "12px", lg: "24px", xl: "24px", "2xl": "24px", full: "9999px" },
      fontFamily: {
        sans: ['"Exo 2"', "system-ui", "sans-serif"],
        display: ["Michroma", '"Eurostile Extended"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
