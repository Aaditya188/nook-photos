/**
 * Public shared-album page (/s/:sid): no account required. Minimal chrome,
 * the same justified grid, and a lightweight viewer with optional downloads.
 * Password-protected links show an unlock card; the unlock session token
 * rides on media URLs instead of the password.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PhotoRecord } from '@nook/core';
import { PhotoGrid } from '../components/PhotoGrid';
import { useView } from '../state/view';
import { fmtCount, fmtDuration } from '../lib/format';
import { SVG_DOWNLOAD, SVG_LOCK, Svg } from '../lib/icons';

interface SharePayload {
  locked: boolean;
  name: string;
  count?: number;
  allowDownload?: boolean;
  photos?: {
    id: string;
    filename?: string;
    createdAt?: string;
    width?: number;
    height?: number;
    mediaType?: 'photo' | 'video';
    duration?: number | null;
  }[];
}

export function SharedAlbum() {
  const { sid = '' } = useParams();
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<string | null>(() => sessionStorage.getItem('nookShareSt:' + sid));

  const load = (token: string | null) => {
    fetch('/api/share/' + sid + (token ? '?st=' + encodeURIComponent(token) : ''))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || 'This link is invalid or has expired.');
        return r.json();
      })
      .then(setData)
      .catch((e) => setError((e as Error).message));
  };

  useEffect(() => {
    load(st);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  const unlock = async () => {
    if (busy || !password) return;
    setBusy(true);
    try {
      const res = await fetch('/api/share/' + sid + '/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error('Incorrect password');
      const j = await res.json();
      sessionStorage.setItem('nookShareSt:' + sid, j.st);
      setSt(j.st);
      load(j.st);
    } catch (e) {
      setError('');
      setBusy(false);
      setPassword('');
      setData((d) => d); // keep locked card
      setTimeout(() => setError((e as Error).message), 0);
      return;
    }
    setBusy(false);
  };

  // Map share photos onto PhotoRecord-shaped objects whose URLs hit the
  // public share endpoints (the blob cache works unauthenticated here).
  const list = useMemo<PhotoRecord[]>(() => {
    if (!data?.photos) return [];
    const q = st ? '?st=' + encodeURIComponent(st) : '';
    return data.photos.map(
      (p) =>
        ({
          id: p.id,
          filename: p.filename ?? p.id,
          createdAt: p.createdAt ?? new Date(0).toISOString(),
          width: p.width ?? 0,
          height: p.height ?? 0,
          mediaType: p.mediaType ?? 'photo',
          duration: p.duration ?? null,
          favorite: false,
          hidden: false,
          uploadState: 'complete',
          deletedAt: null,
          thumbUrl: '/api/share/' + sid + '/thumb/' + p.id + q,
          originalUrl: '/api/share/' + sid + '/original/' + p.id + q,
        }) as unknown as PhotoRecord,
    );
  }, [data, sid, st]);

  const { setCurrentList } = useView();
  useEffect(() => {
    setCurrentList(list);
  }, [list, setCurrentList]);

  if (error) {
    return (
      <div className="share-page">
        <ShareTopbar name="" />
        <div className="lock-wall">
          <div className="lock-wall-icon">
            <Svg html={SVG_LOCK} />
          </div>
          <h2 className="lock-wall-title">Nothing to see here</h2>
          <p className="lock-wall-sub">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="share-page">
        <ShareTopbar name="" />
      </div>
    );
  }

  if (data.locked) {
    return (
      <div className="share-page">
        <ShareTopbar name={data.name} />
        <div className="lock-wall">
          <div className="lock-wall-icon">
            <Svg html={SVG_LOCK} />
          </div>
          <h2 className="lock-wall-title">{data.name}</h2>
          <p className="lock-wall-sub">This shared album is password protected.</p>
          <div className="share-unlock-row">
            <input
              className="m-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
            />
            <button type="button" className="lock-wall-btn" disabled={busy} onClick={unlock}>
              <span>{busy ? 'Checking…' : 'View album'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="share-page">
      <ShareTopbar name={data.name} sub={fmtCount(data.count ?? list.length)} />
      <main className="share-content">
        <PhotoGrid list={list} grouped={false} />
      </main>
      <SharedViewer list={list} allowDownload={!!data.allowDownload} />
    </div>
  );
}

function ShareTopbar({ name, sub }: { name: string; sub?: string }) {
  return (
    <header className="share-topbar">
      <div className="brand">
        <div className="mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="5" stroke="#06140c" strokeWidth="2" />
            <circle cx="9" cy="9" r="1.7" fill="#06140c" />
            <path d="M5 16.5l4-4 3 3 3.5-3.5 3.5 3.5" stroke="#06140c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="wordmark">nook</div>
      </div>
      <div className="share-title-wrap">
        <div className="share-title">{name}</div>
        {sub ? <div className="share-sub">{sub}</div> : null}
      </div>
    </header>
  );
}

/** Minimal viewer for shared albums: media, arrows, optional download. */
function SharedViewer({ list, allowDownload }: { list: PhotoRecord[]; allowDownload: boolean }) {
  const { lightboxId, closeLightbox, stepLightbox } = useView();
  const p = lightboxId ? list.find((x) => x.id === lightboxId) || null : null;

  useEffect(() => {
    document.body.classList.toggle('no-scroll', !!p);
    return () => document.body.classList.remove('no-scroll');
  }, [p]);

  useEffect(() => {
    if (!lightboxId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') stepLightbox(-1);
      else if (e.key === 'ArrowRight') stepLightbox(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxId, closeLightbox, stepLightbox]);

  if (!p) return null;
  const viewUrl = p.thumbUrl.replace('/thumb/', '/view/') + (p.thumbUrl.includes('?') ? '&' : '?') + 'w=2560';

  return (
    <div className="lightbox" role="dialog" aria-modal="true">
      <div className="lb-backdrop" onClick={closeLightbox} />
      <div className="lb-stage-wrap">
        <div className="lb-topbar">
          <button
            type="button"
            className="lb-top-btn"
            aria-label="Close"
            onClick={closeLightbox}
            dangerouslySetInnerHTML={{
              __html:
                '<svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5m0 0l6.5 6.5M5 12l6.5-6.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            }}
          />
          <div className="lb-top-actions">
            {allowDownload || p.mediaType === 'video' ? (
              <a
                className="lb-top-btn"
                title="Download"
                href={p.originalUrl}
                download={p.filename}
                dangerouslySetInnerHTML={{ __html: SVG_DOWNLOAD }}
              />
            ) : null}
          </div>
        </div>
        <div className="lb-stage">
          {p.mediaType === 'video' ? (
            <video className="lb-media" controls playsInline autoPlay src={p.originalUrl} />
          ) : (
            <img className="lb-media loaded" alt="" src={viewUrl} />
          )}
          {p.mediaType === 'video' && p.duration ? (
            <span className="hidden">{fmtDuration(p.duration)}</span>
          ) : null}
        </div>
        <button type="button" className="lb-btn lb-prev" aria-label="Previous" onClick={() => stepLightbox(-1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="lb-btn lb-next" aria-label="Next" onClick={() => stepLightbox(1)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
