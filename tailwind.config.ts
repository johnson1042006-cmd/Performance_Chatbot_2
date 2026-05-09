import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#000000",
        accent: "#C8102E",
        "accent-solid": "#C8102E",
        "accent-hover": "#A00D24",
        success: "#2dc653",
        warning: "#f4a261",
        background: "#FFFFFF",
        surface: "#FFFFFF",
        border: "#E5E7EB",
        "text-primary": "#000000",
        "text-secondary": "#323232",
        "footer-bg": "#1A1D1E",
      },
      fontFamily: {
        sans: ["var(--font-barlow)", "sans-serif"],
        heading: ["var(--font-barlow-condensed)", "sans-serif"],
      },
      borderRadius: {
        card: "0px",
        button: "3px",
        badge: "999px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.08)",
        "card-md": "0 4px 6px rgba(0,0,0,0.07)",
        "card-lg": "0 10px 15px rgba(0,0,0,0.1)",
      },
    },
  },
  plugins: [],
};
export default config;
