/**
 * Share-an-album modal. Two ways to share:
 *  - People: grant named accounts on this server View or Edit access (with an
 *    optional expiry); Edit lets them add/remove photos.
 *  - Guest link: a public URL (optional password, expiry, downloads) for anyone
 *    without an account.
 */
import { useEffect, useState } from 'react';
import type { AlbumGrant } from '@nook/core';
import { useAuth } from '../state/auth';
import { useServerInfoQ } from '../state/data';
import { useToast } from '../state/ui';
import { Svg, ICON } from '../lib/icons';

interface ShareState {
  shared: boolean;
  id?: string;
  url?: string;
  expiresAt?: number | null;
  hasPassword?: boolean;
  allowDownload?: boolean;
}

export function ShareCard({ albumId, close }: { albumId: string; close: () => void }) {
  const { client } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<ShareState | null>(null);
  const [expiry, setExpiry] = useState<'7' | '30' | 'never'>('30');
  const [password, setPassword] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/albums/' + albumId + '/share', { headers: client.authHeaders() })
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState({ shared: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  // Prefer the admin-configured public URL so links work off the local network.
  const serverQ = useServerInfoQ();
  const base = (serverQ.data?.publicUrl || window.location.origin).replace(/\/+$/, '');
  const fullUrl = state?.url ? base + state.url : '';

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/albums/' + albumId + '/share', {
        method: 'POST',
        headers: { ...client.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresDays: expiry === 'never' ? 0 : Number(expiry),
          password: password || undefined,
          allowDownload,
        }),
      });
      if (!res.ok) throw new Error();
      setState(await res.json());
      toast('Share link created');
    } catch {
      toast('Could not create link');
    }
    setBusy(false);
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await fetch('/api/albums/' + albumId + '/share', {
        method: 'DELETE',
        headers: client.authHeaders(),
      });
      setState({ shared: false });
      toast('Link revoked');
    } catch {
      toast('Could not revoke');
    }
    setBusy(false);
  };

  return (
    <div className="m-wrap">
      <div className="m-title">Share album</div>

      <PeopleShare albumId={albumId} />

      <div className="share-sec-label">Guest link</div>
      {state === null ? (
        <div className="m-note">Loading…</div>
      ) : state.shared ? (
        <>
          <p className="m-body">Anyone with this link can view the album — no account needed.</p>
          <div className="share-link-row">
            <input className="m-input" readOnly value={fullUrl} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="m-btn primary"
              onClick={() =>
                navigator.clipboard?.writeText(fullUrl).then(
                  () => toast('Link copied'),
                  () => toast('Could not copy'),
                )
              }
            >
              Copy
            </button>
          </div>
          <div className="m-note">
            {state.hasPassword ? 'Password protected · ' : ''}
            {state.allowDownload ? 'Downloads allowed · ' : 'Downloads off · '}
            {state.expiresAt
              ? 'expires ' + new Date(state.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : 'never expires'}
          </div>
          <div className="m-buttons">
            <button type="button" className="m-btn danger-text" disabled={busy} onClick={revoke}>
              Revoke link
            </button>
            <button type="button" className="m-btn primary" onClick={close}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="m-form">
            <label className="m-field">
              <span>Link expires</span>
              <select className="m-select" value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)}>
                <option value="7">In 7 days</option>
                <option value="30">In 30 days</option>
                <option value="never">Never</option>
              </select>
            </label>
            <label className="m-field">
              <span>
                Password <em>optional</em>
              </span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Leave empty for an open link"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="m-check">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
              />
              <span>Allow viewers to download originals</span>
            </label>
          </div>
          <div className="m-buttons">
            <button type="button" className="m-btn" onClick={close}>
              Close
            </button>
            <button type="button" className="m-btn primary" disabled={busy} onClick={create}>
              Create link
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Grant/revoke named-user access (View / Edit) to an album. */
function PeopleShare({ albumId }: { albumId: string }) {
  const { client } = useAuth();
  const toast = useToast();
  const [grants, setGrants] = useState<AlbumGrant[] | null>(null);
  const [username, setUsername] = useState('');
  const [level, setLevel] = useState<'view' | 'edit'>('view');
  const [busy, setBusy] = useState(false);

  const load = () => {
    client.albumGrants(albumId).then((j) => setGrants(j.grants)).catch(() => setGrants([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [albumId]);

  const add = async () => {
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const album = await client.addAlbumGrant(albumId, { username: name, level });
      setGrants(album.grants ?? []);
      setUsername('');
      toast('Shared with ' + name);
    } catch (e) {
      toast((e as Error).message || 'Could not share');
    }
    setBusy(false);
  };

  const changeLevel = async (g: AlbumGrant, next: 'view' | 'edit') => {
    try {
      const album = await client.addAlbumGrant(albumId, { username: g.username, level: next });
      setGrants(album.grants ?? []);
    } catch {
      toast('Could not update');
    }
  };

  const remove = async (g: AlbumGrant) => {
    try {
      const album = await client.removeAlbumGrant(albumId, g.userId);
      setGrants(album.grants ?? []);
    } catch {
      toast('Could not remove');
    }
  };

  return (
    <>
      <div className="share-sec-label">People</div>
      <div className="share-add-row">
        <input
          className="m-input"
          placeholder="Username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <select className="m-select share-lvl" value={level} onChange={(e) => setLevel(e.target.value as 'view' | 'edit')}>
          <option value="view">Can view</option>
          <option value="edit">Can edit</option>
        </select>
        <button type="button" className="m-btn primary" disabled={busy || !username.trim()} onClick={add}>
          Add
        </button>
      </div>
      {grants && grants.length > 0 ? (
        <div className="share-grants">
          {grants.map((g) => (
            <div key={g.userId} className="share-grant">
              <span className="share-grant-ico"><Svg html={ICON.account} /></span>
              <div className="share-grant-txt">
                <div className="share-grant-name">{g.displayName || g.username}</div>
                <div className="share-grant-sub">@{g.username}</div>
              </div>
              <select
                className="m-select share-lvl"
                value={g.level}
                onChange={(e) => changeLevel(g, e.target.value as 'view' | 'edit')}
              >
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
              <button type="button" className="share-grant-x" title="Remove" onClick={() => remove(g)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="m-note">Not shared with anyone yet.</div>
      )}
    </>
  );
}
