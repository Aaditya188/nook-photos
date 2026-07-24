/**
 * Sidebar-foot profile control: avatar + name, opening a popover with theme
 * selection (custom radios), a Settings link, and Sign out.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { useTheme, type ThemePref } from '../hooks/useTheme';
import { Svg } from '../lib/icons';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SVG_SETTINGS =
  '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SVG_ACCOUNT =
  '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SVG_LOGOUT =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 12h8m0 0l-3-3m3 3l-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const THEME_GLYPH: Record<ThemePref, string> = {
  dark: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.2M12 18.8V21M4.5 4.5l1.6 1.6M17.9 17.9l1.6 1.6M3 12h2.2M18.8 12H21M4.5 19.5l1.6-1.6M17.9 6.1l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  system:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9 20h6M12 16.5V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
const THEMES: { key: ThemePref; label: string }[] = [
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
  { key: 'system', label: 'System' },
];

export function ProfileMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const { pref, set } = useTheme();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = user?.displayName || user?.username || 'Account';

  const go = (to: string) => {
    setOpen(false);
    onNavigate?.();
    nav(to);
  };

  return (
    <div className="profile-menu" ref={rootRef}>
      {open ? (
        <div className="pm-popover" role="menu">
          <button type="button" className="pm-item" onClick={() => go('/profile')}>
            <Svg className="pm-item-ico" html={SVG_ACCOUNT} />
            <span>Profile</span>
          </button>
          <button type="button" className="pm-item" onClick={() => go('/settings')}>
            <Svg className="pm-item-ico" html={SVG_SETTINGS} />
            <span>Settings</span>
          </button>

          <div className="pm-theme">
            <div className="pm-theme-label">Theme</div>
            {THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={'pm-radio-row' + (pref === t.key ? ' active' : '')}
                onClick={() => set(t.key)}
              >
                <Svg className="pm-radio-ico" html={THEME_GLYPH[t.key]} />
                <span>{t.label}</span>
                <span className={'pm-radio' + (pref === t.key ? ' on' : '')} aria-hidden="true" />
              </button>
            ))}
          </div>

          <button type="button" className="pm-item danger" onClick={() => { setOpen(false); signOut(); }}>
            <Svg className="pm-item-ico" html={SVG_LOGOUT} />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={'pm-trigger' + (open ? ' open' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="pm-avatar">{initials(name)}</span>
        <span className="pm-name">{name}</span>
        <svg className="pm-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M7 14l5-5 5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
