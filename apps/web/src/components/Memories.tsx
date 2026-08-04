/**
 * Memories strip above the Library grid. Cards come from the server: the indexer
 * precomputes collections (on-this-day, per-year, per-place, per-person) from photo
 * metadata plus the faces/places it already stored -- no models, no GPU on the host.
 * We resolve each memory's photoIds against the loaded library so clicking a card
 * opens the viewer over exactly that set (no extra fetch).
 */
import { useMemo, useRef } from 'react';
import type { PhotoRecord } from '@nook/core';
import { useView } from '../state/view';
import { useMemoriesQ } from '../state/data';
import { useLazyBlob } from './Tile';

function MemCard({
  photo,
  label,
  sub,
  onClick,
}: {
  photo: PhotoRecord;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const { src } = useLazyBlob(
    ref,
    'thumb:' + photo.id + ':384' + (photo.editedAt ? ':' + photo.editedAt : ''),
    photo.thumbUrl + '?w=384' + (photo.editedAt ? '&e=' + photo.editedAt : ''),
  );
  return (
    <button ref={ref} type="button" className="mem-card" onClick={onClick}>
      {src ? <img alt="" draggable={false} src={src} /> : null}
      <div className="mem-grad" />
      <div className="mem-cap">
        <div className="mem-label">{label}</div>
        <div className="mem-count">{sub}</div>
      </div>
    </button>
  );
}

export function MemoriesStrip({ photos }: { photos: PhotoRecord[] }) {
  const { openLightbox, setCurrentList } = useView();
  const memoriesQ = useMemoriesQ();

  const byId = useMemo(() => {
    const m = new Map<string, PhotoRecord>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);

  // Resolve each memory against the loaded library once, dropping any whose photos
  // are all gone (e.g. deleted since the last rebuild).
  const cards = useMemo(() => {
    const out: { id: string; cover: PhotoRecord; label: string; sub: string; list: PhotoRecord[] }[] = [];
    for (const mem of memoriesQ.data ?? []) {
      const list = mem.photoIds.map((id) => byId.get(id)).filter((p): p is PhotoRecord => !!p);
      if (list.length === 0) continue;
      const cover = byId.get(mem.coverPhotoId) ?? list[0];
      out.push({ id: mem.id, cover, label: mem.title, sub: mem.subtitle, list });
    }
    return out;
  }, [memoriesQ.data, byId]);

  if (cards.length === 0) return null;

  return (
    <div className="mem-strip">
      <div className="mem-title">Memories</div>
      <div className="mem-rail">
        {cards.map((c) => (
          <MemCard
            key={c.id}
            photo={c.cover}
            label={c.label}
            sub={c.sub}
            onClick={() => {
              setCurrentList(c.list);
              openLightbox(c.list[0].id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
