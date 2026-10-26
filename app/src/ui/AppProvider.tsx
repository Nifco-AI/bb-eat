import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SqlDriver } from '../db/driver';
import { createExpoDriver } from '../db/expoDriver';
import { migrate } from '../db/migrations';
import { loadPacks } from '../data/loadPacks';
import { ensureBaby, getBaby, getFlag, setFlag } from '../domain/repositories/babies';
import { Baby } from '../domain/types';
import { deviceTimezone, stampFor } from '../domain/time';

interface AppState {
  db: SqlDriver;
  baby: Baby;
  today: string;
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
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const value = useMemo<AppState | null>(() => {
    if (boot.phase !== 'ready') return null;
    const fresh = getBaby(boot.db) ?? boot.baby;
    return {
      db: boot.db,
      baby: fresh,
      today: stampFor(new Date(), fresh.timezone || deviceTimezone()).occurred_local_date,
      demoMode: boot.demoMode,
      setDemoMode: (v: boolean) => {
        setFlag(boot.db, 'demo_mode', v);
        setBoot({ ...boot, demoMode: v });
      },
      revision,
      refresh,
    };
    // `revision` is intentionally a dependency: it is how writes invalidate reads.
  }, [boot, revision, refresh]);

  if (boot.phase === 'loading') return renderLoading();
  if (boot.phase === 'error') return renderError(boot.message, () => setAttempt((a) => a + 1));
  return <Ctx.Provider value={value!}>{children}</Ctx.Provider>;
}
