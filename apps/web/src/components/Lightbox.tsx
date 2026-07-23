/**
 * Photo viewer: media stage (range-streamed video with buffering overlay +
 * blob fallback; progressive image — 1024px JPEG instantly, then full-res
 * /view with server-side HEIC decode), info panel, and context actions.
 */
import { useEffect, useRef, useState } from 'react';
import type { PhotoRecord } from '@nook/core';
import { useAuth } from '../state/auth';
import { useActions, useLibraryQ } from '../state/data';
import { useModals } from '../state/ui';
import { useView } from '../state/view';
import { getBlobUrl } from '../lib/blobCache';
import { deletedDaysLeft, fmtDuration, fmtExposure, fmtSizeMB } from '../lib/format';
import {
  ICON,
  SVG_ADD_TO_ALBUM_PLUS,
  SVG_CHECK,
  SVG_CLOCK,
  SVG_DOWNLOAD,
  SVG_EYE,
  SVG_HEART_FILL,
  SVG_HEART_OUTLINE,
  SVG_RESTORE,
  Svg,
} from '../lib/icons';

export function Lightbox({
  serverName,
  onAddToAlbum,
}: {
  serverName: string;
  onAddToAlbum: (p: PhotoRecord) => void;
}) {
  const { lightboxId, closeLightbox, stepLightbox, stepOffPhoto, currentList } = useView();
  const modals = useModals();
  const libQ = useLibraryQ();

  // Resolve from the on-screen list first, falling back to the full library —
  // a reload restores ?photo= before the view's own list has finished loading.
  const p = lightboxId
    ? currentList.find((x) => x.id === lightboxId) ||
      (libQ.data || []).find((x) => x.id === lightboxId) ||
      null
    : null;

  // Lock page scroll only while a photo is actually displayed.
  useEffect(() => {
    document.body.classList.toggle('no-scroll', !!p);
    return () => document.body.classList.remove('no-scroll');
  }, [p]);

  // Keyboard nav (modal-open state swallows keys via the modal's own handler).
  useEffect(() => {
    if (!lightboxId) return;
    const onKey = (e: KeyboardEvent) => {
      if (modals.isOpen) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') stepLightbox(-1);
      else if (e.key === 'ArrowRight') stepLightbox(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxId, modals.isOpen, closeLightbox, stepLightbox]);

  // Close only once we KNOW the photo is gone: the library has loaded, the
  // view's list has content, and neither contains it. (On reload the queries
  // are still in flight — don't slam the viewer shut before data arrives.)
  useEffect(() => {
    if (lightboxId && !p && libQ.isSuccess && currentList.length > 0) closeLightbox();
  }, [lightboxId, p, libQ.isSuccess, currentList.length, closeLightbox]);

  if (!p) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="lb-backdrop" onClick={closeLightbox} />
      <div className="lb-stage-wrap">
        <div className="lb-stage">
          <Stage key={p.id + ':' + p.uploadState} photo={p} />
        </div>
        <button type="button" className="lb-btn lb-close" aria-label="Close viewer" onClick={closeLightbox}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="lb-btn lb-prev" aria-label="Previous photo" onClick={() => stepLightbox(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="lb-btn lb-next" aria-label="Next photo" onClick={() => stepLightbox(1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <InfoPanel photo={p} serverName={serverName} onAddToAlbum={onAddToAlbum} onStepOff={stepOffPhoto} />
    </div>
  );
}

// -------------------------------------------------------------------- stage

function Stage({ photo: p }: { photo: PhotoRecord }) {
  const { mediaUrl } = useAuth();

  if (p.mediaType === 'video' && p.uploadState === 'complete') {
    return <VideoStage photo={p} mediaUrl={mediaUrl} />;
  }
  return <ImageStage photo={p} />;
}

function VideoStage({
  photo: p,
  mediaUrl,
}: {
  photo: PhotoRecord;
  mediaUrl: (path: string) => string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const fellBack = useRef(false);

  return (
    <div className="lb-video-wrap">
      <video
        ref={videoRef}
        className="lb-media"
        controls
        playsInline
        preload="metadata"
        autoPlay
        // Native HTTP Range streaming (chunked) — never downloads the whole
        // file. Token rides in the query since <video> can't set a header.
        poster={mediaUrl(p.thumbUrl)}
        src={mediaUrl(p.originalUrl)}
        onCanPlay={() => setLoading(false)}
        onPlaying={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onError={async () => {
          // Fall back once to an authed blob download (e.g. plain origin).
          if (fellBack.current) {
            setFailed(true);
            setLoading(true);
            return;
          }
          fellBack.current = true;
          setLoading(true);
          const u = await getBlobUrl('orig:' + p.id, p.originalUrl, { priority: true });
          const v = videoRef.current;
          if (u && v) {
            v.src = u;
            v.load();
          } else {
            setFailed(true);
          }
        }}
      />
      <div className={'lb-video-loading' + (loading ? '' : ' hidden')}>
        {failed ? (
          <span>Could not load video</span>
        ) : (
          <>
            <span className="spinner" />
            <span>Loading video…</span>
          </>
        )}
      </div>
    </div>
  );
}

function ImageStage({ photo: p }: { photo: PhotoRecord }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    let fullShown = false;
    // 1) Medium JPEG first (fast — resized from the stored thumbnail), so
    //    something appears almost instantly, including for HEIC.
    getBlobUrl('mid:' + p.id, p.thumbUrl + '?w=1024', { priority: true }).then((u) => {
      if (alive && u && !fullShown) setSrc(u);
    });
    // 2) Full-resolution JPEG via /view (HEIC decoded server-side).
    if (p.uploadState === 'complete') {
      getBlobUrl('full:' + p.id, '/api/photos/' + p.id + '/view?w=3000', { priority: true }).then((u) => {
        if (alive && u) {
          fullShown = true;
          setSrc(u);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [p.id, p.thumbUrl, p.uploadState]);

  return (
    <div className="lb-img-wrap">
      {src ? (
        <img
          className={'lb-media' + (loaded ? ' loaded' : '')}
          alt=""
          decoding="async"
          src={src}
          onLoad={() => setLoaded(true)}
        />
      ) : null}
      <div className={'lb-video-loading' + (loaded ? ' hidden' : '')}>
        <span className="spinner" />
      </div>
    </div>
  );
}

// --------------------------------------------------------------- info panel

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="lb-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function InfoPanel({
  photo: p,
  serverName,
  onAddToAlbum,
  onStepOff,
}: {
  photo: PhotoRecord;
  serverName: string;
  onAddToAlbum: (p: PhotoRecord) => void;
  onStepOff: (id: string) => void;
}) {
  const { client } = useAuth();
  const actions = useActions();
  const modals = useModals();
  const deleted = p.deletedAt != null;

  const d = new Date(p.createdAt);
  const datetime =
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const kinds: string[] = [];
  if (p.favorite) kinds.push('Favorite');
  if (p.live) kinds.push('Live');
  if (p.portrait) kinds.push('Portrait');
  if (p.panorama) kinds.push('Panorama');
  if (p.screenshot) kinds.push('Screenshot');

  const cam = [p.cameraMake, p.cameraModel].filter(Boolean).join(' ');
  const settings: string[] = [];
  if (p.fNumber) settings.push('ƒ/' + Number(p.fNumber).toFixed(1).replace(/\.0$/, ''));
  const exp = fmtExposure(p.exposureTime);
  if (exp) settings.push(exp);
  if (p.iso) settings.push('ISO ' + p.iso);
  if (p.focalLength) settings.push(Math.round(p.focalLength) + 'mm');

  const hasExif = !!cam || !!p.lensModel || settings.length > 0;
  const hasLoc = p.latitude != null && p.longitude != null;
  const daysLeft = deleted && p.deletedAt ? deletedDaysLeft(p.deletedAt) : null;

  const download = async () => {
    if (p.uploadState !== 'complete') return;
    const url = await getBlobUrl('orig:' + p.id, p.originalUrl);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = p.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const act = (
    cls: string,
    title: string,
    html: string,
    onClick: () => void,
    opts: { active?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      key={title}
      type="button"
      className={'lb-act ' + cls + (opts.active ? ' active' : '')}
      title={title}
      aria-label={title}
      disabled={opts.disabled}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );

  return (
    <aside className="lb-info">
      <div className="lb-filename">{p.filename}</div>
      <div className="lb-datetime">{datetime}</div>
      <div className="lb-rows">
        <MetaRow label="Type" value={p.mediaType === 'video' ? 'Video · ' + fmtDuration(p.duration) : 'Photo'} />
        <MetaRow label="Resolution" value={p.width + ' × ' + p.height} />
        <MetaRow label="Size" value={fmtSizeMB(p.bytes)} />
        {kinds.length ? <MetaRow label="Kind" value={kinds.join(', ')} /> : null}
      </div>
      <div className={'lb-section' + (hasExif ? '' : ' hidden')}>
        <div className="lb-section-title">Camera</div>
        <div className="lb-rows">
          {cam ? <MetaRow label="Camera" value={cam} /> : null}
          {p.lensModel ? <MetaRow label="Lens" value={p.lensModel} /> : null}
          {settings.length ? <MetaRow label="Settings" value={settings.join(' · ')} /> : null}
        </div>
      </div>
      <div className={'lb-section' + (hasLoc ? '' : ' hidden')}>
        <div className="lb-section-title">Location</div>
        <div className="lb-rows">
          {hasLoc ? (
            <MetaRow label="Coordinates" value={p.latitude!.toFixed(4) + ', ' + p.longitude!.toFixed(4)} />
          ) : null}
        </div>
        {hasLoc ? (
          <a
            className="lb-map-link"
            target="_blank"
            rel="noopener"
            href={
              'https://www.openstreetmap.org/?mlat=' +
              p.latitude +
              '&mlon=' +
              p.longitude +
              '#map=15/' +
              p.latitude +
              '/' +
              p.longitude
            }
          >
            View on map
          </a>
        ) : null}
      </div>
      <div className={'lb-backup' + (deleted || p.uploadState !== 'complete' ? ' pending' : '')}>
        {deleted ? (
          <>
            <Svg html={SVG_CLOCK} />
            <span>
              {daysLeft != null
                ? daysLeft + (daysLeft === 1 ? ' day left' : ' days left')
                : 'In Recently Deleted'}
            </span>
          </>
        ) : p.uploadState === 'complete' ? (
          <>
            <Svg html={SVG_CHECK} />
            <span>Backed up to {serverName}</span>
          </>
        ) : (
          <>
            <Svg html={SVG_CLOCK} />
            <span>Upload pending</span>
          </>
        )}
      </div>
      <div className="lb-actions">
        {deleted ? (
          <>
            <button
              type="button"
              className="lb-act wide"
              title="Restore"
              onClick={async () => {
                if (await actions.restorePhoto(p)) onStepOff(p.id);
              }}
            >
              <Svg html={SVG_RESTORE} />
              <span>Restore</span>
            </button>
            {act('danger', 'Delete permanently', ICON.trash, async () => {
              const ok = await modals.confirm({
                title: 'Delete permanently?',
                body: 'This photo will be removed from your server forever. This cannot be undone.',
                confirm: 'Delete',
                danger: true,
              });
              if (ok && (await actions.permanentDelete(p))) onStepOff(p.id);
            })}
          </>
        ) : (
          <>
            {act(
              'fav',
              p.favorite ? 'Remove from favorites' : 'Add to favorites',
              p.favorite ? SVG_HEART_FILL : SVG_HEART_OUTLINE,
              () => actions.toggleFavorite(p),
              { active: !!p.favorite },
            )}
            {act('plain', 'Add to album', SVG_ADD_TO_ALBUM_PLUS, () => onAddToAlbum(p))}
            {act('plain', p.hidden ? 'Unhide' : 'Hide', p.hidden ? SVG_EYE : ICON.hidden, async () => {
              const updated = await actions.toggleHidden(p);
              if (updated) onStepOff(p.id);
            })}
            {act('plain', 'Download', SVG_DOWNLOAD, download, {
              disabled: p.uploadState !== 'complete',
            })}
            {act('danger', 'Delete', ICON.trash, async () => {
              if (await actions.deletePhoto(p)) onStepOff(p.id);
            })}
          </>
        )}
      </div>
    </aside>
  );
}
