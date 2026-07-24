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

function buildRecipe(a: Adjust): Record<string, number> {
  const r: Record<string, number> = {};
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
  const [tab, setTab] = useState<'adjust' | 'filters'>('adjust');
  const [adjust, setAdjust] = useState<Adjust>(NEUTRAL);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [hadEdit, setHadEdit] = useState(false);
  const seq = useRef(0);

  const baseUri = id ? client.thumbUrl(id, 1024) : '';
  const dirty = JSON.stringify(adjust) !== JSON.stringify(NEUTRAL);

  // Load any existing recipe.
  useEffect(() => {
    if (!id) return;
    fetch(`${client.baseUrl}/api/photos/${id}/edit`, { headers: client.authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.edited || !j.recipe) return;
        setHadEdit(true);
        const r = j.recipe;
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
          body: JSON.stringify(buildRecipe(adjust)),
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
  }, [id, adjust, dirty, client]);

  const save = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      await fetch(`${client.baseUrl}/api/photos/${id}/edit`, {
        method: 'PUT',
        headers: { ...client.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRecipe(adjust)),
      });
      router.back();
    } catch {
      setBusy(false);
    }
  }, [id, adjust, client]);

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
          {(['adjust', 'filters'] as const).map((tb) => (
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing.md }}>
        <Image source={preview ? { uri: preview } : { uri: baseUri, headers: client.authHeaders() }} style={{ flex: 1, width: '100%' }} contentFit="contain" transition={120} />
        {rendering ? (
          <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 6 }}>
            <ActivityIndicator size="small" color={t.colors.primaryContainer} />
          </View>
        ) : null}
      </View>

      {/* Controls */}
      <View style={{ maxHeight: 320, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm }}>
        {tab === 'adjust' ? (
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
              <Pressable onPress={() => setAdjust(NEUTRAL)} disabled={!dirty}>
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
