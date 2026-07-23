/**
 * One photo tile: shimmer → authed blob thumbnail (lazy via a shared
 * IntersectionObserver) → fade-in. Same markup/classes as the vanilla tile.
 */
import { memo, useEffect, useRef, useState } from 'react';
import type { PhotoRecord } from '@nook/core';
import { getBlobUrl } from '../lib/blobCache';
import { gridThumbW } from '../hooks/useGridZoom';
import { fmtDuration } from '../lib/format';
import { SVG_CHECK, SVG_HEART_FILL, Svg } from '../lib/icons';

// Shared lazy-load observer: fetch a tile's thumb only near the viewport.
type VisibleCb = () => void;
const visibleCbs = new WeakMap<Element, VisibleCb>();
const observer =
  typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            observer!.unobserve(e.target);
            const cb = visibleCbs.get(e.target);
            visibleCbs.delete(e.target);
            if (cb) cb();
          }
        },
        { rootMargin: '600px 0px' },
      )
    : null;

export function useLazyBlob(
  hostRef: React.RefObject<HTMLElement | null>,
  key: string,
  url: string,
): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !url) return;
    let alive = true;
    const load = () => {
      getBlobUrl(key, url).then((u) => {
        if (!alive) return;
        if (u) setSrc(u);
        else setFailed(true);
      });
    };
    if (observer) {
      visibleCbs.set(host, load);
      observer.observe(host);
      return () => {
        alive = false;
        visibleCbs.delete(host);
        observer.unobserve(host);
      };
    }
    load();
    return () => {
      alive = false;
    };
  }, [hostRef, key, url]);

  return { src, failed };
}

export interface TileProps {
  photo: PhotoRecord;
  selectMode: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  /** Explicit size from the justified-row layout. */
  style?: React.CSSProperties;
}

export const Tile = memo(function Tile({
  photo: p,
  selectMode,
  selected,
  onOpen,
  onToggleSelect,
  style,
}: TileProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const w = gridThumbW();
  const { src, failed } = useLazyBlob(
    ref,
    'thumb:' + p.id + ':' + w,
    p.thumbUrl + (p.thumbUrl.includes('?') ? '&' : '?') + 'w=' + w,
  );

  const cls =
    'tile' +
    (selectMode ? ' selectable' : '') +
    (selected ? ' selected' : '') +
    (!src && !failed ? ' thumb-loading' : '') +
    (failed ? ' thumb-failed' : '');

  return (
    <button
      ref={ref}
      type="button"
      className={cls}
      data-id={p.id}
      aria-label={p.filename}
      style={style}
      onClick={() => (selectMode ? onToggleSelect(p.id) : onOpen(p.id))}
    >
      {src ? (
        <img
          alt=""
          draggable={false}
          decoding="async"
          src={src}
          className={imgLoaded ? 'loaded' : undefined}
          onLoad={() => setImgLoaded(true)}
        />
      ) : (
        <img alt="" draggable={false} />
      )}
      {p.mediaType === 'video' ? (
        <span className="badge-duration">{fmtDuration(p.duration)}</span>
      ) : null}
      {p.favorite ? <Svg className="tile-heart" html={SVG_HEART_FILL} /> : null}
      {p.uploadState === 'pending' ? <span className="chip-uploading">uploading…</span> : null}
      {selectMode ? <Svg className="tile-check" html={SVG_CHECK} /> : null}
    </button>
  );
});
