// Material 3 palette mirrored from the Stitch HTML mockups.
// Names match the Tailwind config so designs translate 1:1.

export const colors = {
  primary: '#94F519',           // brand lime — fills (buttons, logo, active states)
  primaryContainer: '#7ed30f',  // deeper lime for stronger fills
  primaryFixed: '#e8ffc6',      // soft lime tint for subtle accent backgrounds
  primaryFixedDim: '#cdf78f',
  onPrimary: '#0a0a0a',         // black text/icons on lime
  onPrimaryContainer: '#0a0a0a',
  onPrimaryFixed: '#1f3d00',
  onPrimaryFixedVariant: '#3d6b00',
  inversePrimary: '#cdf78f',
  surfaceTint: '#94F519',

  secondary: '#505f76',
  secondaryContainer: '#d0e1fb',
  secondaryFixed: '#d3e4fe',
  secondaryFixedDim: '#b7c8e1',
  onSecondary: '#ffffff',
  onSecondaryContainer: '#54647a',
  onSecondaryFixed: '#0b1c30',
  onSecondaryFixedVariant: '#38485d',

  tertiary: '#924700',
  tertiaryContainer: '#b75b00',
  tertiaryFixed: '#ffdcc6',
  tertiaryFixedDim: '#ffb786',
  onTertiary: '#ffffff',
  onTertiaryContainer: '#fffbff',
  onTertiaryFixed: '#311400',
  onTertiaryFixedVariant: '#723600',

  error: '#ba1a1a',
  errorContainer: '#ffdad6',
  onError: '#ffffff',
  onErrorContainer: '#93000a',

  background: '#f7f9fb',
  onBackground: '#191c1e',
  surface: '#f7f9fb',
  surfaceBright: '#f7f9fb',
  surfaceDim: '#d8dadc',
  surfaceVariant: '#e0e3e5',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f2f4f6',
  surfaceContainer: '#eceef0',
  surfaceContainerHigh: '#e6e8ea',
  surfaceContainerHighest: '#e0e3e5',
  onSurface: '#191c1e',
  onSurfaceVariant: '#424754',
  inverseSurface: '#2d3133',
  inverseOnSurface: '#eff1f3',

  outline: '#727785',
  outlineVariant: '#c2c6d6',

  // Semantic helpers used by status pills in the mockups.
  successBg: '#dcfce7',     // green-100
  successFg: '#15803d',     // green-700
  successFgStrong: '#166534', // green-800

  // Slate accents used in the top app bar / bottom nav chrome.
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate900: '#0f172a',
  slate950: '#020617',

  // Tab active background (brand lime tint).
  tabActiveBg: 'rgba(148, 245, 25, 0.18)',
} as const;

export type ColorToken = keyof typeof colors;
