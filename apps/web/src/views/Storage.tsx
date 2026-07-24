/**
 * Storage — two utility views over the library, computed client-side:
 *  • StorageView: usage breakdown (photos vs videos, by year, largest items).
 *  • DuplicatesView: likely-duplicate sets (identical bytes + dimensions), with
 *    per-copy selection and a bulk delete that reclaims space.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PhotoRecord } from '@nook/core';
import { storageInsights, findDuplicateGroups, refineDuplicates } from '@nook/core';
import { useLibraryQ, useStatusQ, useActions } from '../state/data';
import { useView, useRegisterList } from '../state/view';
import { useModals, useToast } from '../state/ui';
import { ViewHead } from '../components/chrome';
import { getBlobUrl } from '../lib/blobCache';
import { fmtBytes } from '../lib/format';

const n = (v: number) => v.toLocaleString('en-US');

export function MiniThumb({ photo, onClick, size = 200 }: { photo: PhotoRecord; onClick?: () => void; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getBlobUrl(
      'mini:' + photo.id + ':' + size,
      photo.thumbUrl + '?w=' + size + (photo.editedAt ? '&e=' + photo.editedAt : ''),
    ).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [photo.id, photo.thumbUrl, photo.editedAt, size]);
  return (
    <button type="button" className="mini-thumb" onClick={onClick} title={photo.filename}>
      {src ? <img alt="" src={src} draggable={false} className="loaded" /> : null}
      {photo.mediaType === 'video' ? <span className="mini-badge">▶</span> : null}
    </button>
  );
}

// -------------------------------------------------------------------- storage

export function StorageView() {
  const libQ = useLibraryQ();
  const statusQ = useStatusQ();
  const { openLightbox } = useView();
  const photos = libQ.data || [];
  const ins = useMemo(() => storageInsights(photos), [photos]);
  useRegisterList(ins.largest);

  const st = statusQ.data?.storage;
  const maxYear = Math.max(1, ...ins.byYear.map((y) => y.bytes));

  return (
    <>
      <ViewHead title="Storage" />
      <div id="grid">
        <div className="ins-wrap">
          <div className="ins-cards">
            <div className="ins-card">
              <div className="ins-num">{fmtBytes(ins.total.bytes)}</div>
              <div className="ins-label">
                {n(ins.total.count)} items
                {st ? ' · of ' + fmtBytes(st.totalBytes) + ' allocated' : ''}
              </div>
              {st && st.totalBytes > 0 ? (
                <div className="ins-meter">
                  <div className="ins-meter-fill" style={{ width: Math.min(100, (st.usedBytes / st.totalBytes) * 100) + '%' }} />
                </div>
              ) : null}
            </div>
            <div className="ins-card">
              <div className="ins-num">{fmtBytes(ins.photos.bytes)}</div>
              <div className="ins-label">{n(ins.photos.count)} photos</div>
            </div>
            <div className="ins-card">
              <div className="ins-num">{fmtBytes(ins.videos.bytes)}</div>
              <div className="ins-label">{n(ins.videos.count)} videos</div>
            </div>
          </div>

          {ins.byYear.length ? (
            <section className="ins-section">
              <h2 className="ins-h">By year</h2>
              <div className="ins-years">
                {ins.byYear.map((y) => (
                  <div key={y.year} className="ins-year">
                    <div className="ins-year-top">
                      <span className="ins-year-label">{y.year}</span>
                      <span className="ins-year-val">{fmtBytes(y.bytes)} · {n(y.count)}</span>
                    </div>
                    <div className="ins-bar">
                      <div className="ins-bar-fill" style={{ width: (y.bytes / maxYear) * 100 + '%' }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {ins.largest.length ? (
            <section className="ins-section">
              <h2 className="ins-h">Largest items</h2>
              <div className="ins-largest">
                {ins.largest.map((p) => (
                  <div key={p.id} className="ins-large">
                    <MiniThumb photo={p} onClick={() => openLightbox(p.id)} />
                    <div className="ins-large-size">{fmtBytes(p.bytes)}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- duplicates

/** Perceptual hash (dHash, 64-bit hex) of a photo's thumbnail via a tiny canvas. */
async function dHashOf(photo: PhotoRecord): Promise<string> {
  const url = await getBlobUrl('dhash:' + photo.id, photo.thumbUrl + '?w=64' + (photo.editedAt ? '&e=' + photo.editedAt : ''));
  if (!url) return '';
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = 9, H = 8;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve('');
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        let bits = '';
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W - 1; x++) {
            const i = (y * W + x) * 4;
            const j = (y * W + x + 1) * 4;
            const l1 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const l2 = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            bits += l1 < l2 ? '1' : '0';
          }
        let hex = '';
        for (let k = 0; k < 64; k += 4) hex += parseInt(bits.slice(k, k + 4), 2).toString(16);
        resolve(hex);
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = url;
  });
}

export function DuplicatesView() {
  const libQ = useLibraryQ();
  const actions = useActions();
  const modals = useModals();
  const toast = useToast();
  const { openLightbox } = useView();
  const photos = libQ.data || [];
  // Cheap pre-filter (same bytes + dimensions), then verify content with a
  // perceptual hash so coincidental size collisions aren't reported as dupes.
  const candidates = useMemo(() => findDuplicateGroups(photos), [photos]);
  const candidatePhotos = useMemo(() => candidates.flatMap((g) => g.photos), [candidates]);
  const [hashes, setHashes] = useState<Map<string, string>>(new Map());
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!candidatePhotos.length) {
      setHashes(new Map());
      setScanning(false);
      return;
    }
    setScanning(true);
    (async () => {
      const m = new Map<string, string>();
      for (const p of candidatePhotos) {
        if (!alive) return;
        m.set(p.id, await dHashOf(p));
      }
      if (alive) {
        setHashes(m);
        setScanning(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [candidatePhotos]);

  const groups = useMemo(() => (scanning ? [] : refineDuplicates(candidates, hashes)), [scanning, candidates, hashes]);

  const flat = useMemo(() => groups.flatMap((g) => g.photos), [groups]);
  useRegisterList(flat);

  // Default selection: every copy except the newest in each group.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    const s = new Set<string>();
    for (const g of groups) g.photos.slice(1).forEach((p) => s.add(p.id));
    setSelected(s);
  }, [groups]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const freed = useMemo(
    () => flat.filter((p) => selected.has(p.id)).reduce((s, p) => s + (p.bytes || 0), 0),
    [flat, selected],
  );

  const removeSelected = async () => {
    const targets = flat.filter((p) => selected.has(p.id));
    if (!targets.length) return;
    const ok = await modals.confirm({
      title: 'Delete ' + targets.length + (targets.length === 1 ? ' copy?' : ' copies?'),
      body: 'They move to Recently Deleted and free about ' + fmtBytes(freed) + '.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    let done = 0;
    for (const p of targets) {
      try {
        await actions.deletePhoto(p);
        done += 1;
      } catch {
        /* per-item tolerance */
      }
    }
    toast(done + (done === 1 ? ' copy' : ' copies') + ' moved to Recently Deleted');
  };

  return (
    <>
      <ViewHead title="Duplicates" />
      <div id="grid">
        <div className="ins-wrap">
          {scanning ? (
            <div className="ins-empty">
              <div className="ins-num">Scanning…</div>
              <div className="ins-label">Comparing {candidatePhotos.length} candidates by image content.</div>
            </div>
          ) : groups.length === 0 ? (
            <div className="ins-empty">
              <div className="ins-num">No duplicates found</div>
              <div className="ins-label">
                Nook matches items by image content (perceptual hash). Nothing to reclaim right now.
              </div>
            </div>
          ) : (
            <>
              <div className="ins-cards">
                <div className="ins-card">
                  <div className="ins-num">{groups.length}</div>
                  <div className="ins-label">duplicate {groups.length === 1 ? 'set' : 'sets'}</div>
                </div>
                <div className="ins-card">
                  <div className="ins-num">{fmtBytes(groups.reduce((s, g) => s + g.wastedBytes, 0))}</div>
                  <div className="ins-label">reclaimable</div>
                </div>
              </div>

              <div className="dup-groups">
                {groups.map((g) => (
                  <div key={g.key} className="dup-group">
                    <div className="dup-group-head">
                      {g.photos.length} copies · {fmtBytes(g.photos[0].bytes)} each · frees {fmtBytes(g.wastedBytes)}
                    </div>
                    <div className="dup-row">
                      {g.photos.map((p, i) => {
                        const on = selected.has(p.id);
                        return (
                          <div key={p.id} className={'dup-item' + (on ? ' selected' : '')}>
                            <MiniThumb photo={p} onClick={() => openLightbox(p.id)} />
                            <button
                              type="button"
                              className={'dup-check' + (on ? ' on' : '')}
                              onClick={() => toggle(p.id)}
                              title={on ? 'Marked for deletion' : 'Keep'}
                            >
                              {on ? '✕' : i === 0 ? 'keep' : '○'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="dup-bar">
          <span>{selected.size} selected · frees {fmtBytes(freed)}</span>
          <button type="button" className="m-btn primary danger" onClick={removeSelected}>
            Delete copies
          </button>
        </div>
      ) : null}
    </>
  );
}
