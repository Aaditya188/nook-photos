/**
 * App settings + theme mode, persisted to secure storage. Backup preferences map
 * to the Backup & Sync screen; honored by the sync engine in Phase 3.
 */
import { create } from 'zustand';
import { STORAGE_KEYS, type ThemeMode } from '@nook/core';
import { secureStorage } from '@/lib/secure-storage';

export interface BackupPrefs {
  wifiOnly: boolean;
  deleteAfterBackup: boolean;
  originalQuality: boolean;
  backgroundBackup: boolean;
}

/** User-facing app preferences (all client-side; no server involved). */
export interface AppPrefs {
  /** Library grid columns (2–5). */
  gridColumns: number;
  /** Haptic feedback on selection/drag. */
  haptics: boolean;
  /** Ask for confirmation before moving a photo to Recently Deleted. */
  confirmDelete: boolean;
  /** Autoplay videos when opened in the viewer. */
  autoplayVideos: boolean;
}

interface SettingsState {
  themeMode: ThemeMode | 'system';
  backup: BackupPrefs;
  prefs: AppPrefs;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setThemeMode: (m: ThemeMode | 'system') => void;
  setBackupPref: <K extends keyof BackupPrefs>(k: K, v: BackupPrefs[K]) => void;
  setPref: <K extends keyof AppPrefs>(k: K, v: AppPrefs[K]) => void;
}

const DEFAULT_BACKUP: BackupPrefs = {
  wifiOnly: true,
  deleteAfterBackup: false,
  originalQuality: true,
  backgroundBackup: true,
};

const DEFAULT_PREFS: AppPrefs = {
  gridColumns: 3,
  haptics: true,
  confirmDelete: false,
  autoplayVideos: true,
};

function clampColumns(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(5, Math.max(2, v)) : 3;
}

async function persist(state: Pick<SettingsState, 'themeMode' | 'backup' | 'prefs'>) {
  await secureStorage.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify({ themeMode: state.themeMode, backup: state.backup, prefs: state.prefs }),
  );
}

export const useSettings = create<SettingsState>((set, get) => ({
  themeMode: 'system',
  backup: DEFAULT_BACKUP,
  prefs: DEFAULT_PREFS,
  hydrated: false,
  async hydrate() {
    try {
      const raw = await secureStorage.getItem(STORAGE_KEYS.settings);
      if (raw) {
        const parsed = JSON.parse(raw);
        const prefs = { ...DEFAULT_PREFS, ...(parsed.prefs ?? {}) };
        prefs.gridColumns = clampColumns(prefs.gridColumns);
        set({
          themeMode: parsed.themeMode ?? 'system',
          backup: { ...DEFAULT_BACKUP, ...(parsed.backup ?? {}) },
          prefs,
        });
      }
    } catch {
      // ignore corrupt settings
    } finally {
      set({ hydrated: true });
    }
  },
  setThemeMode(themeMode) {
    set({ themeMode });
    persist({ themeMode, backup: get().backup, prefs: get().prefs });
  },
  setBackupPref(k, v) {
    const backup = { ...get().backup, [k]: v };
    set({ backup });
    persist({ themeMode: get().themeMode, backup, prefs: get().prefs });
  },
  setPref(k, v) {
    const prefs = { ...get().prefs, [k]: k === 'gridColumns' ? clampColumns(v) : v };
    set({ prefs });
    persist({ themeMode: get().themeMode, backup: get().backup, prefs });
  },
}));
