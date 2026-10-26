import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SqlDriver } from '../db/driver';
import { createExpoDriver } from '../db/expoDriver';
import { migrate } from '../db/migrations';
import { loadPacks } from '../data/loadPacks';
import { ensureBaby, getBaby, getFlag, setFlag } from '../domain/repositories/babies';
import { Baby } from '../domain/types';
import { deviceTimezone, localTimeFrom, offsetMinutesFor, stampFor } from '../domain/time';

interface AppState {
  db: SqlDriver;
  baby: Baby;
  today: string;
  /**
   * Current local wall-clock time, recomputed on the same tick as `today`.
   * Forms read it from here rather than calling the clock during render, so an
   * open form keeps offering the real current time instead of its mount time.
   */
  nowTime: string;
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  /** Bumped after every write so screens re-read from SQLite rather than caching. */
  revision: number;
  refresh: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

type Boot =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; db: SqlDriver; baby: Baby; demoMode: boolean };

export function AppProvider({
  children,
  renderLoading,
  renderError,
}: {
  children: React.ReactNode;
  renderLoading: () => React.ReactElement;
  renderError: (message: string, retry: () => void) => React.ReactElement;
}) {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Migrating and loading the knowledge packs (several thousand WHO rows) is
    // synchronous and takes long enough to drop the first frame. Deferring it
    // past this tick lets the loading screen actually paint first.
    const handle = setTimeout(() => {
    try {
      const db = createExpoDriver();
      migrate(db);
      loadPacks(db);
      const baby = ensureBaby(db);
      if (!cancelled) {
        setBoot({ phase: 'ready', db, baby, demoMode: getFlag(db, 'demo_mode', false) });
      }
    } catch (e) {
      if (!cancelled) {
        setBoot({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [attempt]);

  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  // An app left open across local midnight must roll over to the new day on
  // its own, otherwise records would keep landing on yesterday.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const value = useMemo<AppState | null>(() => {
    if (boot.phase !== 'ready') return null;
    const fresh = getBaby(boot.db) ?? boot.baby;
    const tz = fresh.timezone || deviceTimezone();
    const now = new Date();
    return {
      db: boot.db,
      baby: fresh,
      today: stampFor(now, tz).occurred_local_date,
      nowTime: localTimeFrom(now.getTime(), offsetMinutesFor(now, tz)),
      demoMode: boot.demoMode,
      setDemoMode: (v: boolean) => {
        setFlag(boot.db, 'demo_mode', v);
        setBoot({ ...boot, demoMode: v });
      },
      revision,
      refresh,
    };
    // `revision` is intentionally a dependency: it is how writes invalidate reads.
    // `tick` recomputes `today` so an open app crosses local midnight correctly.
  }, [boot, revision, refresh, tick]);

  if (boot.phase === 'loading') return renderLoading();
  if (boot.phase === 'error') return renderError(boot.message, () => setAttempt((a) => a + 1));
  return <Ctx.Provider value={value!}>{children}</Ctx.Provider>;
}
