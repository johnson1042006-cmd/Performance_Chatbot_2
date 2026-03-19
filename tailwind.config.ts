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
        primary: "#1a1a2e",
        accent: "#e63946",
        success: "#2dc653",
        warning: "#f4a261",
        background: "#f8f9fb",
        surface: "#ffffff",
        border: "#e8eaed",
        "text-primary": "#111827",
        "text-secondary": "#6b7280",
        "ai-badge": "#7c3aed",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        card: "10px",
        button: "6px",
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
