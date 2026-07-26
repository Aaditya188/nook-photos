/**
 * Pinch-to-zoom photo for the viewer. Pinch or double-tap to zoom (up to the
 * pinch scale / 2x), pan to move while zoomed, double-tap or pinch back to reset.
 * A single tap is forwarded (onTap) so the viewer can still toggle its chrome.
 * While zoomed it reports onZoomChange(true) so the pager can disable horizontal
 * swiping until you zoom back out.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { RemoteOriginal } from './RemoteImage';

const MAX_SCALE = 4;

export function ZoomableImage({
  photoId,
  width,
  height,
  onTap,
  onZoomChange,
}: {
  photoId: string;
  width: number;
  height: number;
  onTap?: () => void;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onZoomRef = useRef(onZoomChange);
  onZoomRef.current = onZoomChange;

  const handleTap = useCallback(() => onTapRef.current?.(), []);
  const applyZoom = useCallback((z: boolean) => {
    setZoomed(z);
    onZoomRef.current?.(z);
  }, []);

  const gesture = useMemo(() => {
    const reset = () => {
      'worklet';
      scale.value = withTiming(1);
      savedScale.value = 1;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
      runOnJS(applyZoom)(false);
    };

    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
      })
      .onEnd(() => {
        savedScale.value = scale.value;
        if (scale.value <= 1.01) reset();
        else runOnJS(applyZoom)(true);
      });

    const pan = Gesture.Pan()
      .enabled(zoomed)
      .minPointers(1)
      .onUpdate((e) => {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      })
      .onEnd(() => {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(260)
      .onEnd(() => {
        if (scale.value > 1.01) reset();
        else {
          scale.value = withTiming(2);
          savedScale.value = 2;
          runOnJS(applyZoom)(true);
        }
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .onEnd(() => runOnJS(handleTap)());

    // double-tap wins over single; pinch + pan + taps all run together.
    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [zoomed, applyZoom, handleTap, scale, savedScale, tx, ty, savedTx, savedTy]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height, alignItems: 'center', justifyContent: 'center' }, style]}>
        <RemoteOriginal photoId={photoId} style={{ width, height }} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}
