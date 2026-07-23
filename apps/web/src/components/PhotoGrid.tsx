/**
 * Justified chunked virtual grid — Google-Photos-style rows + virtual scrolling.
 *
 * Layout: photos keep their real aspect ratio and are packed into rows of a
 * target height (the zoom level); each row scales to exactly fill the
 * container width. Grouped views get month headers + day headers.
 *
 * Virtualization: the list splits into chunks of whole segments (~CHUNK_TARGET
 * photos — whole days when grouped). Every chunk renders a shell <div>; active
 * chunks hold real tiles, the rest are fixed-height spacers. Because row
 * heights are computed (not measured), spacer heights are exact up to header
 * chrome, which is measured once — so the scrollbar spans the whole library
 * from first paint and scrollbar-drag anywhere works.
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
const GAP = 2;

// Header chrome fallbacks; corrected by measurement after first render.
const DEFAULT_DAY_H = 40;
const DEFAULT_MONTH_H = 68;

interface Row {
  start: number; // index into list
  count: number;
  h: number; // computed row height (px)
  widths: number[]; // computed tile widths (px)
}

interface Segment {
  label: string | null; // day label (null in flat mode)
  monthLabel: string | null; // set on the first day segment of each month
  start: number;
  count: number;
  rows: Row[];
  pixels: number; // rows + inter-row gaps (no header chrome)
}

interface Chunk {
  segs: Segment[];
  start: number;
}

function aspect(p: PhotoRecord): number {
  const w = Number(p.width) || 0;
  const h = Number(p.height) || 0;
  if (w > 0 && h > 0) return Math.min(3, Math.max(0.4, w / h));
  return 1;
}

/** Pack one segment's photos into justified rows for the given width. */
function packRows(list: PhotoRecord[], start: number, count: number, width: number, targetH: number): Row[] {
  const rows: Row[] = [];
  let i = start;
  const end = start + count;
  while (i < end) {
    // Greedily take photos until the row (at target height) would overflow.
    let sumAR = 0;
    let n = 0;
    while (i + n < end) {
      const nextAR = sumAR + aspect(list[i + n]);
      const rowW = nextAR * targetH + n * GAP;
      n += 1;
      sumAR = nextAR;
      if (rowW >= width) break;
    }
    const usable = width - (n - 1) * GAP;
    const filled = sumAR * targetH >= usable - 1;
    // Full rows stretch/shrink to fill exactly; a trailing partial row keeps
    // the target height and leaves the remainder empty (Google Photos style).
    const h = filled ? usable / sumAR : targetH;
    const widths: number[] = [];
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const w = Math.round(aspect(list[i + k]) * h);
      widths.push(w);
      acc += w;
    }
    // Absorb rounding drift into the last tile of a filled row.
    if (filled && n > 0) widths[n - 1] += usable - acc;
    rows.push({ start: i, count: n, h: Math.round(h), widths });
    i += n;
  }
  return rows;
}

function monthLabelOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  return d.toLocaleDateString('en-US', {
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function buildSegments(
  list: PhotoRecord[],
  grouped: boolean,
  width: number,
  targetH: number,
): Segment[] {
  const segs: Segment[] = [];
  if (grouped) {
    let curKey: string | null = null;
    let curMonth: string | null = null;
    for (let i = 0; i < list.length; i++) {
      const key = dayKeyOf(list[i].createdAt);
      if (curKey !== key) {
        curKey = key;
        const d = new Date(list[i].createdAt);
        const mKey = d.getFullYear() + '-' + d.getMonth();
        segs.push({
          label: dayLabelOf(list[i].createdAt),
          monthLabel: mKey !== curMonth ? monthLabelOf(list[i].createdAt) : null,
          start: i,
          count: 0,
          rows: [],
          pixels: 0,
        });
        curMonth = mKey;
      }
      segs[segs.length - 1].count += 1;
    }
  } else {
    for (let i = 0; i < list.length; i += CHUNK_TARGET) {
      segs.push({
        label: null,
        monthLabel: null,
        start: i,
        count: Math.min(CHUNK_TARGET, list.length - i),
        rows: [],
        pixels: 0,
      });
    }
  }
  for (const s of segs) {
    s.rows = packRows(list, s.start, s.count, width, targetH);
    s.pixels = s.rows.reduce((h, r) => h + r.h + GAP, 0);
  }
  return segs;
}

function toChunks(segs: Segment[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let si = 0; si < segs.length; ) {
    const c: Chunk = { segs: [], start: segs[si].start };
    let n = 0;
    while (si < segs.length && n < CHUNK_TARGET) {
      c.segs.push(segs[si]);
      n += segs[si].count;
      si += 1;
    }
    chunks.push(c);
  }
  return chunks;
}

export function PhotoGrid({ list, grouped }: { list: PhotoRecord[]; grouped: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chunkEls = useRef<(HTMLDivElement | null)[]>([]);
  const zoomIdx = useGridZoomIndex();
  const targetH = GRID_ZOOM_LEVELS[zoomIdx];

  // Container width drives the whole layout; measured, then kept fresh.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, []);

  const chunks = useMemo(() => {
    if (width <= 0) return [] as Chunk[];
    return toChunks(buildSegments(list, grouped, width, targetH));
  }, [list, grouped, width, targetH]);

  // Header chrome, measured from the first rendered chunk.
  const chrome = useRef({ day: DEFAULT_DAY_H, month: DEFAULT_MONTH_H });
  const measureChrome = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const day = host.querySelector('.day-header') as HTMLElement | null;
    const month = host.querySelector('.month-header') as HTMLElement | null;
    if (day) chrome.current.day = day.offsetHeight;
    if (month) chrome.current.month = month.offsetHeight;
  }, []);

  const chunkHeight = useCallback(
    (c: Chunk) => {
      let h = 0;
      for (const s of c.segs) {
        if (s.monthLabel) h += chrome.current.month;
        if (s.label) h += chrome.current.day;
        h += s.pixels;
      }
      return Math.round(h);
    },
    [],
  );

  const [active, setActive] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [layoutV, bump] = useState(0);
  const [scrollFrac, setScrollFrac] = useState(0);

  useEffect(() => {
    setActive(new Set([0]));
  }, [chunks]);

  // Month markers at cumulative pixel offsets — powers the timeline scrubber.
  const timeline = useMemo(() => {
    if (!grouped || chunks.length === 0) return null;
    const months: { label: string; y: number }[] = [];
    let y = 0;
    let last = '';
    for (const c of chunks) {
      for (const s of c.segs) {
        const d = new Date(list[s.start].createdAt);
        const key = d.getFullYear() + '-' + d.getMonth();
        if (key !== last) {
          last = key;
          months.push({
            label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            y,
          });
        }
        if (s.monthLabel) y += chrome.current.month;
        if (s.label) y += chrome.current.day;
        y += s.pixels;
      }
    }
    return { months, total: y };
    // layoutV: recompute after header chrome has been measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, list, grouped, layoutV]);

  // Fill/release chunks around the viewport (reads geometry first).
  const virtualize = useCallback(() => {
    const host = hostRef.current;
    if (!host || !host.isConnected || chunks.length === 0) return;
    const min = -CHUNK_KEEP_PX;
    const max = window.innerHeight + CHUNK_KEEP_PX;
    const next = new Set<number>();
    for (let i = 0; i < chunks.length; i++) {
      const el = chunkEls.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom >= min && r.top <= max) next.add(i);
    }
    if (next.size === 0) next.add(0);
    setActive((prev) => {
      let same = prev.size === next.size;
      if (same) for (const i of next) if (!prev.has(i)) { same = false; break; }
      return same ? prev : next;
    });
  }, [chunks]);

  // Timestamp-throttled scroll listener (rAF pauses in embedded webviews).
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
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollFrac(max > 0 ? window.scrollY / max : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [virtualize]);

  // After (re)layout: measure header chrome, refresh spacers, recycle.
  useLayoutEffect(() => {
    measureChrome();
    bump((v) => v + 1);
    virtualize();
  }, [chunks, measureChrome, virtualize]);

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
            style={isActive ? undefined : { height: chunkHeight(c) }}
          >
            {isActive ? <ChunkContent chunk={c} list={list} /> : null}
          </div>
        );
      })}
      {timeline && list.length > 200 ? (
        <TimelineScrubber timeline={timeline} hostRef={hostRef} frac={scrollFrac} />
      ) : null}
    </div>
  );
}

/**
 * Timeline scrubber: a right-edge rail; drag it to fly through years, with a
 * floating month/year bubble (Google-Photos style). Works hand in hand with
 * the virtualizer — jumped-to regions fill in on arrival.
 */
function TimelineScrubber({
  timeline,
  hostRef,
  frac,
}: {
  timeline: { months: { label: string; y: number }[]; total: number };
  hostRef: React.RefObject<HTMLDivElement | null>;
  frac: number;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState(false);
  const [bubble, setBubble] = useState<{ label: string; f: number } | null>(null);

  const scrubTo = useCallback(
    (clientY: number) => {
      const rail = railRef.current;
      if (!rail) return;
      const r = rail.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, f * max);
      const hostTop = (hostRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
      const target = f * max + window.innerHeight * 0.35 - hostTop;
      let label = timeline.months[0]?.label ?? '';
      for (const m of timeline.months) {
        if (m.y <= target) label = m.label;
        else break;
      }
      setBubble({ label, f });
    },
    [hostRef, timeline],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => scrubTo(e.clientY);
    const onUp = () => {
      setDrag(false);
      setTimeout(() => setBubble(null), 350);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, scrubTo]);

  const pos = drag && bubble ? bubble.f : frac;

  return (
    <div
      ref={railRef}
      className={'tl-rail' + (drag ? ' drag' : '')}
      onPointerDown={(e) => {
        e.preventDefault();
        setDrag(true);
        scrubTo(e.clientY);
      }}
    >
      <div className="tl-thumb" style={{ top: 'calc(' + (pos * 100).toFixed(3) + '% - 14px)' }} />
      {drag && bubble ? (
        <div className="tl-bubble" style={{ top: (bubble.f * 100).toFixed(3) + '%' }}>
          {bubble.label}
        </div>
      ) : null}
    </div>
  );
}

const ChunkContent = memo(function ChunkContent({ chunk, list }: { chunk: Chunk; list: PhotoRecord[] }) {
  const { selectMode, selectedIds, toggleSelect, setSelectedMany, openLightbox } = useView();
  return (
    <>
      {chunk.segs.map((s) => {
        const rows = s.rows.map((r) => (
          <div key={r.start} className="jrow" style={{ height: r.h }}>
            {Array.from({ length: r.count }, (_, k) => {
              const p = list[r.start + k];
              return (
                <Tile
                  key={p.id}
                  photo={p}
                  selectMode={selectMode}
                  selected={selectedIds.has(p.id)}
                  onOpen={openLightbox}
                  onToggleSelect={toggleSelect}
                  style={{ width: r.widths[k], height: r.h }}
                />
              );
            })}
          </div>
        ));
        if (!s.label) return <div key={s.start}>{rows}</div>;
        const dayIds: string[] = [];
        for (let i = s.start; i < s.start + s.count; i++) dayIds.push(list[i].id);
        const allSelected = dayIds.length > 0 && dayIds.every((id) => selectedIds.has(id));
        return (
          <section key={s.start} className="day-group">
            {s.monthLabel ? <h2 className="month-header">{s.monthLabel}</h2> : null}
            <h3 className="day-header">
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
            </h3>
            {rows}
          </section>
        );
      })}
    </>
  );
});
