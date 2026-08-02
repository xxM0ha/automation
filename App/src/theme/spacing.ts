// Spacing scale lifted from the Stitch Tailwind config.
export const spacing = {
  base: 4,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xl2: 48,
  xl3: 64,
  gutter: 24,
  margin: 32,
} as const;

export const radius = {
  none: 0,
  sm: 4,    // DEFAULT
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radius;
