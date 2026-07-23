/**
 * Memories — "On this day": photos taken on today's month/day in previous
 * years, one card per year, above the Library grid. Clicking a card opens the
 * viewer on that year's first photo.
 */
import { useMemo, useRef } from 'react';
import type { PhotoRecord } from '@nook/core';
import { useView } from '../state/view';
import { useLazyBlob } from './Tile';
import { fmtCount } from '../lib/format';

function MemCard({
  photo,
  label,
  count,
  onClick,
}: {
  photo: PhotoRecord;
  label: string;
  count: number;
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
        <div className="mem-count">{fmtCount(count)}</div>
      </div>
    </button>
  );
}

export function MemoriesStrip({ photos }: { photos: PhotoRecord[] }) {
  const { openLightbox } = useView();

  const groups = useMemo(() => {
    const now = new Date();
    const m = now.getMonth();
    const d = now.getDate();
    const y = now.getFullYear();
    const byYear = new Map<number, PhotoRecord[]>();
    for (const p of photos) {
      const dt = new Date(p.createdAt);
      if (dt.getMonth() === m && dt.getDate() === d && dt.getFullYear() < y) {
        const arr = byYear.get(dt.getFullYear());
        if (arr) arr.push(p);
        else byYear.set(dt.getFullYear(), [p]);
      }
    }
    return [...byYear.entries()].sort((a, b) => b[0] - a[0]);
  }, [photos]);

  if (groups.length === 0) return null;

  const thisYear = new Date().getFullYear();
  return (
    <div className="mem-strip">
      <div className="mem-title">Memories · on this day</div>
      <div className="mem-rail">
        {groups.map(([year, list]) => {
          const ago = thisYear - year;
          return (
            <MemCard
              key={year}
              photo={list[0]}
              label={ago === 1 ? '1 year ago' : ago + ' years ago'}
              count={list.length}
              onClick={() => openLightbox(list[0].id)}
            />
          );
        })}
      </div>
    </div>
  );
}
