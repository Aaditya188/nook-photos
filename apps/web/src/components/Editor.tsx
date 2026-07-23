/**
 * Photo editor v2 — non-destructive recipes with a pixel-accurate preview.
 *
 * Interaction model: while a slider moves, the base image gets an instant CSS
 * approximation; 350ms after the last change the server renders the exact
 * result (POST /edit/preview — the same pipeline that renders saves), which
 * replaces the approximation. Crop/straighten are edited on the base with a
 * live transform + marquee. Includes Auto enhance (histogram), per-preset
 * live filter thumbnails, and press-and-hold before/after.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PhotoRecord } from '@nook/core';
import { useAuth } from '../state/auth';
import { applyPhotoUpdate } from '../state/data';
import { useToast } from '../state/ui';
import { getBlobUrl, flushPhotoBlobs } from '../lib/blobCache';
import { Svg } from '../lib/icons';

export interface EditRecipe {
  rotate?: 0 | 90 | 180 | 270;
  straighten?: number;
  flipH?: boolean;
  flipV?: boolean;
  crop?: { x: number; y: number; w: number; h: number };
  brightness?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
  highlights?: number;
  shadows?: number;
  vignette?: number;
  sharpen?: number;
}

const SVG_ROTATE =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 1 0-2.3 6.3M20 4.5V11h-6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_FLIP_H =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 3" stroke-linecap="round"/><path d="M8.5 7L4 12l4.5 5zM15.5 7L20 12l-4.5 5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const SVG_FLIP_V =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 3" stroke-linecap="round"/><path d="M7 8.5L12 4l5 4.5zM7 15.5L12 20l5-4.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const SVG_WAND =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M6 18L16.5 7.5M14.5 5.5l1-2.5 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1zM5 6l.7-1.8L7.5 3.5 5.7 2.8 5 1l-.7 1.8-1.8.7 1.8.7zM19.5 14.5l.6-1.5.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

type Tab = 'crop' | 'adjust' | 'filters';

interface Adjust {
  brightness: number; // % (100 neutral)
  contrast: number;
  saturation: number;
  warmth: number; // -100..100
  highlights: number; // -100..100
  shadows: number; // -100..100
  vignette: number; // 0..100
  sharpen: number; // 0..100
}
const NEUTRAL: Adjust = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  highlights: 0,
  shadows: 0,
  vignette: 0,
  sharpen: 0,
};

const PRESETS: { name: string; adjust: Partial<Adjust> }[] = [
  { name: 'Original', adjust: {} },
  { name: 'Auto', adjust: {} }, // replaced by histogram result at runtime
  { name: 'Punch', adjust: { contrast: 116, saturation: 120, shadows: 12 } },
  { name: 'Golden', adjust: { warmth: 42, brightness: 104, saturation: 108, vignette: 18 } },
  { name: 'Cool', adjust: { warmth: -38, contrast: 106, highlights: -10 } },
  { name: 'Fade', adjust: { contrast: 84, brightness: 108, saturation: 86, shadows: 18 } },
  { name: 'Mono', adjust: { saturation: 0, contrast: 112 } },
  { name: 'Noir', adjust: { saturation: 0, contrast: 130, brightness: 92, vignette: 32 } },
  { name: 'Dream', adjust: { brightness: 106, saturation: 112, highlights: 16, sharpen: 0 } },
];

const ASPECTS: { name: string; ratio: number | null }[] = [
  { name: 'Free', ratio: null },
  { name: '1:1', ratio: 1 },
  { name: '4:3', ratio: 4 / 3 },
  { name: '3:4', ratio: 3 / 4 },
  { name: '16:9', ratio: 16 / 9 },
];

/** CSS approximation used ONLY while a slider is moving. */
function cssApprox(a: Adjust): string {
  const f = [
    `brightness(${a.brightness / 100})`,
    `contrast(${a.contrast / 100})`,
    `saturate(${a.saturation / 100})`,
  ];
  if (a.warmth > 0) f.push(`sepia(${(a.warmth / 100) * 0.32})`);
  else if (a.warmth < 0) f.push(`hue-rotate(${(-a.warmth / 100) * 12}deg)`);
  // Rough stand-ins; the server preview replaces these within ~350ms.
  if (a.shadows) f.push(`brightness(${1 + (a.shadows / 100) * 0.08})`);
  if (a.highlights) f.push(`contrast(${1 - (a.highlights / 100) * 0.05})`);
  return f.join(' ');
}

export function Editor({ photo: p, onClose }: { photo: PhotoRecord; onClose: () => void }) {
  const { client } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('adjust');
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [straighten, setStraighten] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [adjust, setAdjust] = useState<Adjust>(NEUTRAL);
  const [aspect, setAspect] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [hadEdit, setHadEdit] = useState(false);
  const [baseSrc, setBaseSrc] = useState<string | null>(null);
  const [accurateSrc, setAccurateSrc] = useState<string | null>(null);
  const [accurateFresh, setAccurateFresh] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [autoAdjust, setAutoAdjust] = useState<Partial<Adjust> | null>(null);

  // ---- load base + existing recipe ----
  useEffect(() => {
    let alive = true;
    getBlobUrl('edsrc:' + p.id, p.thumbUrl + '?w=1024&raw=1', { priority: true }).then((u) => {
      if (alive && u) setBaseSrc(u);
    });
    fetch('/api/photos/' + p.id + '/edit', { headers: client.authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.edited) return;
        setHadEdit(true);
        const r = j.recipe as EditRecipe;
        if (r.rotate) setRotate(r.rotate);
        if (r.straighten) setStraighten(r.straighten);
        setFlipH(!!r.flipH);
        setFlipV(!!r.flipV);
        if (r.crop) setCrop(r.crop);
        setAdjust({
          brightness: Math.round((r.brightness ?? 1) * 100),
          contrast: Math.round((r.contrast ?? 1) * 100),
          saturation: Math.round((r.saturation ?? 1) * 100),
          warmth: Math.round((r.warmth ?? 0) * 100),
          highlights: Math.round((r.highlights ?? 0) * 100),
          shadows: Math.round((r.shadows ?? 0) * 100),
          vignette: Math.round((r.vignette ?? 0) * 100),
          sharpen: Math.round((r.sharpen ?? 0) * 100),
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const buildRecipe = useCallback((): EditRecipe => {
    const r: EditRecipe = {};
    if (rotate) r.rotate = rotate;
    if (Math.abs(straighten) > 0.05) r.straighten = straighten;
    if (flipH) r.flipH = true;
    if (flipV) r.flipV = true;
    if (crop) r.crop = crop;
    if (adjust.brightness !== 100) r.brightness = adjust.brightness / 100;
    if (adjust.contrast !== 100) r.contrast = adjust.contrast / 100;
    if (adjust.saturation !== 100) r.saturation = adjust.saturation / 100;
    if (adjust.warmth !== 0) r.warmth = adjust.warmth / 100;
    if (adjust.highlights !== 0) r.highlights = adjust.highlights / 100;
    if (adjust.shadows !== 0) r.shadows = adjust.shadows / 100;
    if (adjust.vignette !== 0) r.vignette = adjust.vignette / 100;
    if (adjust.sharpen !== 0) r.sharpen = adjust.sharpen / 100;
    return r;
  }, [rotate, straighten, flipH, flipV, crop, adjust]);

  // ---- pixel-accurate preview, debounced after the last change ----
  const previewSeq = useRef(0);
  const previewUrl = useRef<string | null>(null);
  useEffect(() => {
    setAccurateFresh(false);
    if (tab === 'crop') return; // crop tab edits on the live base
    const seq = ++previewSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/photos/' + p.id + '/edit/preview', {
          method: 'POST',
          headers: { ...client.authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRecipe()),
        });
        if (!res.ok || seq !== previewSeq.current) return;
        const url = URL.createObjectURL(await res.blob());
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url;
        setAccurateSrc(url);
        setAccurateFresh(true);
      } catch {
        /* keep the approximation */
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, tab, rotate, straighten, flipH, flipV, crop, adjust]);
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  // ---- auto enhance from the base histogram ----
  const computeAuto = useCallback((): Partial<Adjust> | null => {
    if (!baseSrc) return null;
    const img = document.querySelector('.ed-canvas img') as HTMLImageElement | null;
    if (!img || !img.naturalWidth) return null;
    const c = document.createElement('canvas');
    const size = 128;
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    const lums: number[] = [];
    let satSum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      lums.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const mx = Math.max(r, g, b);
      satSum += mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
    }
    lums.sort((a, b) => a - b);
    const p5 = lums[Math.floor(lums.length * 0.05)] / 255;
    const p50 = lums[Math.floor(lums.length * 0.5)] / 255;
    const p95 = lums[Math.floor(lums.length * 0.95)] / 255;
    const meanSat = satSum / (d.length / 4);
    const out: Partial<Adjust> = {};
    // Stretch flat exposures, brighten dark mids, tame blown highlights.
    if (p95 - p5 < 0.75) out.contrast = Math.round(100 + Math.min(24, (0.8 - (p95 - p5)) * 60));
    if (p50 < 0.42) out.brightness = Math.round(100 + Math.min(20, (0.46 - p50) * 90));
    if (p5 < 0.06) out.shadows = Math.round(Math.min(28, (0.08 - p5) * 350));
    if (p95 > 0.97) out.highlights = -Math.round(Math.min(24, (p95 - 0.95) * 500));
    if (meanSat < 0.28) out.saturation = Math.round(100 + Math.min(18, (0.3 - meanSat) * 100));
    return Object.keys(out).length ? out : { contrast: 106, saturation: 106 };
  }, [baseSrc]);

  const applyAuto = () => {
    const auto = autoAdjust ?? computeAuto();
    if (!auto) return;
    setAutoAdjust(auto);
    setAdjust({ ...NEUTRAL, ...auto });
  };

  const finishWith = (editedAt: number | undefined) => {
    applyPhotoUpdate(qc, { ...p, editedAt } as PhotoRecord);
    flushPhotoBlobs(p.id);
    onClose();
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/photos/' + p.id + '/edit', {
        method: 'PUT',
        headers: { ...client.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRecipe()),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      toast(j.edited ? 'Edit saved' : 'Reverted to original');
      finishWith(j.edited ? j.editedAt : undefined);
    } catch {
      setBusy(false);
      toast('Could not save edit');
    }
  };

  const revert = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/photos/' + p.id + '/edit', {
        method: 'DELETE',
        headers: client.authHeaders(),
      });
      toast('Reverted to original');
      finishWith(undefined);
    } catch {
      setBusy(false);
      toast('Could not revert');
    }
  };

  const transformCss = useMemo(() => {
    const t: string[] = [];
    if (rotate) t.push(`rotate(${rotate}deg)`);
    if (Math.abs(straighten) > 0.05) t.push(`rotate(${straighten}deg)`);
    if (flipH) t.push('scaleX(-1)');
    if (flipV) t.push('scaleY(-1)');
    return t.join(' ') || undefined;
  }, [rotate, straighten, flipH, flipV]);

  // What the stage shows: base while comparing or cropping; the accurate
  // server render when fresh; otherwise base + CSS approximation.
  const showAccurate = tab !== 'crop' && accurateFresh && accurateSrc && !comparing;
  const stageSrc = showAccurate ? accurateSrc! : baseSrc;
  const stageFilter = comparing || showAccurate || tab === 'crop' ? undefined : cssApprox(adjust);
  const stageTransform = showAccurate ? undefined : transformCss;

  const slider = (label: string, key: keyof Adjust, min: number, max: number) => (
    <label key={key} className="ed-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={adjust[key]}
        onChange={(e) => setAdjust({ ...adjust, [key]: Number(e.target.value) })}
        onDoubleClick={() => setAdjust({ ...adjust, [key]: NEUTRAL[key] })}
      />
      <em>{key === 'brightness' || key === 'contrast' || key === 'saturation' ? adjust[key] + '%' : adjust[key]}</em>
    </label>
  );

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label="Edit photo">
      <div className="ed-topbar">
        <button type="button" className="ed-btn ghost" onClick={onClose}>
          Cancel
        </button>
        <div className="ed-tabs">
          {(['crop', 'adjust', 'filters'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={'ed-tab' + (tab === t ? ' active' : '')}
              onClick={() => setTab(t)}
            >
              {t === 'crop' ? 'Crop' : t === 'adjust' ? 'Adjust' : 'Filters'}
            </button>
          ))}
        </div>
        <div className="ed-top-right">
          <button
            type="button"
            className="ed-btn ghost"
            title="Hold to compare with the original"
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
          >
            Before
          </button>
          {hadEdit ? (
            <button type="button" className="ed-btn ghost" disabled={busy} onClick={revert}>
              Revert
            </button>
          ) : null}
          <button type="button" className="ed-btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="ed-stage">
        <div className="ed-canvas" style={{ transform: stageTransform }}>
          {stageSrc ? (
            <img src={stageSrc} alt="" style={{ filter: stageFilter }} draggable={false} />
          ) : null}
          {tab === 'crop' && baseSrc ? (
            <CropBox crop={crop} aspect={aspect} onChange={setCrop} />
          ) : null}
          {tab !== 'crop' && !accurateFresh && !comparing ? (
            <span className="ed-refining" aria-hidden="true" />
          ) : null}
        </div>
      </div>

      <div className="ed-panel">
        {tab === 'crop' ? (
          <div className="ed-crop-panel">
            <div className="ed-row">
              <button type="button" className="ed-tool" title="Rotate 90°" onClick={() => { setRotate(((rotate + 90) % 360) as 0 | 90 | 180 | 270); setCrop(null); }}>
                <Svg html={SVG_ROTATE} />
              </button>
              <button type="button" className={'ed-tool' + (flipH ? ' active' : '')} title="Flip horizontal" onClick={() => setFlipH((v) => !v)}>
                <Svg html={SVG_FLIP_H} />
              </button>
              <button type="button" className={'ed-tool' + (flipV ? ' active' : '')} title="Flip vertical" onClick={() => setFlipV((v) => !v)}>
                <Svg html={SVG_FLIP_V} />
              </button>
              <span className="ed-sep" />
              {ASPECTS.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  className={'ed-chip' + (aspect === a.ratio ? ' active' : '')}
                  onClick={() => {
                    setAspect(a.ratio);
                    if (a.ratio) setCrop({ x: 0.125, y: 0.125, w: 0.75, h: 0.75 });
                  }}
                >
                  {a.name}
                </button>
              ))}
              {crop ? (
                <button type="button" className="ed-chip" onClick={() => setCrop(null)}>
                  Clear crop
                </button>
              ) : null}
            </div>
            <label className="ed-slider ed-straighten">
              <span>Straighten</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.5}
                value={straighten}
                onChange={(e) => setStraighten(Number(e.target.value))}
                onDoubleClick={() => setStraighten(0)}
              />
              <em>{straighten.toFixed(1)}°</em>
            </label>
          </div>
        ) : null}

        {tab === 'adjust' ? (
          <div className="ed-groups">
            <div className="ed-group">
              <div className="ed-group-head">
                <span>Light</span>
                <button type="button" className="ed-chip ed-auto" onClick={applyAuto}>
                  <Svg html={SVG_WAND} /> Auto
                </button>
              </div>
              {slider('Brightness', 'brightness', 40, 180)}
              {slider('Contrast', 'contrast', 40, 180)}
              {slider('Highlights', 'highlights', -100, 100)}
              {slider('Shadows', 'shadows', -100, 100)}
            </div>
            <div className="ed-group">
              <div className="ed-group-head"><span>Color</span></div>
              {slider('Saturation', 'saturation', 0, 220)}
              {slider('Warmth', 'warmth', -100, 100)}
            </div>
            <div className="ed-group">
              <div className="ed-group-head"><span>Effects</span></div>
              {slider('Vignette', 'vignette', 0, 100)}
              {slider('Sharpen', 'sharpen', 0, 100)}
              <button type="button" className="ed-chip" onClick={() => setAdjust(NEUTRAL)}>
                Reset all
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'filters' ? (
          <div className="ed-row ed-filters">
            {PRESETS.map((f) => {
              const preset = f.name === 'Auto' ? { ...(autoAdjust ?? computeAuto() ?? {}) } : f.adjust;
              const a = { ...NEUTRAL, ...preset } as Adjust;
              return (
                <button
                  key={f.name}
                  type="button"
                  className="ed-preset"
                  onClick={() => {
                    if (f.name === 'Auto') applyAuto();
                    else setAdjust({ ...NEUTRAL, ...f.adjust });
                  }}
                >
                  {baseSrc ? (
                    <span
                      className="ed-preset-thumb"
                      style={{ backgroundImage: `url(${baseSrc})`, filter: cssApprox(a) }}
                    />
                  ) : (
                    <span className="ed-preset-thumb" />
                  )}
                  <span className="ed-preset-name">{f.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Draggable/resizable crop marquee with rule-of-thirds guides. */
function CropBox({
  crop,
  aspect,
  onChange,
}: {
  crop: { x: number; y: number; w: number; h: number } | null;
  aspect: number | null;
  onChange: (c: { x: number; y: number; w: number; h: number }) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const drag = useRef<{
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const begin = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, orig: { ...c } };
    const parent = boxRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / rect.width;
      const dy = (ev.clientY - d.startY) / rect.height;
      let { x, y, w, h } = d.orig;
      if (d.mode === 'move') {
        x = Math.min(1 - w, Math.max(0, x + dx));
        y = Math.min(1 - h, Math.max(0, y + dy));
      } else {
        if (d.mode.includes('w')) {
          const nx = Math.min(x + w - 0.05, Math.max(0, x + dx));
          w = w + (x - nx);
          x = nx;
        }
        if (d.mode.includes('e')) w = Math.min(1 - x, Math.max(0.05, w + dx));
        if (d.mode.includes('n')) {
          const ny = Math.min(y + h - 0.05, Math.max(0, y + dy));
          h = h + (y - ny);
          y = ny;
        }
        if (d.mode.includes('s')) h = Math.min(1 - y, Math.max(0.05, h + dy));
        if (aspect) {
          const boxAR = rect.width / rect.height;
          h = Math.min(1 - y, (w * boxAR) / aspect);
        }
      }
      onChange({ x, y, w, h });
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <div
      ref={boxRef}
      className="ed-crop"
      style={{
        left: c.x * 100 + '%',
        top: c.y * 100 + '%',
        width: c.w * 100 + '%',
        height: c.h * 100 + '%',
      }}
      onPointerDown={begin('move')}
    >
      <span className="ed-thirds ed-thirds-v" />
      <span className="ed-thirds ed-thirds-h" />
      <span className="ed-h nw" onPointerDown={begin('nw')} />
      <span className="ed-h ne" onPointerDown={begin('ne')} />
      <span className="ed-h sw" onPointerDown={begin('sw')} />
      <span className="ed-h se" onPointerDown={begin('se')} />
    </div>
  );
}
