/**
 * Photo editor — non-destructive. The UI builds a *recipe* (rotate / flip /
 * crop / light & color); saving PUTs it to the gateway, which renders every
 * size from the untouched original. Preview is approximated client-side with
 * CSS transforms + filters; the server render is the source of truth.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PhotoRecord } from '@nook/core';
import { useAuth } from '../state/auth';
import { applyPhotoUpdate } from '../state/data';
import { useToast } from '../state/ui';
import { getBlobUrl, flushPhotoBlobs } from '../lib/blobCache';
import { Svg } from '../lib/icons';

export interface EditRecipe {
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  crop?: { x: number; y: number; w: number; h: number };
  brightness?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
}

const SVG_ROTATE =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 1 0-2.3 6.3M20 4.5V11h-6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_FLIP_H =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 3" stroke-linecap="round"/><path d="M8.5 7L4 12l4.5 5zM15.5 7L20 12l-4.5 5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const SVG_FLIP_V =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 3" stroke-linecap="round"/><path d="M7 8.5L12 4l5 4.5zM7 15.5L12 20l5-4.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

type Tab = 'crop' | 'adjust' | 'filters';

interface Adjust {
  brightness: number; // 40..180 (%)
  contrast: number;
  saturation: number; // 0..220
  warmth: number; // -100..100
}
const NEUTRAL: Adjust = { brightness: 100, contrast: 100, saturation: 100, warmth: 0 };

const PRESETS: { name: string; adjust: Partial<Adjust> }[] = [
  { name: 'Original', adjust: {} },
  { name: 'Punch', adjust: { contrast: 118, saturation: 122 } },
  { name: 'Golden', adjust: { warmth: 45, brightness: 105, saturation: 108 } },
  { name: 'Cool', adjust: { warmth: -40, contrast: 106 } },
  { name: 'Fade', adjust: { contrast: 86, brightness: 108, saturation: 88 } },
  { name: 'Mono', adjust: { saturation: 0, contrast: 112 } },
  { name: 'Noir', adjust: { saturation: 0, contrast: 132, brightness: 92 } },
];

const ASPECTS: { name: string; ratio: number | null }[] = [
  { name: 'Free', ratio: null },
  { name: '1:1', ratio: 1 },
  { name: '4:3', ratio: 4 / 3 },
  { name: '3:4', ratio: 3 / 4 },
  { name: '16:9', ratio: 16 / 9 },
];

export function Editor({
  photo: p,
  onClose,
}: {
  photo: PhotoRecord;
  onClose: () => void;
}) {
  const { client } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('adjust');
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [adjust, setAdjust] = useState<Adjust>(NEUTRAL);
  const [aspect, setAspect] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [hadEdit, setHadEdit] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  // Load the pristine (unedited) preview + any existing recipe.
  useEffect(() => {
    let alive = true;
    getBlobUrl('edsrc:' + p.id, p.thumbUrl + '?w=1024&raw=1', { priority: true }).then((u) => {
      if (alive && u) setSrc(u);
    });
    fetch('/api/photos/' + p.id + '/edit', { headers: client.authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.edited) return;
        setHadEdit(true);
        const r = j.recipe as EditRecipe;
        if (r.rotate) setRotate(r.rotate);
        setFlipH(!!r.flipH);
        setFlipV(!!r.flipV);
        if (r.crop) setCrop(r.crop);
        setAdjust({
          brightness: Math.round((r.brightness ?? 1) * 100),
          contrast: Math.round((r.contrast ?? 1) * 100),
          saturation: Math.round((r.saturation ?? 1) * 100),
          warmth: Math.round((r.warmth ?? 0) * 100),
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const filterCss = useMemo(() => {
    const f = [
      `brightness(${adjust.brightness / 100})`,
      `contrast(${adjust.contrast / 100})`,
      `saturate(${adjust.saturation / 100})`,
    ];
    if (adjust.warmth > 0) f.push(`sepia(${(adjust.warmth / 100) * 0.35})`);
    else if (adjust.warmth < 0) f.push(`hue-rotate(${(-adjust.warmth / 100) * 12}deg)`);
    return f.join(' ');
  }, [adjust]);

  const transformCss = useMemo(() => {
    const t: string[] = [];
    if (rotate) t.push(`rotate(${rotate}deg)`);
    if (flipH) t.push('scaleX(-1)');
    if (flipV) t.push('scaleY(-1)');
    return t.join(' ') || undefined;
  }, [rotate, flipH, flipV]);

  const buildRecipe = (): EditRecipe => {
    const r: EditRecipe = {};
    if (rotate) r.rotate = rotate;
    if (flipH) r.flipH = true;
    if (flipV) r.flipV = true;
    if (crop) r.crop = crop;
    if (adjust.brightness !== 100) r.brightness = adjust.brightness / 100;
    if (adjust.contrast !== 100) r.contrast = adjust.contrast / 100;
    if (adjust.saturation !== 100) r.saturation = adjust.saturation / 100;
    if (adjust.warmth !== 0) r.warmth = adjust.warmth / 100;
    return r;
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
        <div className="ed-canvas" style={{ transform: transformCss }}>
          {src ? <img src={src} alt="" style={{ filter: filterCss }} draggable={false} /> : null}
          {tab === 'crop' && src ? (
            <CropBox crop={crop} aspect={aspect} onChange={setCrop} />
          ) : null}
        </div>
      </div>

      <div className="ed-panel">
        {tab === 'crop' ? (
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
                  if (a.ratio) {
                    // Seed a centered crop at that aspect (in image-fraction space
                    // it renders against the displayed box; server maps the same).
                    setCrop({ x: 0.125, y: 0.125, w: 0.75, h: 0.75 });
                  }
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
        ) : null}

        {tab === 'adjust' ? (
          <div className="ed-sliders">
            {(
              [
                ['Brightness', 'brightness', 40, 180],
                ['Contrast', 'contrast', 40, 180],
                ['Saturation', 'saturation', 0, 220],
                ['Warmth', 'warmth', -100, 100],
              ] as [string, keyof Adjust, number, number][]
            ).map(([label, key, min, max]) => (
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
                <em>{key === 'warmth' ? adjust[key] : adjust[key] + '%'}</em>
              </label>
            ))}
            <button type="button" className="ed-chip" onClick={() => setAdjust(NEUTRAL)}>
              Reset adjustments
            </button>
          </div>
        ) : null}

        {tab === 'filters' ? (
          <div className="ed-row ed-filters">
            {PRESETS.map((f) => (
              <button
                key={f.name}
                type="button"
                className="ed-chip"
                onClick={() => setAdjust({ ...NEUTRAL, ...f.adjust })}
              >
                {f.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Draggable/resizable crop marquee over the displayed image. */
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
          // Constrain height to the aspect (in displayed-box fraction space).
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
      <span className="ed-h nw" onPointerDown={begin('nw')} />
      <span className="ed-h ne" onPointerDown={begin('ne')} />
      <span className="ed-h sw" onPointerDown={begin('sw')} />
      <span className="ed-h se" onPointerDown={begin('se')} />
    </div>
  );
}
