/**
 * App chrome: TopBar (status pill, theme toggle, user chip), Sidebar (nav +
 * mini server card), ViewHead, EmptyState, cover/person tiles — same markup
 * and classnames as the vanilla dashboard.
 */
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { Person, StatusRecord } from '@nook/core';
import { fmtBytes, fmtCount } from '../lib/format';
import { ICON, SVG_BACK, Svg } from '../lib/icons';
import { useLazyBlob } from './Tile';
import { ProfileMenu } from './ProfileMenu';
import { useUpload } from './Upload';

// ------------------------------------------------------------------- top bar

export function TopBar({
  status,
  online,
  pending,
  items,
  fetching,
  onToggleNav,
}: {
  status: StatusRecord | undefined;
  online: boolean;
  pending: number;
  items: number;
  fetching: boolean;
  onToggleNav: () => void;
}) {
  let statusText: string;
  let pillCls = 'status-pill';
  if (!online) {
    pillCls += ' offline';
    statusText = 'Server unreachable';
  } else if (pending > 0) {
    pillCls += ' pending';
    statusText = 'Backing up · ' + pending + ' remaining';
  } else {
    statusText =
      items === 0
        ? 'Connected to your server'
        : 'All backed up · ' + items.toLocaleString('en-US') + (items === 1 ? ' item' : ' items');
  }

  const st = status?.storage;

  return (
    <header className="topbar">
      <button type="button" className="nav-toggle" aria-label="Menu" onClick={onToggleNav}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="brand">
        <div className="mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="5" stroke="#06140c" strokeWidth="2" />
            <circle cx="9" cy="9" r="1.7" fill="#06140c" />
            <path
              d="M5 16.5l4-4 3 3 3.5-3.5 3.5 3.5"
              stroke="#06140c"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="wordmark">nook</div>
      </div>

      <div className={pillCls} title={statusText}>
        <span className="dot" />
        {fetching ? <PillLoader /> : null}
        <span className="status-text">{statusText}</span>
      </div>

      <div className="topbar-right">
        <UploadButton />
        <div className="storage-summary">
          {st ? fmtBytes(st.usedBytes) + ' of ' + fmtBytes(st.totalBytes) : ''}
        </div>
      </div>
    </header>
  );
}

function UploadButton() {
  const { pickFiles, pickFolder } = useUpload();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="up-btn-wrap" ref={ref}>
      <button type="button" className="up-btn" onClick={() => setOpen((v) => !v)} title="Upload">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4.5 15v3A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
        <span>Upload</span>
      </button>
      {open ? (
        <div className="up-menu" role="menu">
          <button type="button" className="up-menu-item" onClick={() => { setOpen(false); pickFiles(); }}>
            Photos or videos…
          </button>
          <button type="button" className="up-menu-item" onClick={() => { setOpen(false); pickFolder(); }}>
            A folder…
          </button>
          <div className="up-menu-hint">Or drag files anywhere · Takeout .zip supported</div>
        </div>
      ) : null}
    </div>
  );
}

function PillLoader() {
  // Only show after 300ms so quick polls don't flicker.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <span className="nook-loader nook-loader-sm" aria-hidden="true">
      <span className="nook-arc nook-arc-1" />
      <span className="nook-arc nook-arc-2" />
      <span className="nook-arc nook-arc-3" />
      <span className="nook-glyph">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3.1c.26 0 .52.09.73.27l7.5 6.43c.49.42.19 1.22-.45 1.22h-1.28v7.73c0 .69-.56 1.25-1.25 1.25h-3.5v-5.5c0-.97-.78-1.75-1.75-1.75s-1.75.78-1.75 1.75V20h-3.5c-.69 0-1.25-.56-1.25-1.25v-7.73H4.22c-.64 0-.94-.8-.45-1.22l7.5-6.43c.21-.18.47-.27.73-.27z" />
        </svg>
      </span>
    </span>
  );
}

// ------------------------------------------------------------------- sidebar

export interface NavEntry {
  to: string;
  title: string;
  icon: string;
  count?: number | null;
}
export interface NavGroup {
  label?: string;
  items: NavEntry[];
}

export function Sidebar({
  groups,
  open,
  onClose,
}: {
  groups: NavGroup[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div className={'sidebar-scrim' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'sidebar' + (open ? ' open' : '')} aria-label="Sections">
        <nav className="nav">
          {groups.map((g, gi) => (
            <div key={gi} style={{ display: 'contents' }}>
              {g.label ? <div className="nav-label">{g.label}</div> : null}
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.to === '/'}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                  onClick={onClose}
                >
                  <Svg className="nav-ico" html={ICON[it.icon] || ''} />
                  <span className="nav-txt">{it.title}</span>
                  {it.count != null && it.count > 0 ? (
                    <span className="nav-count">{it.count > 999 ? '999+' : String(it.count)}</span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ProfileMenu onNavigate={onClose} />
        </div>
      </aside>
    </>
  );
}

// ----------------------------------------------------------------- view head

export interface HeadAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  icon?: string;
}

export function ViewHead({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: string;
  back?: { label: string; to: string };
  actions?: HeadAction[];
}) {
  const nav = useNavigate();
  return (
    <div className="view-head">
      {back ? (
        <button type="button" className="vh-back" onClick={() => nav(back.to)}>
          <Svg html={SVG_BACK} />
          <span>{back.label}</span>
        </button>
      ) : null}
      <div className="vh-row">
        <div className="vh-title-wrap">
          <h1 className="vh-title">{title}</h1>
          {subtitle ? <div className="vh-sub">{subtitle}</div> : null}
        </div>
        {actions && actions.length ? (
          <div className="vh-actions">
            {actions.map((a, i) => (
              <button
                key={i}
                type="button"
                className={'vh-btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '')}
                onClick={a.onClick}
              >
                {a.icon ? <Svg className="vh-btn-ico" html={a.icon} /> : null}
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- empty state

const EMPTY: Record<string, { icon: string; title: string; text: string }> = {
  library: { icon: 'library', title: 'No photos yet', text: 'Open Nook on your iPhone to back up your library.' },
  favorites: { icon: 'heart', title: 'No favorites', text: 'Tap the heart on a photo to keep it here.' },
  videos: { icon: 'video', title: 'No videos', text: 'Videos you back up will appear here.' },
  screenshots: { icon: 'screenshot', title: 'No screenshots', text: 'Screenshots you back up will appear here.' },
  live: { icon: 'live', title: 'No Live Photos', text: 'Live Photos you back up will appear here.' },
  panoramas: { icon: 'pano', title: 'No panoramas', text: 'Panoramas you back up will appear here.' },
  portrait: { icon: 'portrait', title: 'No portraits', text: 'Portrait photos you back up will appear here.' },
  people: { icon: 'people', title: 'No people yet', text: 'As your photos are indexed, faces are grouped into people here.' },
  places: { icon: 'places', title: 'No places yet', text: 'Photos with location data are grouped by place here.' },
  albums: { icon: 'albums', title: 'No albums yet', text: 'Create an album to organize your photos.' },
  album: { icon: 'albums', title: 'Empty album', text: 'Open a photo and use “Add to Album” to fill this album.' },
  hidden: { icon: 'hidden', title: 'Nothing hidden', text: 'Hidden photos are kept out of your library and shown only here.' },
  deleted: { icon: 'trash', title: 'Nothing deleted', text: 'Deleted photos wait here for 30 days before they’re removed forever.' },
  generic: { icon: 'library', title: 'Nothing here', text: '' },
};

export function EmptyState({ kind }: { kind: string }) {
  const e = EMPTY[kind] || EMPTY.generic;
  return (
    <div className="empty">
      <Svg className="empty-glyph" html={ICON[e.icon] || ICON.library} />
      <h2>{e.title}</h2>
      <p>{e.text}</p>
    </div>
  );
}

// -------------------------------------------------------------- cover tiles

export const CoverTile = memo(function CoverTile({
  title,
  subtitle,
  coverPhotoId,
  icon,
  onClick,
}: {
  title: string;
  subtitle?: string;
  coverPhotoId?: string | null;
  icon: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  // Lazy-load like grid tiles: only fetch covers near the viewport.
  const { src } = useLazyBlob(
    ref,
    'thumb:' + (coverPhotoId || 'none') + ':256',
    coverPhotoId ? '/api/photos/' + coverPhotoId + '/thumb?w=256' : '',
  );
  return (
    <button ref={ref} type="button" className="cover-tile" aria-label={title} onClick={onClick}>
      <div className={'cover-media' + (coverPhotoId ? '' : ' cover-empty')}>
        {coverPhotoId ? (
          src ? (
            <img alt="" draggable={false} src={src} className="loaded" />
          ) : (
            <img alt="" draggable={false} />
          )
        ) : (
          <Svg className="cover-ph" html={ICON[icon] || ICON.albums} />
        )}
        <div className="cover-grad" />
        <div className="cover-cap">
          <div className="cover-title">{title}</div>
          <div className="cover-sub">{subtitle || ''}</div>
        </div>
      </div>
    </button>
  );
});

export const PersonTile = memo(function PersonTile({
  person,
  onClick,
}: {
  person: Person;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const { src } = useLazyBlob(
    ref,
    'thumb:' + person.coverPhotoId + ':256',
    '/api/photos/' + person.coverPhotoId + '/thumb?w=256',
  );
  return (
    <button ref={ref} type="button" className="person-tile" onClick={onClick}>
      <div className="person-av">{src ? <img alt="" draggable={false} src={src} className="loaded" /> : null}</div>
      <div className={'person-name' + (person.name ? '' : ' unnamed')}>
        {person.name || 'Add Name'}
      </div>
      <div className="person-count">{fmtCount(person.count)}</div>
    </button>
  );
});

export function DeletedNote() {
  return (
    <div className="deleted-note">
      Photos are removed forever after 30 days. Open one to restore or delete it now.
    </div>
  );
}

export function BootLoader({ fading }: { fading: boolean }) {
  return (
    <div className={'boot-loader' + (fading ? ' fade-out' : '')} role="status" aria-label="Loading your library">
      <div className="nook-loader nook-loader-lg" aria-hidden="true">
        <span className="nook-arc nook-arc-1" />
        <span className="nook-arc nook-arc-2" />
        <span className="nook-arc nook-arc-3" />
        <span className="nook-glyph">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3.1c.26 0 .52.09.73.27l7.5 6.43c.49.42.19 1.22-.45 1.22h-1.28v7.73c0 .69-.56 1.25-1.25 1.25h-3.5v-5.5c0-.97-.78-1.75-1.75-1.75s-1.75.78-1.75 1.75V20h-3.5c-.69 0-1.25-.56-1.25-1.25v-7.73H4.22c-.64 0-.94-.8-.45-1.22l7.5-6.43c.21-.18.47-.27.73-.27z" />
          </svg>
        </span>
      </div>
      <div className="boot-wordmark">nook</div>
    </div>
  );
}

export type { ReactNode };
