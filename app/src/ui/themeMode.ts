/**
 * The parts of the theme that are pure data and pure decisions, kept free of
 * any `react-native` import so they can be unit tested in node.
 *
 * The split matters more than it looks: the bug this guards against is a
 * saved preference quietly turning "follow the system" into a fixed scheme,
 * which would leave a caregiver on a bright screen at 3am with no obvious
 * cause. That is logic worth testing, and it should not need a device.
 */
export type ColorScheme = 'light' | 'dark';

/** What the caregiver chose, which is not the same as what is rendered. */
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export const THEME_MODE_KEY = 'theme_mode';

export function isThemeMode(v: string | null | undefined): v is ThemeMode {
  return v === 'system' || v === 'light' || v === 'dark';
}

/**
 * The caregiver's choice and what is on screen are two different things, and
 * conflating them is the obvious way to get this wrong: storing a resolved
 * 'light'/'dark' would silently convert "follow the system" into "stay light"
 * the first time it was saved, and the phone switching to night mode would
 * then do nothing.
 */
export function resolveScheme(mode: ThemeMode, systemScheme: ColorScheme): ColorScheme {
  return mode === 'system' ? systemScheme : mode;
}

/** Anything unrecognised, including a value from a newer version, follows the system. */
export function modeFromStored(stored: string | null | undefined): ThemeMode {
  return isThemeMode(stored) ? stored : 'system';
}
