import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { SqlDriver } from '../db/driver';
import { getSetting, setSetting } from '../domain/repositories/babies';
import { Palette, Typography, makeTypography, paletteFor, shadowFor } from './theme';
import { ColorScheme, THEME_MODE_KEY, ThemeMode, modeFromStored, resolveScheme } from './themeMode';

interface ThemeState {
  /** What is actually on screen right now. */
  scheme: ColorScheme;
  /** What the caregiver asked for; 'system' means "follow the phone". */
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  colors: Palette;
  typography: Typography;
  shadow: ReturnType<typeof shadowFor>;
}

const Ctx = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

function readSystemScheme(): ColorScheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/**
 * Night feeding is the scenario this app is most used in, so following the
 * phone's night mode is the default rather than an option to discover.
 *
 * The override is still offered, because "system" is wrong often enough to
 * matter here: a caregiver may keep the phone in light mode all day and still
 * want this one app dark at 3am, and some Android skins drive night mode off a
 * schedule the caregiver does not control.
 *
 * `useColorScheme()` from react-native is deliberately not used. It is backed
 * by the same `Appearance` module but has historically returned a stale value
 * for the first frames after a cold start on Android; subscribing explicitly
 * and seeding from `getColorScheme()` makes the first paint already correct,
 * which matters because the first paint is the one happening in a dark room.
 */
export function ThemeProvider({ db, children }: { db: SqlDriver | null; children: React.ReactNode }) {
  const [systemScheme, setSystemScheme] = useState<ColorScheme>(readSystemScheme);
  // `db` is null for the brief window before the database is open: the
  // loading and boot-failure screens still have to be drawn, and a caregiver
  // opening the app at night should not be flashed a cream screen first. With
  // no database there is nothing to read a saved choice from, so those frames
  // follow the system.
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return modeFromStored(db ? getSetting(db, THEME_MODE_KEY) : null);
  });

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    // The listener cannot report a change that happened between this
    // component's first render and this subscription, so re-read once. It is
    // queued rather than called inline because a synchronous setState here
    // would re-render every frame of the mount.
    queueMicrotask(() => setSystemScheme(readSystemScheme()));
    return () => sub.remove();
  }, []);

  const setMode = useCallback(
    (m: ThemeMode) => {
      if (db) setSetting(db, THEME_MODE_KEY, m);
      setModeState(m);
    },
    [db],
  );

  const value = useMemo<ThemeState>(() => {
    const scheme = resolveScheme(mode, systemScheme);
    const colors = paletteFor(scheme);
    return { scheme, mode, setMode, colors, typography: makeTypography(colors), shadow: shadowFor(scheme) };
  }, [mode, systemScheme, setMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
