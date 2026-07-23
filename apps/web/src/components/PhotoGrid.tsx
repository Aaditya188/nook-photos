/**
 * Chunked virtual grid — the React port of the vanilla virtual scroller.
 *
 * The list splits into chunks of whole segments (~CHUNK_TARGET photos each —
 * real days in grouped views, row-aligned runs in flat ones). Every chunk
 * renders a shell <div>: active chunks hold real tiles, the rest are
 * fixed-height spacers (estimated, corrected to measured on release), so the
 * scrollbar spans the whole library immediately, scrollbar-drag anywhere
 * works, and the live DOM stays a few hundred tiles at any depth.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PhotoRecord } from '@nook/core';
import { dayKeyOf, dayLabelOf } from '../lib/format';
import { Tile } from './Tile';
import { useView } from '../state/view';
import { GRID_ZOOM_LEVELS, useGridZoomIndex } from '../hooks/useGridZoom';

const CHUNK_TARGET = 120;
const CHUNK_KEEP_PX = 2600;
const GRID_GAP = 2; // must match .day-grid { gap }

interface Segment {
  label: string | null;
  start: number;
  count: number;
}
interface Chunk {
  segs: Segment[];
  start: number;
  count: number;
}

function daySegments(list: PhotoRecord[]): Segment[] {
  const segs: Segment[] = [];
  let curKey: string | null = null;
  for (let i = 0; i < list.length; i++) {
    const key = dayKeyOf(list[i].createdAt);
    if (curKey !== key) {
      curKey = key;
      segs.push({ label: dayLabelOf(list[i].createdAt), start: i, count: 0 });
    }
    segs[segs.length - 1].count += 1;
  }
  return segs;
}

function flatSegments(list: PhotoRecord[], cols: number): Segment[] {
  const per = Math.max(cols * Math.ceil(CHUNK_TARGET / cols), cols);
  const segs: Segment[] = [];
  for (let i = 0; i < list.length; i += per) {
    segs.push({ label: null, start: i, count: Math.min(per, list.length - i) });
  }
  return segs;
}

function toChunks(segs: Segment[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let si = 0; si < segs.length; ) {
    const c: Chunk = { segs: [], start: segs[si].start, count: 0 };
    while (si < segs.length && c.count < CHUNK_TARGET) {
      c.segs.push(segs[si]);
      c.count += segs[si].count;
      si += 1;
    }
    chunks.push(c);
  }
  return chunks;
}

interface Metrics {
  cols: number;
  tileH: number;
  chrome: number;
}

function predictCols(width: number): number {
  const tileMin = GRID_ZOOM_LEVELS[gridZoomIndexSafe()];
  return Math.max(1, Math.floor((width + GRID_GAP) / (tileMin + GRID_GAP)));
}
function gridZoomIndexSafe(): number {
  const i = parseInt(localStorage.getItem('nookGridZoom') || '', 10);
  return Number.isInteger(i) ? Math.max(0, Math.min(GRID_ZOOM_LEVELS.length - 1, i)) : 2;
}

export function PhotoGrid({ list, grouped }: { list: PhotoRecord[]; grouped: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chunkEls = useRef<(HTMLDivElement | null)[]>([]);
  const heights = useRef<Map<number, number>>(new Map());
  const metrics = useRef<Metrics | null>(null);
  const zoomIdx = useGridZoomIndex();

  // Flat mode needs the column count before segmenting; measured after mount.
  const [cols, setCols] = useState(() =>
    predictCols(typeof window !== 'undefined' ? Math.min(window.innerWidth - 300, 1600) : 1200),
  );

  const chunks = useMemo(() => {
    const segs = grouped ? daySegments(list) : flatSegments(list, cols);
    return toChunks(segs);
  }, [list, grouped, cols]);

  const [active, setActive] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [, bump] = useState(0);

  // Reset when the list identity/shape changes.
  useEffect(() => {
    heights.current = new Map();
    metrics.current = null;
    setActive(new Set([0]));
  }, [chunks]);

  const measureMetrics = useCallback(() => {
    for (let i = 0; i < chunks.length; i++) {
      const el = chunkEls.current[i];
      if (!el || !el.firstElementChild) continue;
      const segEl = el.firstElementChild as HTMLElement;
      const grid = (grouped ? segEl.querySelector('.day-grid') : segEl) as HTMLElement | null;
      const tile = grid ? (grid.querySelector('.tile') as HTMLElement | null) : null;
      if (!grid || !tile) continue;
      const colCount = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const tileH = tile.getBoundingClientRect().height;
      const rows = Math.ceil(chunks[i].segs[0].count / colCount);
      const gridH = rows * tileH + (rows - 1) * GRID_GAP;
      const cs = getComputedStyle(segEl);
      const chrome =
        segEl.getBoundingClientRect().height -
        gridH +
        (parseFloat(cs.marginTop) || 0) +
        (parseFloat(cs.marginBottom) || 0);
      metrics.current = { cols: colCount, tileH, chrome: Math.max(0, chrome) };
      return;
    }
  }, [chunks, grouped]);

  const estimate = useCallback(
    (c: Chunk) => {
      const m = metrics.current || {
        cols: 5,
        tileH: 182,
        chrome: grouped ? 46 : GRID_GAP,
      };
      let h = 0;
      for (const s of c.segs) {
        const rows = Math.ceil(s.count / m.cols);
        h += m.chrome + rows * m.tileH + (rows - 1) * GRID_GAP;
      }
      return Math.round(h);
    },
    [grouped],
  );

  // Fill/release chunks around the viewport. Reads all geometry first.
  const virtualize = useCallback(() => {
    const host = hostRef.current;
    if (!host || !host.isConnected) return;
    const min = -CHUNK_KEEP_PX;
    const max = window.innerHeight + CHUNK_KEEP_PX;
    const rects = chunks.map((_, i) => chunkEls.current[i]?.getBoundingClientRect() ?? null);
    const next = new Set<number>();
    for (let i = 0; i < chunks.length; i++) {
      const r = rects[i];
      if (!r) continue;
      if (r.bottom >= min && r.top <= max) next.add(i);
    }
    if (next.size === 0 && chunks.length) next.add(0);
    setActive((prev) => {
      let same = prev.size === next.size;
      if (same) for (const i of next) if (!prev.has(i)) { same = false; break; }
      if (same) return prev;
      // Record measured heights of chunks being released.
      for (const i of prev) {
        if (!next.has(i)) {
          const r = rects[i];
          if (r && r.height > 0) heights.current.set(i, Math.round(r.height));
        }
      }
      return next;
    });
    if (!metrics.current) measureMetrics();
  }, [chunks, measureMetrics]);

  // Throttled global scroll listener (timestamp throttle — rAF pauses in some
  // embedded webviews).
  useEffect(() => {
    let lastAt = 0;
    let pending = false;
    const onScroll = () => {
      const now = Date.now();
      const since = now - lastAt;
      if (since < 90) {
        if (!pending) {
          pending = true;
          setTimeout(() => {
            pending = false;
            onScroll();
          }, 90 - since);
        }
        return;
      }
      lastAt = now;
      virtualize();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [virtualize]);

  // First paint + zoom/resize relayout: measure real geometry, refresh
  // estimates (state bump re-renders spacers), then recycle for the viewport.
  useLayoutEffect(() => {
    measureMetrics();
    // Flat segments are row-aligned for a column count — remeasure it.
    if (!grouped && metrics.current && metrics.current.cols !== cols) {
      setCols(metrics.current.cols);
      return;
    }
    bump((v) => v + 1);
    virtualize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, zoomIdx, grouped]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        metrics.current = null;
        measureMetrics();
        if (!grouped && metrics.current) {
          const m = metrics.current as Metrics;
          if (m.cols !== cols) {
            setCols(m.cols);
            return;
          }
        }
        bump((v) => v + 1);
        virtualize();
      }, 150);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, [grouped, cols, measureMetrics, virtualize]);

  return (
    <div ref={hostRef}>
      {chunks.map((c, i) => {
        const isActive = active.has(i);
        return (
          <div
            key={c.start}
            className="grid-chunk"
            ref={(n) => {
              chunkEls.current[i] = n;
            }}
            style={isActive ? undefined : { height: heights.current.get(i) ?? estimate(c) }}
          >
            {isActive ? <ChunkContent chunk={c} list={list} grouped={grouped} /> : null}
          </div>
        );
      })}
    </div>
  );
}

const ChunkContent = memo(function ChunkContent({
  chunk,
  list,
  grouped,
}: {
  chunk: Chunk;
  list: PhotoRecord[];
  grouped: boolean;
}) {
  const { selectMode, selectedIds, toggleSelect, setSelectedMany, openLightbox } = useView();
  return (
    <>
      {chunk.segs.map((s) => {
        const tiles = [];
        for (let i = s.start; i < s.start + s.count; i++) {
          const p = list[i];
          tiles.push(
            <Tile
              key={p.id}
              photo={p}
              selectMode={selectMode}
              selected={selectedIds.has(p.id)}
              onOpen={openLightbox}
              onToggleSelect={toggleSelect}
            />,
          );
        }
        if (!grouped) {
          // Bare grid (chunk shell measures it directly); keep the 2px row
          // rhythm across sibling grids / chunk boundaries.
          return (
            <div key={s.start} className="day-grid" style={{ marginBottom: GRID_GAP }}>
              {tiles}
            </div>
          );
        }
        const grid = <div className="day-grid">{tiles}</div>;
        const dayIds: string[] = [];
        for (let i = s.start; i < s.start + s.count; i++) dayIds.push(list[i].id);
        const allSelected = dayIds.length > 0 && dayIds.every((id) => selectedIds.has(id));
        return (
          <section key={s.start} className="day-group">
            <h2 className="day-header">
              <span>{s.label}</span>
              {selectMode ? (
                <button
                  type="button"
                  className="day-select-btn"
                  onClick={() => setSelectedMany(dayIds, !allSelected)}
                >
                  {allSelected ? 'Deselect' : 'Select all'}
                </button>
              ) : null}
            </h2>
            {grid}
          </section>
        );
      })}
    </>
  );
});
