/**
 * Backup Health — trust through visibility: overall state, last backup time,
 * storage, anything still waiting to upload, and metadata snapshots (daily
 * automatic; on-demand button).
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/auth';
import { useLibraryQ, useStatusQ } from '../state/data';
import { useToast } from '../state/ui';
import { useRegisterList } from '../state/view';
import { PhotoGrid } from '../components/PhotoGrid';
import { ViewHead } from '../components/chrome';
import { fmtBytes, fmtCount } from '../lib/format';
import { SVG_CHECK, SVG_CLOCK, Svg } from '../lib/icons';

interface Snap {
  name: string;
  bytes: number;
  createdAt: number;
}

export function BackupHealthView() {
  const { client } = useAuth();
  const toast = useToast();
  const statusQ = useStatusQ();
  const libQ = useLibraryQ();
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const [busy, setBusy] = useState(false);

  const photos = libQ.data || [];
  const pending = useMemo(() => photos.filter((p) => p.uploadState === 'pending'), [photos]);
  useRegisterList(pending);

  const s = statusQ.data;
  const online = !statusQ.isError;
  const lastBackup = s?.library?.lastBackupAt ? new Date(s.library.lastBackupAt) : null;

  const loadSnaps = () => {
    fetch('/api/backup/snapshots', { headers: client.authHeaders() })
      .then((r) => r.json())
      .then((j) => setSnaps(j.snapshots ?? []))
      .catch(() => setSnaps([]));
  };
  useEffect(loadSnaps, [client]);

  const snapshotNow = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/backup/snapshot', {
        method: 'POST',
        headers: client.authHeaders(),
      });
      if (!res.ok) throw new Error();
      toast('Snapshot saved');
      loadSnaps();
    } catch {
      toast('Could not take snapshot');
    }
    setBusy(false);
  };

  const healthy = online && pending.length === 0;

  return (
    <>
      <ViewHead title="Backup Health" />
      <div id="grid">
        <div className={'bh-hero' + (healthy ? ' ok' : online ? ' warn' : ' bad')}>
          <Svg className="bh-hero-ico" html={healthy ? SVG_CHECK : SVG_CLOCK} />
          <div>
            <div className="bh-hero-title">
              {!online
                ? 'Server unreachable'
                : pending.length > 0
                  ? pending.length + (pending.length === 1 ? ' item' : ' items') + ' waiting to upload'
                  : 'Everything is backed up'}
            </div>
            <div className="bh-hero-sub">
              {lastBackup
                ? 'Last backup ' +
                  lastBackup.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                  ' · ' +
                  lastBackup.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                : 'No backups recorded yet'}
            </div>
          </div>
        </div>

        <div className="bh-cards">
          <div className="bh-card">
            <div className="bh-num">{(s?.library?.photos ?? 0).toLocaleString('en-US')}</div>
            <div className="bh-label">Photos</div>
          </div>
          <div className="bh-card">
            <div className="bh-num">{(s?.library?.videos ?? 0).toLocaleString('en-US')}</div>
            <div className="bh-label">Videos</div>
          </div>
          <div className="bh-card">
            <div className="bh-num">{s ? fmtBytes(s.storage.usedBytes) : '—'}</div>
            <div className="bh-label">of {s ? fmtBytes(s.storage.totalBytes) : '—'} used</div>
            <div className="bh-bar">
              <div
                className="bh-bar-fill"
                style={{
                  width: s && s.storage.totalBytes > 0
                    ? Math.min(100, (s.storage.usedBytes / s.storage.totalBytes) * 100) + '%'
                    : '0%',
                }}
              />
            </div>
          </div>
          <div className="bh-card">
            <div className="bh-num">{s?.server?.name ?? '—'}</div>
            <div className="bh-label">
              {s?.server?.version ? 'server v' + s.server.version : 'server'}
            </div>
          </div>
        </div>

        <section className="bh-section">
          <div className="bh-section-head">
            <h2>Metadata snapshots</h2>
            <button type="button" className="vh-btn" disabled={busy} onClick={snapshotNow}>
              <span>{busy ? 'Saving…' : 'Snapshot now'}</span>
            </button>
          </div>
          <p className="bh-note">
            A dated copy of your library's metadata (accounts, albums, edits, share links) is saved
            automatically every day into <code>snapshots/</code> inside your data folder — pair it
            with any file-level backup of the folder itself and a disk failure can't take your
            library's structure with it. The newest 30 are kept.
          </p>
          {snaps === null ? (
            <div className="bh-note">Loading…</div>
          ) : snaps.length === 0 ? (
            <div className="bh-note">No snapshots yet — the first one is taken within an hour of the gateway starting.</div>
          ) : (
            <div className="bh-snaps">
              {snaps.slice(0, 7).map((sn) => (
                <div key={sn.name} className="bh-snap">
                  <span className="bh-snap-name">{sn.name}</span>
                  <span className="bh-snap-meta">
                    {fmtBytes(sn.bytes)} ·{' '}
                    {new Date(sn.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              ))}
              {snaps.length > 7 ? (
                <div className="bh-note">+ {snaps.length - 7} older</div>
              ) : null}
            </div>
          )}
        </section>

        {pending.length > 0 ? (
          <section className="bh-section">
            <div className="bh-section-head">
              <h2>Waiting to upload · {fmtCount(pending.length)}</h2>
            </div>
            <PhotoGrid list={pending} grouped={false} />
          </section>
        ) : null}
      </div>
    </>
  );
}
