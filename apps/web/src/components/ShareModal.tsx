/**
 * Share-an-album modal: create/replace/revoke the album's public link with
 * optional expiry, password, and download permission.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../state/auth';
import { useServerInfoQ } from '../state/data';
import { useToast } from '../state/ui';

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
              Cancel
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
