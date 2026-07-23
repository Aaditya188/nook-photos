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

interface SettingsState {
  themeMode: ThemeMode | 'system';
  backup: BackupPrefs;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setThemeMode: (m: ThemeMode | 'system') => void;
  setBackupPref: <K extends keyof BackupPrefs>(k: K, v: BackupPrefs[K]) => void;
}

const DEFAULT_BACKUP: BackupPrefs = {
  wifiOnly: true,
  deleteAfterBackup: false,
  originalQuality: true,
  backgroundBackup: true,
};

async function persist(state: Pick<SettingsState, 'themeMode' | 'backup'>) {
  await secureStorage.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify({ themeMode: state.themeMode, backup: state.backup }),
  );
}

export const useSettings = create<SettingsState>((set, get) => ({
  themeMode: 'system',
  backup: DEFAULT_BACKUP,
  hydrated: false,
  async hydrate() {
    try {
      const raw = await secureStorage.getItem(STORAGE_KEYS.settings);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({
          themeMode: parsed.themeMode ?? 'system',
          backup: { ...DEFAULT_BACKUP, ...(parsed.backup ?? {}) },
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
    persist({ themeMode, backup: get().backup });
  },
  setBackupPref(k, v) {
    const backup = { ...get().backup, [k]: v };
    set({ backup });
    persist({ themeMode: get().themeMode, backup });
  },
}));
