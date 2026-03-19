export const colors = {
  primary: "#1a1a2e",
  accent: "#e63946",
  success: "#2dc653",
  warning: "#f4a261",
  background: "#f8f9fb",
  surface: "#ffffff",
  border: "#e8eaed",
  textPrimary: "#111827",
  textSecondary: "#6b7280",
  aiBadge: "#7c3aed",
} as const;

export const shadows = {
  sm: "0 1px 3px rgba(0,0,0,0.08)",
  md: "0 4px 6px rgba(0,0,0,0.07)",
  lg: "0 10px 15px rgba(0,0,0,0.1)",
} as const;

export const radii = {
  card: "10px",
  button: "6px",
  badge: "999px",
} as const;

export const typography = {
  fontFamily: {
    sans: "'Inter', sans-serif",
    mono: "'JetBrains Mono', monospace",
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;
