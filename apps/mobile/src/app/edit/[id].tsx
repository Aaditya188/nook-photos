/**
 * Mobile photo editor — non-destructive recipes rendered by the gateway (the
 * same sharp pipeline as the web editor). Adjust sliders + Filter presets post
 * the recipe to /edit/preview for a pixel-accurate preview; Save PUTs the
 * recipe, Revert DELETEs it. Mirrors apps/web/src/components/Editor.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, PanResponder, LayoutChangeEvent, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNookClient } from '@nook/core';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

type Adjust = {
  brightness: number; contrast: number; saturation: number; warmth: number;
  highlights: number; shadows: number; vignette: number; sharpen: number;
};
const NEUTRAL: Adjust = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, highlights: 0, shadows: 0, vignette: 0, sharpen: 0 };

const SLIDERS: { key: keyof Adjust; label: string; min: number; max: number; center: number }[] = [
  { key: 'brightness', label: 'Brightness', min: 50, max: 150, center: 100 },
  { key: 'contrast', label: 'Contrast', min: 50, max: 150, center: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, center: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, center: 0 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 200, center: 100 },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100, center: 0 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, center: 0 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100, center: 0 },
];

const FILTERS: { name: string; adjust: Partial<Adjust> }[] = [
  { name: 'Original', adjust: {} },
  { name: 'Punch', adjust: { contrast: 116, saturation: 120, shadows: 12 } },
  { name: 'Golden', adjust: { warmth: 42, brightness: 104, saturation: 108, vignette: 18 } },
  { name: 'Cool', adjust: { warmth: -38, contrast: 106, highlights: -10 } },
  { name: 'Fade', adjust: { contrast: 84, brightness: 108, saturation: 86, shadows: 18 } },
  { name: 'Mono', adjust: { saturation: 0, contrast: 112 } },
  { name: 'Noir', adjust: { saturation: 0, contrast: 130, brightness: 92, vignette: 32 } },
  { name: 'Dream', adjust: { brightness: 106, saturation: 112, highlights: 16 } },
];

type Transform = { rotate: number; flipH: boolean; flipV: boolean };
const NO_TRANSFORM: Transform = { rotate: 0, flipH: false, flipV: false };
type Crop = { x: number; y: number; w: number; h: number };
const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
const isFullCrop = (c: Crop | null) => !c || (c.x < 0.001 && c.y < 0.001 && c.w > 0.999 && c.h > 0.999);

function buildRecipe(a: Adjust, tf: Transform, crop: Crop | null): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (tf.rotate) r.rotate = tf.rotate;
  if (tf.flipH) r.flipH = true;
  if (tf.flipV) r.flipV = true;
  if (!isFullCrop(crop)) r.crop = crop;
  if (a.brightness !== 100) r.brightness = a.brightness / 100;
  if (a.contrast !== 100) r.contrast = a.contrast / 100;
  if (a.saturation !== 100) r.saturation = a.saturation / 100;
  if (a.warmth !== 0) r.warmth = a.warmth / 100;
  if (a.highlights !== 0) r.highlights = a.highlights / 100;
  if (a.shadows !== 0) r.shadows = a.shadows / 100;
  if (a.vignette !== 0) r.vignette = a.vignette / 100;
  if (a.sharpen !== 0) r.sharpen = a.sharpen / 100;
  return r;
}

export default function EditScreen() {
  const t = useTheme();
  const client = useNookClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<'crop' | 'adjust' | 'filters'>('adjust');
  const [adjust, setAdjust] = useState<Adjust>(NEUTRAL);
  const [transform, setTransform] = useState<Transform>(NO_TRANSFORM);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [hadEdit, setHadEdit] = useState(false);
  const seq = useRef(0);
  // Crop stage measurements: the contain-fit image rect inside the preview box.
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(1); // image w/h

  const baseUri = id ? client.thumbUrl(id, 1024) : '';
  const dirty =
    JSON.stringify(adjust) !== JSON.stringify(NEUTRAL) ||
    JSON.stringify(transform) !== JSON.stringify(NO_TRANSFORM) ||
    !isFullCrop(crop);

  // The displayed image rectangle within the preview box (contain fit).
  const imageRect = (() => {
    if (box.w <= 0 || box.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
    const boxAspect = box.w / box.h;
    let w = box.w, h = box.h;
    if (aspect > boxAspect) h = box.w / aspect; else w = box.h * aspect;
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  })();

  // Load any existing recipe.
  useEffect(() => {
    if (!id) return;
    fetch(`${client.baseUrl}/api/photos/${id}/edit`, { headers: client.authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.edited || !j.recipe) return;
        setHadEdit(true);
        const r = j.recipe;
        setTransform({ rotate: r.rotate ?? 0, flipH: !!r.flipH, flipV: !!r.flipV });
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
  }, [id, client]);

  // Debounced server preview.
  useEffect(() => {
    if (!id) return;
    if (!dirty) { setPreview(null); return; }
    const mine = ++seq.current;
    setRendering(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${client.baseUrl}/api/photos/${id}/edit/preview`, {
          method: 'POST',
          headers: { ...client.authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRecipe(adjust, transform, crop)),
        });
        if (!res.ok || mine !== seq.current) return;
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onload = () => { if (mine === seq.current) { setPreview(reader.result as string); setRendering(false); } };
        reader.readAsDataURL(blob);
      } catch {
        setRendering(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [id, adjust, transform, crop, dirty, client]);

  const save = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      await fetch(`${client.baseUrl}/api/photos/${id}/edit`, {
        method: 'PUT',
        headers: { ...client.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRecipe(adjust, transform, crop)),
      });
      router.back();
    } catch {
      setBusy(false);
    }
  }, [id, adjust, transform, crop, client]);

  const revert = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      await fetch(`${client.baseUrl}/api/photos/${id}/edit`, { method: 'DELETE', headers: client.authHeaders() });
      router.back();
    } catch {
      setBusy(false);
    }
  }, [id, client]);

  const activeFilter = (() => {
    for (const f of FILTERS) {
      const merged = { ...NEUTRAL, ...f.adjust };
      if (JSON.stringify(merged) === JSON.stringify(adjust)) return f.name;
    }
    return null;
  })();

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Top bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: t.spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={8}><Text variant="body" color="#fff">Cancel</Text></Pressable>
        <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
          {(['crop', 'adjust', 'filters'] as const).map((tb) => (
            <Pressable key={tb} onPress={() => setTab(tb)}>
              <Text variant="titleSmall" color={tab === tb ? t.colors.primaryContainer : 'rgba(255,255,255,0.6)'} style={{ textTransform: 'capitalize' }}>{tb}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={save} hitSlop={8} disabled={busy}>
          <Text variant="body" color={t.colors.primaryContainer} style={{ fontWeight: '700' }}>{busy ? '…' : 'Save'}</Text>
        </Pressable>
      </View>

      {/* Preview */}
      <View
        style={{ flex: 1, padding: t.spacing.md }}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width - t.spacing.md * 2, h: e.nativeEvent.layout.height - t.spacing.md * 2 })}>
        <Image
          source={tab === 'crop' || !preview ? { uri: baseUri, headers: client.authHeaders() } : { uri: preview }}
          style={{ flex: 1, width: '100%' }}
          contentFit="contain"
          transition={120}
          onLoad={(e) => { const s = e.source; if (s?.width && s?.height) setAspect(s.width / s.height); }}
        />
        {tab === 'crop' && imageRect.w > 0 ? (
          <CropOverlay rect={imageRect} pad={t.spacing.md} crop={crop ?? FULL_CROP} onChange={setCrop} accent={t.colors.primaryContainer} />
        ) : null}
        {rendering && tab !== 'crop' ? (
          <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 6 }}>
            <ActivityIndicator size="small" color={t.colors.primaryContainer} />
          </View>
        ) : null}
      </View>

      {/* Controls */}
      <View style={{ maxHeight: 320, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }}>
        {tab === 'crop' ? (
          <View style={{ paddingVertical: t.spacing.lg, gap: t.spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <TransformBtn icon="rotate-left" label="Rotate left" onPress={() => setTransform((tf) => ({ ...tf, rotate: (tf.rotate + 270) % 360 }))} />
              <TransformBtn icon="rotate-right" label="Rotate right" onPress={() => setTransform((tf) => ({ ...tf, rotate: (tf.rotate + 90) % 360 }))} />
              <TransformBtn icon="flip" label="Flip H" active={transform.flipH} onPress={() => setTransform((tf) => ({ ...tf, flipH: !tf.flipH }))} />
              <TransformBtn icon="flip" label="Flip V" active={transform.flipV} rotate90 onPress={() => setTransform((tf) => ({ ...tf, flipV: !tf.flipV }))} />
              <TransformBtn icon="crop-free" label="Reset crop" onPress={() => setCrop(null)} />
            </View>
            <Text variant="caption" color="rgba(255,255,255,0.5)" style={{ textAlign: 'center' }}>
              Drag the corners to crop. Rotate in 90° steps or flip.
            </Text>
          </View>
        ) : tab === 'adjust' ? (
          <ScrollView>
            {SLIDERS.map((s) => (
              <EditSlider
                key={s.key}
                label={s.label}
                value={adjust[s.key]}
                min={s.min}
                max={s.max}
                center={s.center}
                onChange={(v) => setAdjust((a) => ({ ...a, [s.key]: v }))}
              />
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: t.spacing.md }}>
              <Pressable onPress={() => { setAdjust(NEUTRAL); setTransform(NO_TRANSFORM); setCrop(null); }} disabled={!dirty}>
                <Text variant="body" color={dirty ? '#fff' : 'rgba(255,255,255,0.4)'}>Reset all</Text>
              </Pressable>
              {hadEdit ? (
                <Pressable onPress={revert} disabled={busy}>
                  <Text variant="body" color="#ff6b8a">Revert to original</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.md, paddingVertical: t.spacing.sm }}>
            {FILTERS.map((f) => {
              const on = activeFilter === f.name || (f.name === 'Original' && !dirty);
              return (
                <Pressable key={f.name} onPress={() => setAdjust({ ...NEUTRAL, ...f.adjust })} style={{ alignItems: 'center', gap: 6 }}>
                  <Image
                    source={{ uri: baseUri, headers: client.authHeaders() }}
                    style={{ width: 72, height: 72, borderRadius: 10, borderWidth: on ? 2 : 0, borderColor: t.colors.primaryContainer }}
                    contentFit="cover"
                  />
                  <Text variant="caption" color={on ? t.colors.primaryContainer : 'rgba(255,255,255,0.7)'}>{f.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

/** Pure-JS slider (no native dep): a track with a draggable thumb. */
/**
 * Freeform crop rectangle over the contain-fit image. Corner handles resize,
 * the body drags; the rect is emitted as fractions (0..1) of the image so the
 * gateway's sharp `extract` can apply it. `rect`/`pad` place it in stage coords.
 */
function CropOverlay({ rect, pad, crop, onChange, accent }: {
  rect: { x: number; y: number; w: number; h: number };
  pad: number;
  crop: Crop;
  onChange: (c: Crop) => void;
  accent: string;
}) {
  const MIN = 40;
  // Current crop in stage pixel coords (offset by the container padding).
  const px = {
    x: pad + rect.x + crop.x * rect.w,
    y: pad + rect.y + crop.y * rect.h,
    w: crop.w * rect.w,
    h: crop.h * rect.h,
  };
  const start = useRef<{ mode: string; box: typeof px }>({ mode: 'none', box: px });
  const pxRef = useRef(px);
  pxRef.current = px;

  const emit = (b: { x: number; y: number; w: number; h: number }) => {
    onChange({
      x: Math.max(0, Math.min(1, (b.x - pad - rect.x) / rect.w)),
      y: Math.max(0, Math.min(1, (b.y - pad - rect.y) / rect.h)),
      w: Math.max(0.02, Math.min(1, b.w / rect.w)),
      h: Math.max(0.02, Math.min(1, b.h / rect.h)),
    });
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const lx = e.nativeEvent.locationX, ly = e.nativeEvent.locationY;
        const b = pxRef.current;
        const near = (px1: number, py1: number) => Math.hypot(lx - px1, ly - py1) < 36;
        let mode = 'move';
        if (near(b.x, b.y)) mode = 'tl';
        else if (near(b.x + b.w, b.y)) mode = 'tr';
        else if (near(b.x, b.y + b.h)) mode = 'bl';
        else if (near(b.x + b.w, b.y + b.h)) mode = 'br';
        start.current = { mode, box: { ...b } };
      },
      onPanResponderMove: (e, g) => {
        const { mode, box } = start.current;
        const minX = pad + rect.x, minY = pad + rect.y, maxX = pad + rect.x + rect.w, maxY = pad + rect.y + rect.h;
        let { x, y, w, h } = box;
        const dx = g.dx, dy = g.dy;
        if (mode === 'move') {
          x = Math.max(minX, Math.min(maxX - w, box.x + dx));
          y = Math.max(minY, Math.min(maxY - h, box.y + dy));
        } else {
          let x1 = box.x, y1 = box.y, x2 = box.x + box.w, y2 = box.y + box.h;
          if (mode === 'tl') { x1 = Math.max(minX, Math.min(x2 - MIN, box.x + dx)); y1 = Math.max(minY, Math.min(y2 - MIN, box.y + dy)); }
          if (mode === 'tr') { x2 = Math.min(maxX, Math.max(x1 + MIN, box.x + box.w + dx)); y1 = Math.max(minY, Math.min(y2 - MIN, box.y + dy)); }
          if (mode === 'bl') { x1 = Math.max(minX, Math.min(x2 - MIN, box.x + dx)); y2 = Math.min(maxY, Math.max(y1 + MIN, box.y + box.h + dy)); }
          if (mode === 'br') { x2 = Math.min(maxX, Math.max(x1 + MIN, box.x + box.w + dx)); y2 = Math.min(maxY, Math.max(y1 + MIN, box.y + box.h + dy)); }
          x = x1; y = y1; w = x2 - x1; h = y2 - y1;
        }
        emit({ x, y, w, h });
      },
    }),
  ).current;

  const mask = 'rgba(0,0,0,0.55)';
  const handle = (left: number, top: number) => (
    <View style={{ position: 'absolute', left: left - 11, top: top - 11, width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: accent, backgroundColor: 'rgba(0,0,0,0.25)' }} />
  );

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} {...responder.panHandlers}>
      {/* Dim everything outside the crop rect */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: px.y, backgroundColor: mask }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: px.y + px.h, bottom: 0, backgroundColor: mask }} />
      <View style={{ position: 'absolute', left: 0, top: px.y, width: px.x, height: px.h, backgroundColor: mask }} />
      <View style={{ position: 'absolute', left: px.x + px.w, right: 0, top: px.y, height: px.h, backgroundColor: mask }} />
      {/* Crop border + thirds */}
      <View style={{ position: 'absolute', left: px.x, top: px.y, width: px.w, height: px.h, borderWidth: 1.5, borderColor: '#fff' }}>
        <View style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(255,255,255,0.4)' }} />
        <View style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(255,255,255,0.4)' }} />
        <View style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(255,255,255,0.4)' }} />
        <View style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(255,255,255,0.4)' }} />
      </View>
      {handle(px.x, px.y)}
      {handle(px.x + px.w, px.y)}
      {handle(px.x, px.y + px.h)}
      {handle(px.x + px.w, px.y + px.h)}
    </View>
  );
}

/** A transform action button in the Crop tab (rotate / flip). */
function TransformBtn({ icon, label, onPress, active, rotate90 }: {
  icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void; active?: boolean; rotate90?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 8 }}>
      <View
        style={{
          width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
          backgroundColor: active ? t.colors.primaryContainer : 'rgba(255,255,255,0.08)',
        }}>
        <MaterialIcons name={icon} size={24} color={active ? t.colors.onPrimary : '#fff'} style={rotate90 ? { transform: [{ rotate: '90deg' }] } : undefined} />
      </View>
      <Text variant="caption" color="rgba(255,255,255,0.7)">{label}</Text>
    </Pressable>
  );
}

function EditSlider({ label, value, min, max, center, onChange }: {
  label: string; value: number; min: number; max: number; center: number; onChange: (v: number) => void;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onLayout = (e: LayoutChangeEvent) => { widthRef.current = e.nativeEvent.layout.width; setWidth(e.nativeEvent.layout.width); };

  const frac = (value - min) / (max - min);
  const centerFrac = (center - min) / (max - min);

  const setFromX = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const f = Math.max(0, Math.min(1, x / w));
    onChange(Math.round(min + f * (max - min)));
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
    }),
  ).current;

  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text variant="label" color="rgba(255,255,255,0.85)">{label}</Text>
        <Text variant="label" color={value === center ? 'rgba(255,255,255,0.5)' : t.colors.primaryContainer}>
          {value === center ? '—' : value > center && center !== 0 ? `${value}%` : value}
        </Text>
      </View>
      <View onLayout={onLayout} {...responder.panHandlers} style={{ height: 24, justifyContent: 'center' }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' }}>
          {/* fill from the center tick to the thumb */}
          <View
            style={{
              position: 'absolute',
              height: 3,
              borderRadius: 2,
              backgroundColor: t.colors.primaryContainer,
              left: `${Math.min(frac, centerFrac) * 100}%`,
              width: `${Math.abs(frac - centerFrac) * 100}%`,
            }}
          />
        </View>
        {width > 0 ? (
          <View
            style={{
              position: 'absolute',
              left: Math.max(0, Math.min(width - 16, frac * width - 8)),
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: '#fff',
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
