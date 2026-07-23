/**
 * Drives the backup engine and exposes its live phase to the Backup & Sync screen.
 */
import { create } from 'zustand';
import type { NookClient } from '@nook/core';
import { runBackup, type BackupPhase, type BackupPrefs } from '@/features/sync/engine';

interface SyncState {
  phase: BackupPhase;
  running: boolean;
  cancelRequested: boolean;
  start: (client: NookClient, prefs: BackupPrefs) => Promise<void>;
  cancel: () => void;
}

export const useSync = create<SyncState>((set, get) => ({
  phase: { state: 'idle' },
  running: false,
  cancelRequested: false,

  async start(client, prefs) {
    if (get().running) return;
    set({ running: true, cancelRequested: false, phase: { state: 'permission' } });
    try {
      await runBackup(client, prefs, {
        onPhase: (phase) => set({ phase }),
        isCancelled: () => get().cancelRequested,
      });
    } catch (e) {
      set({ phase: { state: 'error', message: e instanceof Error ? e.message : 'Backup failed' } });
    } finally {
      set({ running: false });
    }
  },

  cancel() {
    set({ cancelRequested: true });
  },
}));
