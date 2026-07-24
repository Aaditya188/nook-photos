/**
 * Storage — two utility views over the library, computed client-side:
 *  • StorageView: usage breakdown (photos vs videos, by year, largest items).
 *  • DuplicatesView: likely-duplicate sets (identical bytes + dimensions), with
 *    per-copy selection and a bulk delete that reclaims space.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PhotoRecord } from '@nook/core';
import { storageInsights, findDuplicateGroups } from '@nook/core';
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

export function DuplicatesView() {
  const libQ = useLibraryQ();
  const actions = useActions();
  const modals = useModals();
  const toast = useToast();
  const { openLightbox } = useView();
  const photos = libQ.data || [];
  const groups = useMemo(() => findDuplicateGroups(photos), [photos]);

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
          {groups.length === 0 ? (
            <div className="ins-empty">
              <div className="ins-num">No duplicates found</div>
              <div className="ins-label">
                Nook groups items that share an identical size and dimensions. Nothing to reclaim right now.
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
