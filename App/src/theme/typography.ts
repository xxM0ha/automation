// Typography tokens mirrored from the Stitch HTML.
// Uses IBM Plex Sans Arabic — loaded in App.tsx via expo-font.
import type { TextStyle } from 'react-native';

export const fontFamily = {
  regular: 'IBMPlexSansArabic-Regular',
  medium: 'IBMPlexSansArabic-Medium',
  semibold: 'IBMPlexSansArabic-SemiBold',
  bold: 'IBMPlexSansArabic-Bold',
} as const;

export const typography = {
  displayLg: {
    fontFamily: fontFamily.bold,
    fontSize: 36,
    lineHeight: 36 * 1.2,
  },
  displayMd: {
    fontFamily: fontFamily.semibold,
    fontSize: 30,
    lineHeight: 30 * 1.2,
  },
  headlineLg: {
    fontFamily: fontFamily.semibold,
    fontSize: 24,
    lineHeight: 24 * 1.3,
  },
  headlineMd: {
    fontFamily: fontFamily.semibold,
    fontSize: 20,
    lineHeight: 20 * 1.4,
  },
  bodyLg: {
    fontFamily: fontFamily.regular,
    fontSize: 18,
    lineHeight: 18 * 1.6,
  },
  bodyMd: {
    fontFamily: fontFamily.regular,
    fontSize: 16,
    lineHeight: 16 * 1.6,
  },
  bodySm: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 14 * 1.5,
  },
  labelLg: {
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    lineHeight: 14 * 1.2,
    letterSpacing: 0.14,
  },
  labelMd: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 12 * 1.2,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
