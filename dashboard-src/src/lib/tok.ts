// Reads a design token (space-separated rgb triplet CSS var) at render time so SVG colors follow the active theme.
export const tok = (name: string, alpha?: number): string => {
  const v = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(`--${name}-rgb`).trim() : "";
  const rgb = v || "127 142 166";
  return alpha === undefined ? `rgb(${rgb})` : `rgb(${rgb} / ${alpha})`;
};
