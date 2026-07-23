/**
 * Immersive photo viewer (Google-Photos style): full-bleed media on black, a
 * top gradient toolbar of icon actions (favorite / download / info / delete /
 * more), a toggleable right info drawer (details, camera, backup, map), an
 * overflow menu (slideshow, add to album, hide…), and keyboard shortcuts
 * (← → navigate, i info, Esc close).
 *
 * Media: range-streamed video with buffering overlay + blob fallback;
 * progressive image — 1024px JPEG instantly, then full-res /view with
 * server-side HEIC decode.
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

const SVG_INFO =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.75" stroke="currentColor" stroke-width="1.8"/><path d="M12 11.2v5.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7.9" r="1.15" fill="currentColor"/></svg>';
const SVG_MORE =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.6" r="1.6"/></svg>';
const SVG_BACK_ARROW =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 12H5m0 0l6.5 6.5M5 12l6.5-6.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_PLAY =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.6" stroke="currentColor" stroke-width="1.8"/><path d="M10 8.8l5 3.2-5 3.2z" fill="currentColor"/></svg>';

export function Lightbox({
  serverName,
  onAddToAlbum,
}: {
  serverName: string;
  onAddToAlbum: (p: PhotoRecord) => void;
}) {
  const { lightboxId, closeLightbox, stepLightbox, stepOffPhoto, currentList } = useView();
  const modals = useModals();
  const actions = useActions();
  const libQ = useLibraryQ();
  const [infoOpen, setInfoOpen] = useState(() => localStorage.getItem('nookLbInfo') === '1');
  const [menuOpen, setMenuOpen] = useState(false);
  const [slideshow, setSlideshow] = useState(false);

  const p = lightboxId
    ? currentList.find((x) => x.id === lightboxId) ||
      (libQ.data || []).find((x) => x.id === lightboxId) ||
      null
    : null;

  const toggleInfo = () => {
    setInfoOpen((v) => {
      localStorage.setItem('nookLbInfo', v ? '0' : '1');
      return !v;
    });
  };

  // Lock page scroll only while a photo is actually displayed.
  useEffect(() => {
    document.body.classList.toggle('no-scroll', !!p);
    return () => document.body.classList.remove('no-scroll');
  }, [p]);

  // Keyboard: arrows navigate, i toggles info, Esc closes (menu first).
  useEffect(() => {
    if (!lightboxId) return;
    const onKey = (e: KeyboardEvent) => {
      if (modals.isOpen) return;
      if (e.key === 'Escape') {
        if (menuOpen) setMenuOpen(false);
        else if (slideshow) setSlideshow(false);
        else closeLightbox();
      } else if (e.key === 'ArrowLeft') stepLightbox(-1);
      else if (e.key === 'ArrowRight') stepLightbox(1);
      else if (e.key === 'i' || e.key === 'I') toggleInfo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxId, modals.isOpen, menuOpen, slideshow, closeLightbox, stepLightbox]);

  // Slideshow: auto-advance; any navigation input stops it.
  useEffect(() => {
    if (!slideshow || !lightboxId) return;
    const t = setInterval(() => stepLightbox(1), 3500);
    const stop = () => setSlideshow(false);
    window.addEventListener('pointerdown', stop);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerdown', stop);
    };
  }, [slideshow, lightboxId, stepLightbox]);

  // Close only once we KNOW the photo is gone.
  useEffect(() => {
    if (lightboxId && !p && libQ.isSuccess && currentList.length > 0) closeLightbox();
  }, [lightboxId, p, libQ.isSuccess, currentList.length, closeLightbox]);

  useEffect(() => {
    setMenuOpen(false);
  }, [lightboxId]);

  if (!p) return null;
  const deleted = p.deletedAt != null;

  const download = async () => {
    if (p.uploadState !== 'complete') return;
    const url = await getBlobUrl('orig:' + p.id, p.originalUrl, { priority: true });
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = p.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const topBtn = (title: string, html: string, onClick: () => void, opts: { active?: boolean; disabled?: boolean } = {}) => (
    <button
      type="button"
      className={'lb-top-btn' + (opts.active ? ' active' : '')}
      title={title}
      aria-label={title}
      disabled={opts.disabled}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );

  const menuItem = (label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      className={'lb-menu-item' + (danger ? ' danger' : '')}
      onClick={() => {
        setMenuOpen(false);
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className={'lightbox' + (infoOpen ? ' info-open' : '')} role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="lb-backdrop" onClick={closeLightbox} />
      <div className="lb-stage-wrap">
        <div className="lb-topbar">
          <button
            type="button"
            className="lb-top-btn"
            title="Close"
            aria-label="Close viewer"
            onClick={closeLightbox}
            dangerouslySetInnerHTML={{ __html: SVG_BACK_ARROW }}
          />
          <div className="lb-top-actions">
            {!deleted &&
              topBtn(
                p.favorite ? 'Remove from favorites' : 'Add to favorites',
                p.favorite ? SVG_HEART_FILL : SVG_HEART_OUTLINE,
                () => actions.toggleFavorite(p),
                { active: !!p.favorite },
              )}
            {topBtn('Download', SVG_DOWNLOAD, download, { disabled: p.uploadState !== 'complete' })}
            {topBtn('Info (i)', SVG_INFO, toggleInfo, { active: infoOpen })}
            {deleted
              ? topBtn('Restore', SVG_RESTORE, async () => {
                  if (await actions.restorePhoto(p)) stepOffPhoto(p.id);
                })
              : topBtn('Delete', ICON.trash, async () => {
                  if (await actions.deletePhoto(p)) stepOffPhoto(p.id);
                })}
            <span className="lb-menu-anchor">
              {topBtn('More options', SVG_MORE, () => setMenuOpen((v) => !v), { active: menuOpen })}
              {menuOpen ? (
                <div className="lb-menu" role="menu">
                  {menuItem('Slideshow', () => setSlideshow(true))}
                  {!deleted && menuItem('Add to album', () => onAddToAlbum(p))}
                  {!deleted &&
                    menuItem(p.hidden ? 'Unhide' : 'Hide', async () => {
                      const updated = await actions.toggleHidden(p);
                      if (updated) stepOffPhoto(p.id);
                    })}
                  {deleted &&
                    menuItem(
                      'Delete permanently',
                      async () => {
                        const ok = await modals.confirm({
                          title: 'Delete permanently?',
                          body: 'This photo will be removed from your server forever. This cannot be undone.',
                          confirm: 'Delete',
                          danger: true,
                        });
                        if (ok && (await actions.permanentDelete(p))) stepOffPhoto(p.id);
                      },
                      true,
                    )}
                </div>
              ) : null}
            </span>
          </div>
        </div>

        <div className="lb-stage" onClick={() => menuOpen && setMenuOpen(false)}>
          <Stage key={p.id + ':' + p.uploadState} photo={p} />
        </div>

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

      {infoOpen ? <InfoDrawer photo={p} serverName={serverName} onClose={toggleInfo} /> : null}
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
        poster={mediaUrl(p.thumbUrl)}
        src={mediaUrl(p.originalUrl)}
        onCanPlay={() => setLoading(false)}
        onPlaying={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onError={async () => {
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
    getBlobUrl('mid:' + p.id, p.thumbUrl + '?w=1024', { priority: true }).then((u) => {
      if (alive && u && !fullShown) setSrc(u);
    });
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

// -------------------------------------------------------------- info drawer

function DetailRow({
  icon,
  title,
  sub,
}: {
  icon: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="lb-detail">
      <Svg className="lb-detail-ico" html={icon} />
      <div className="lb-detail-txt">
        <div className="lb-detail-title">{title}</div>
        {sub ? <div className="lb-detail-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

const SVG_CAL =
  '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M4 10h16M8.5 3.5v3M15.5 3.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const SVG_CAMERA =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.6A1.5 1.5 0 0 1 10 3.7h4a1.5 1.5 0 0 1 1.3.7l1 1.6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12.4" r="3.4" stroke="currentColor" stroke-width="1.7"/></svg>';
const SVG_IMAGE =
  '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M4.5 16.5l4.3-3.8 3 2.6 3.4-3.4 4.3 4.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_CLOUD =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M7 18.5a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17.3 9a4 4 0 0 1-.3 8z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

function InfoDrawer({
  photo: p,
  serverName,
  onClose,
}: {
  photo: PhotoRecord;
  serverName: string;
  onClose: () => void;
}) {
  const deleted = p.deletedAt != null;
  const d = new Date(p.createdAt);
  const dateTitle = d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
  const dateSub =
    d.toLocaleDateString('en-US', { weekday: 'short' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const cam = [p.cameraMake, p.cameraModel].filter(Boolean).join(' ');
  const settings: string[] = [];
  if (p.fNumber) settings.push('ƒ/' + Number(p.fNumber).toFixed(1).replace(/\.0$/, ''));
  const exp = fmtExposure(p.exposureTime);
  if (exp) settings.push(exp);
  if (p.focalLength) settings.push(Math.round(p.focalLength) + ' mm');
  if (p.iso) settings.push('ISO ' + p.iso);

  const mp = p.width && p.height ? (p.width * p.height / 1e6).toFixed(1) + ' MP' : null;
  const fileSub = [mp, p.width && p.height ? p.width + ' × ' + p.height : null]
    .filter(Boolean)
    .join('   ');

  const kinds: string[] = [];
  if (p.mediaType === 'video') kinds.push('Video · ' + fmtDuration(p.duration));
  if (p.live) kinds.push('Live');
  if (p.portrait) kinds.push('Portrait');
  if (p.panorama) kinds.push('Panorama');
  if (p.screenshot) kinds.push('Screenshot');

  const hasLoc = p.latitude != null && p.longitude != null;
  const daysLeft = deleted && p.deletedAt ? deletedDaysLeft(p.deletedAt) : null;
  const lat = p.latitude ?? 0;
  const lon = p.longitude ?? 0;
  const bbox = [lon - 0.02, lat - 0.012, lon + 0.02, lat + 0.012].join('%2C');

  return (
    <aside className="lb-info">
      <div className="lb-info-head">
        <button type="button" className="lb-top-btn dark" aria-label="Close info" onClick={onClose}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          </svg>
        </button>
        <span>Info</span>
      </div>

      <div className="lb-section-title">Details</div>

      <DetailRow icon={SVG_CAL} title={dateTitle} sub={dateSub} />
      {cam || settings.length ? (
        <DetailRow icon={SVG_CAMERA} title={cam || 'Camera'} sub={settings.join('   ') || undefined} />
      ) : null}
      <DetailRow icon={SVG_IMAGE} title={p.filename} sub={[fileSub, kinds.join(' · ')].filter(Boolean).join('\n') || undefined} />
      <DetailRow
        icon={deleted || p.uploadState !== 'complete' ? SVG_CLOCK : SVG_CLOUD}
        title={
          deleted
            ? daysLeft != null
              ? 'In Recently Deleted · ' + daysLeft + (daysLeft === 1 ? ' day left' : ' days left')
              : 'In Recently Deleted'
            : p.uploadState === 'complete'
              ? 'Backed up (' + fmtSizeMB(p.bytes) + ')'
              : 'Upload pending'
        }
        sub={!deleted && p.uploadState === 'complete' ? 'On ' + serverName : undefined}
      />

      {hasLoc ? (
        <>
          <DetailRow icon={ICON.places} title={lat.toFixed(4) + ', ' + lon.toFixed(4)} />
          <a
            className="lb-map-wrap"
            href={'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=15/' + lat + '/' + lon}
            target="_blank"
            rel="noopener"
            title="Open map"
          >
            <iframe
              className="lb-map"
              title="Location map"
              loading="lazy"
              src={'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + lat + '%2C' + lon}
            />
          </a>
        </>
      ) : null}
    </aside>
  );
}
