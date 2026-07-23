/**
 * Library-metadata snapshots: a dated bundle of db.json + edits.json +
 * shares.json written into DATA_DIR/snapshots. One disk hiccup must never be
 * able to take the library's metadata with it. A daily snapshot is taken
 * automatically while the gateway runs; the Backup Health page can trigger one
 * on demand. Only the newest KEEP are retained.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, DB_PATH } from './config.js';

const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const KEEP = 30;

export interface SnapshotInfo {
  name: string;
  bytes: number;
  createdAt: number;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function readIfExists(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function takeSnapshot(): Promise<SnapshotInfo> {
  await fsp.mkdir(SNAP_DIR, { recursive: true });
  const bundle = {
    takenAt: Date.now(),
    db: await readIfExists(DB_PATH),
    edits: await readIfExists(path.join(DATA_DIR, 'edits.json')),
    shares: await readIfExists(path.join(DATA_DIR, 'shares.json')),
  };
  const name = `nook-snapshot-${stamp()}.json`;
  const file = path.join(SNAP_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(bundle));
  await fsp.rename(tmp, file);
  await prune();
  const st = await fsp.stat(file);
  return { name, bytes: st.size, createdAt: st.mtimeMs };
}

async function prune() {
  const list = await listSnapshots();
  for (const s of list.slice(KEEP)) {
    try {
      await fsp.unlink(path.join(SNAP_DIR, s.name));
    } catch {
      /* best effort */
    }
  }
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  try {
    const names = (await fsp.readdir(SNAP_DIR)).filter(
      (n) => n.startsWith('nook-snapshot-') && n.endsWith('.json'),
    );
    const infos = await Promise.all(
      names.map(async (name) => {
        const st = await fsp.stat(path.join(SNAP_DIR, name));
        return { name, bytes: st.size, createdAt: st.mtimeMs };
      }),
    );
    return infos.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Hourly check; snapshots once per day while the gateway runs. */
export function startSnapshotSchedule() {
  const tick = async () => {
    try {
      const latest = (await listSnapshots())[0];
      if (!latest || Date.now() - latest.createdAt > 24 * 3600_000) {
        if (fs.existsSync(DB_PATH)) await takeSnapshot();
      }
    } catch {
      /* retried next hour */
    }
  };
  void tick();
  setInterval(tick, 3600_000).unref?.();
}
