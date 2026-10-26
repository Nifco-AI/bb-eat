import { Platform, TextStyle } from 'react-native';

/**
 * A warm, calm palette. Backgrounds are soft cream rather than pure white so
 * long evening use is easier on the eyes; accents are muted sage and
 * terracotta rather than saturated "app" colours.
 *
 * Every text/background pair used in the app meets WCAG AA (>= 4.5:1). This is
 * not cosmetic: captions carry the safety and "unknown" disclaimers, so they
 * must stay legible in a dim room at 3am. Measured against the cream
 * background #FBF7F0 — textMuted 7.0:1, textFaint 5.4:1, sage 6.6:1,
 * terracotta 5.2:1, amber 5.9:1, danger 6.3:1, info 6.7:1; white on each solid
 * accent is between 5.5:1 and 7.2:1.
 */
export const colors = {
  bg: '#FBF7F0',
  surface: '#FFFFFF',
  surfaceAlt: '#F4EEE4',
  border: '#E6DCCC',
  borderStrong: '#D4C6B0',

  text: '#3A3430',
  textMuted: '#5C534B',
  textFaint: '#6B625A',
  onAccent: '#FFFFFF',

  sage: '#42603D',
  sageSoft: '#E8EFE6',
  terracotta: '#A4512F',
  terracottaSoft: '#F7E7DF',
  amber: '#7A5B10',
  amberSoft: '#FBF0D8',

  danger: '#9A3F36',
  dangerSoft: '#F8E4E1',
  info: '#3C5B73',
  infoSoft: '#E4EDF3',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

/** Android accessibility guidance: no interactive target smaller than 48dp. */
export const MIN_TOUCH = 48;

export const typography: Record<string, TextStyle> = {
  display: { fontSize: 28, fontWeight: '700', color: colors.text, lineHeight: 36 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, lineHeight: 28 },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', color: colors.text, lineHeight: 22 },
  bodyStrong: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '400', color: colors.textFaint, lineHeight: 17 },
  number: { fontSize: 26, fontWeight: '700', color: colors.text, lineHeight: 32 },
};

export const shadow =
  Platform.OS === 'android'
    ? { elevation: 2 }
    : {
        shadowColor: '#5A4A38',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      };
