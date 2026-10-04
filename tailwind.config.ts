import type { Config } from "tailwindcss";

// Every colour points at the CSS variable of the same name in app/globals.css,
// so DESIGN.md has one source of truth and Tailwind classes follow it.
const token = (name: string) => `var(--${name})`;

const names = [
  "bg",
  "surface-low",
  "surface",
  "surface-high",
  "surface-highest",
  "surface-bright",
  "on-surface",
  "on-surface-variant",
  "outline",
  "outline-variant",
  "primary",
  "primary-dim",
  "primary-container",
  "secondary",
  "tertiary",
  "success",
  "fault",
  "warn",
  "hidden-slot",
  "student-a",
  "student-b",
] as const;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: Object.fromEntries(names.map((n) => [n, token(n)])),
      fontFamily: {
        sans: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        control: "10px",
        pill: "9999px",
      },
    },
  },
};

export default config;
