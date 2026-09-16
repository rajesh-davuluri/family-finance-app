import type { Config } from "tailwindcss";

// "Household ledger," not "SaaS dashboard" -- ink navy for text/structure,
// warm brass as the single accent (income + primary actions), a muted brick
// for expenses instead of stock red-600, warm paper background instead of
// pure white. See the chat for the fuller design rationale.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Primary accent -- income, primary buttons, links, active states.
        brand: {
          50: "#FBF6E9",
          100: "#F3E6C2",
          300: "#DCB768",
          400: "#C99F3F",
          500: "#B8860B",
          600: "#9C7209",
          700: "#7A5907",
        },
        // Structural text/dark UI -- replaces plain gray-900/gray-700 in
        // headings and the navbar.
        ink: {
          50: "#F4F6F8",
          100: "#E4E9EE",
          300: "#8C9BAB",
          600: "#3E4E60",
          800: "#22323F",
          900: "#1C2B3A",
        },
        // Warm paper background instead of pure white.
        paper: "#FAF7F2",
        // Semantic money colors -- deliberately not Tailwind's stock
        // green-600/red-600, which are also used elsewhere for unrelated
        // status meaning (e.g. "Active").
        income: {
          500: "#4B7B5A",
          600: "#3D6549",
        },
        expense: {
          500: "#A0463A",
          600: "#8A3A2F",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
