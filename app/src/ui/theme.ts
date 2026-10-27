import { Platform, TextStyle } from 'react-native';

/**
 * A warm, calm palette in two schemes.
 *
 * Both schemes carry the same keys, so a component never has to ask which
 * scheme is active. The names describe *role*, not appearance: `sage` is "the
 * primary accent", not "a green", which is why the dark scheme can lighten it
 * without any caller changing.
 *
 * Note what `onAccent` does across schemes. In light it is white on a dark
 * sage button; in dark the accent itself becomes light, so `onAccent` flips to
 * near-black. Encoding the foreground alongside the accent is what keeps every
 * `backgroundColor: colors.sage` / `color: colors.onAccent` pair legible
 * without per-scheme branching at the call site.
 *
 * Contrast here is not a claim, it is a test: `scripts/contrast.js` recomputes
 * the WCAG ratio of every pair the app actually renders, in both schemes, and
 * fails if any falls below 4.5:1. Captions carry the safety and "unknown"
 * disclaimers, so they must stay legible in a dim room at 3am.
 */
export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;

  text: string;
  textMuted: string;
  textFaint: string;
  onAccent: string;

  sage: string;
  sageSoft: string;
  terracotta: string;
  terracottaSoft: string;
  amber: string;
  amberSoft: string;

  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
}

export const lightColors: Palette = {
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
};

/**
 * Deliberately not pure black. A #000 background under light text maximises
 * halation on OLED panels, which is the opposite of what a caregiver squinting
 * at a 3am feed needs. These are very dark warm greys, so the app keeps its
 * daytime character at night instead of becoming a different product.
 */
export const darkColors: Palette = {
  bg: '#16140F',
  surface: '#211E19',
  surfaceAlt: '#2A2620',
  border: '#39342C',
  borderStrong: '#564F44',

  text: '#F2ECE1',
  textMuted: '#CFC6B8',
  textFaint: '#B4AB9D',
  onAccent: '#16140F',

  sage: '#9FC894',
  sageSoft: '#23301F',
  terracotta: '#E6A381',
  terracottaSoft: '#33241B',
  amber: '#E3C47F',
  amberSoft: '#2E2715',

  danger: '#F0A39B',
  dangerSoft: '#391F1C',
  info: '#A3C4E0',
  infoSoft: '#1A2630',
};

export * from './themeMode';
import { ColorScheme } from './themeMode';

export function paletteFor(scheme: ColorScheme): Palette {
  return scheme === 'dark' ? darkColors : lightColors;
}

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

export type Typography = Record<string, TextStyle>;

export function makeTypography(c: Palette): Typography {
  return {
    display: { fontSize: 28, fontWeight: '700', color: c.text, lineHeight: 36 },
    title: { fontSize: 20, fontWeight: '700', color: c.text, lineHeight: 28 },
    section: { fontSize: 16, fontWeight: '700', color: c.text, lineHeight: 22 },
    body: { fontSize: 15, fontWeight: '400', color: c.text, lineHeight: 22 },
    bodyStrong: { fontSize: 15, fontWeight: '600', color: c.text, lineHeight: 22 },
    label: { fontSize: 13, fontWeight: '600', color: c.textMuted, lineHeight: 18 },
    caption: { fontSize: 12, fontWeight: '400', color: c.textFaint, lineHeight: 17 },
    number: { fontSize: 26, fontWeight: '700', color: c.text, lineHeight: 32 },
  };
}

/**
 * On Android `elevation` only draws a drop shadow, which is invisible against
 * a dark background: a dark card would sit flat with nothing but its border to
 * separate it. Keep the shadow in light mode and let the border do the work in
 * dark mode.
 */
export function shadowFor(scheme: ColorScheme) {
  if (scheme === 'dark') return { elevation: 0 };
  return Platform.OS === 'android'
    ? { elevation: 2 }
    : {
        shadowColor: '#5A4A38',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      };
}
