import type { Config } from "tailwindcss";

/**
 * Design tokens are CSS variables defined in index.css (:root = dark, html.light = light).
 * Colors keep their historical token names (ink/fog/spark) so existing classes theme
 * automatically; RGB-triple format keeps Tailwind's alpha modifiers (/70, /20) working.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "rgb(var(--c-ink-950) / <alpha-value>)",
          900: "rgb(var(--c-ink-900) / <alpha-value>)",
          850: "rgb(var(--c-ink-850) / <alpha-value>)",
          800: "rgb(var(--c-ink-800) / <alpha-value>)",
          700: "rgb(var(--c-ink-700) / <alpha-value>)",
          600: "rgb(var(--c-ink-600) / <alpha-value>)",
        },
        fog: {
          500: "rgb(var(--c-fog-500) / <alpha-value>)",
          400: "rgb(var(--c-fog-400) / <alpha-value>)",
          300: "rgb(var(--c-fog-300) / <alpha-value>)",
          200: "rgb(var(--c-fog-200) / <alpha-value>)",
          100: "rgb(var(--c-fog-100) / <alpha-value>)",
        },
        spark: {
          500: "rgb(var(--c-spark-500) / <alpha-value>)",
          400: "rgb(var(--c-spark-400) / <alpha-value>)",
        },
        flame: {
          500: "rgb(var(--c-flame-500) / <alpha-value>)",
        },
        star: {
          500: "rgb(var(--c-star-500) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      keyframes: {
        "slide-in": {
          from: { transform: "translateX(16px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "fade-up": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "0.25" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-up": "fade-up 300ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
