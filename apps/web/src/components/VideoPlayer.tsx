/**
 * Custom video player — replaces the browser's default controls with a
 * polished overlay: center play button, bottom gradient bar with seek
 * (buffered ranges shown), time, volume, and fullscreen. Controls auto-hide
 * while playing; click toggles play; Space works too. Range streaming and the
 * authed-blob fallback are preserved by the caller wiring src/onError.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const SVG_PLAY_BIG =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 5.8v12.4c0 .8.9 1.3 1.6.9l9.6-6.2c.6-.4.6-1.4 0-1.8L10.1 4.9c-.7-.4-1.6.1-1.6.9z"/></svg>';
const SVG_PAUSE =
  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/></svg>';
const SVG_VOL =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 9.5v5h3.2l4.3 3.6V5.9L7.7 9.5z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M17.8 6.8a7.4 7.4 0 0 1 0 10.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SVG_MUTED =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 9.5v5h3.2l4.3 3.6V5.9L7.7 9.5z" fill="currentColor"/><path d="M15.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SVG_FULL =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 9V6.5a2 2 0 0 1 2-2H9M15 4.5h2.5a2 2 0 0 1 2 2V9M19.5 15v2.5a2 2 0 0 1-2 2H15M9 19.5H6.5a2 2 0 0 1-2-2V15" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  return h > 0
    ? h + ':' + String(m % 60).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
    : m + ':' + String(sec).padStart(2, '0');
}

export function VideoPlayer({
  src,
  poster,
  videoRef: externalRef,
  onError,
  onWaiting,
  onCanPlay,
}: {
  src: string;
  poster?: string;
  videoRef?: React.MutableRefObject<HTMLVideoElement | null>;
  onError?: () => void;
  onWaiting?: () => void;
  onCanPlay?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLVideoElement | null>(null);
  const setVideoRef = (n: HTMLVideoElement | null) => {
    innerRef.current = n;
    if (externalRef) externalRef.current = n;
  };

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [controlsShown, setControlsShown] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poke = useCallback(() => {
    setControlsShown(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = innerRef.current;
      if (v && !v.paused) setControlsShown(false);
    }, 2600);
  }, []);

  useEffect(() => {
    poke();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [poke]);

  const toggle = useCallback(() => {
    const v = innerRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
    poke();
  }, [poke]);

  // Space toggles play (arrows stay with the photo navigation).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  const onTimeUpdate = () => {
    const v = innerRef.current;
    if (!v) return;
    setTime(v.currentTime);
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
  };

  const seekTo = (clientX: number) => {
    const v = innerRef.current;
    const bar = wrapRef.current?.querySelector('.vp-seek') as HTMLElement | null;
    if (!v || !bar || !duration) return;
    const r = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    v.currentTime = frac * duration;
    setTime(v.currentTime);
    poke();
  };

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
    poke();
  };

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <div
      ref={wrapRef}
      className={'vp' + (controlsShown ? ' show' : '')}
      onPointerMove={poke}
      onPointerDown={poke}
    >
      <video
        ref={setVideoRef}
        className="lb-media vp-video"
        playsInline
        preload="metadata"
        autoPlay
        poster={poster}
        src={src}
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          poke();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsShown(true);
        }}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={() => setDuration(innerRef.current?.duration ?? 0)}
        onProgress={onTimeUpdate}
        onWaiting={onWaiting}
        onCanPlay={onCanPlay}
        onPlaying={onCanPlay}
        onError={onError}
        onEnded={() => setControlsShown(true)}
      />

      {!playing ? (
        <button
          type="button"
          className="vp-center"
          aria-label="Play"
          onClick={toggle}
          dangerouslySetInnerHTML={{ __html: SVG_PLAY_BIG }}
        />
      ) : null}

      <div className="vp-bar">
        <div
          className="vp-seek"
          onPointerDown={(e) => {
            e.preventDefault();
            seekTo(e.clientX);
            const onMove = (ev: PointerEvent) => seekTo(ev.clientX);
            const onUp = () => window.removeEventListener('pointermove', onMove);
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp, { once: true });
          }}
        >
          <div className="vp-seek-buf" style={{ width: bufPct + '%' }} />
          <div className="vp-seek-fill" style={{ width: pct + '%' }} />
          <div className="vp-seek-dot" style={{ left: pct + '%' }} />
        </div>
        <div className="vp-controls">
          <button
            type="button"
            className="vp-btn"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={toggle}
            dangerouslySetInnerHTML={{ __html: playing ? SVG_PAUSE : SVG_PLAY_BIG }}
          />
          <span className="vp-time">
            {fmtTime(time)} <em>/ {fmtTime(duration)}</em>
          </span>
          <span className="vp-spacer" />
          <button
            type="button"
            className="vp-btn"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => {
              const v = innerRef.current;
              if (!v) return;
              v.muted = !v.muted;
              setMuted(v.muted);
              poke();
            }}
            dangerouslySetInnerHTML={{ __html: muted || volume === 0 ? SVG_MUTED : SVG_VOL }}
          />
          <input
            className="vp-vol"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => {
              const v = innerRef.current;
              const val = Number(e.target.value);
              setVolume(val);
              if (v) {
                v.volume = val;
                v.muted = val === 0;
                setMuted(v.muted);
              }
              poke();
            }}
          />
          <button
            type="button"
            className="vp-btn"
            aria-label="Fullscreen"
            onClick={fullscreen}
            dangerouslySetInnerHTML={{ __html: SVG_FULL }}
          />
        </div>
      </div>
    </div>
  );
}
