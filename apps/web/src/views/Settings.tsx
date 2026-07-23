/**
 * Settings — a routed page with a section rail (Profile, Security, Devices,
 * Users, Server). Consolidates account editing, 2FA, signed-in devices,
 * user management, and server info that used to live in scattered modals.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { User } from '@nook/core';
import { useAuth } from '../state/auth';
import { useStatusQ, useServerInfoQ } from '../state/data';
import { useModals, useToast } from '../state/ui';
import { ViewHead } from '../components/chrome';
import { fmtBytes } from '../lib/format';
import { ICON, Svg } from '../lib/icons';
import { biometricsAvailable, bioEnrolled, bioForget } from '../lib/webauthn';

const SECTIONS = [
  { key: 'profile', label: 'Profile', icon: 'account' },
  { key: 'security', label: 'Security', icon: 'hidden' },
  { key: 'devices', label: 'Devices', icon: 'account' },
  { key: 'users', label: 'Users', icon: 'users', adminOnly: true },
  { key: 'server', label: 'Server', icon: 'cloud' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

export function SettingsView() {
  const { section = 'profile' } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const active = (SECTIONS.some((s) => s.key === section) ? section : 'profile') as SectionKey;

  const visible = SECTIONS.filter((s) => !s.adminOnly || user?.role === 'admin');

  return (
    <>
      <ViewHead title="Settings" />
      <div id="grid">
        <div className="settings">
          <nav className="settings-rail">
            {visible.map((s) => (
              <button
                key={s.key}
                type="button"
                className={'settings-tab' + (active === s.key ? ' active' : '')}
                onClick={() => nav('/settings/' + s.key)}
              >
                <Svg className="settings-tab-ico" html={ICON[s.icon]} />
                <span>{s.label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-panel">
            {active === 'profile' ? <ProfileSection /> : null}
            {active === 'security' ? <SecuritySection /> : null}
            {active === 'devices' ? <DevicesSection /> : null}
            {active === 'users' ? <UsersSection /> : null}
            {active === 'server' ? <ServerSection /> : null}
          </div>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="set-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete ?? (type === 'password' ? 'new-password' : 'off')}
        autoCapitalize="none"
        spellCheck={false}
      />
    </label>
  );
}

// ------------------------------------------------------------------ profile

function ProfileSection() {
  const { client, user, setUser } = useAuth();
  const toast = useToast();
  const [account, setAccount] = useState<User | null>(user);
  const [name, setName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.account().then((a) => {
      setAccount(a);
      setUser(a);
      setName(a.displayName || '');
      setEmail(a.email || '');
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setError('');
    const body: Record<string, string> = {};
    if (name.trim() && name.trim() !== (account?.displayName || '')) body.displayName = name.trim();
    if (email.trim() !== (account?.email || '')) body.email = email.trim();
    if (newPw) {
      body.newPassword = newPw;
      body.currentPassword = curPw;
    }
    if (Object.keys(body).length === 0) return;
    setBusy(true);
    try {
      const updated = await client.updateAccount(body);
      setUser(updated);
      setAccount(updated);
      setNewPw('');
      setCurPw('');
      toast('Account updated');
    } catch (e) {
      setError((e as Error).message || 'Could not update account');
    }
    setBusy(false);
  };

  return (
    <section className="set-section">
      <h2 className="set-h">Profile</h2>
      <div className="set-form">
        <Field label="Name" type="text" value={name} onChange={setName} />
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <div className="set-note">
          @{account?.username}
          {account?.role === 'admin' ? ' · Administrator' : ''}
        </div>
      </div>
      <h3 className="set-subh">Change password</h3>
      <div className="set-form">
        <Field label="Current password" type="password" value={curPw} onChange={setCurPw} autoComplete="current-password" />
        <Field label="New password" type="password" value={newPw} onChange={setNewPw} />
      </div>
      {error ? <div className="m-error">{error}</div> : null}
      <div className="set-actions">
        <button type="button" className="m-btn primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- security

function SecuritySection() {
  const { client, user } = useAuth();
  const modals = useModals();
  const toast = useToast();
  const [totpOn, setTotpOn] = useState(!!user?.totpEnabled);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    client.account().then((a) => setTotpOn(!!a.totpEnabled)).catch(() => {});
    biometricsAvailable().then((s) => {
      setBioSupported(s);
      setBioOn(s && !!user && bioEnrolled(user.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disableTotp = async () => {
    const code = await modals.prompt({
      title: 'Disable two-factor',
      placeholder: '6-digit code from your app',
      confirm: 'Disable',
    });
    if (!code) return;
    try {
      await client.totpDisable(code);
      setTotpOn(false);
      toast('Two-factor disabled');
    } catch (e) {
      toast((e as Error).message || 'Could not disable');
    }
  };

  return (
    <section className="set-section">
      <h2 className="set-h">Security</h2>

      <div className="set-row">
        <div className="set-row-txt">
          <div className="set-row-title">Two-factor authentication</div>
          <div className="set-row-sub">
            {totpOn ? 'On — a code from your authenticator app is required at sign-in.' : 'Add a second step to every sign-in.'}
          </div>
        </div>
        {totpOn ? (
          <button type="button" className="m-btn danger-text" onClick={disableTotp}>
            Disable
          </button>
        ) : (
          <button
            type="button"
            className="m-btn primary"
            onClick={() => modals.openElement((c) => <TotpSetupCard close={c} onEnabled={() => setTotpOn(true)} />)}
          >
            Enable
          </button>
        )}
      </div>

      {bioSupported && user ? (
        <div className="set-row">
          <div className="set-row-txt">
            <div className="set-row-title">Biometric unlock</div>
            <div className="set-row-sub">
              {bioOn
                ? 'On for this device — unlock private albums with your fingerprint or face.'
                : 'Enable it from a private album on this device.'}
            </div>
          </div>
          {bioOn ? (
            <button
              type="button"
              className="m-btn danger-text"
              onClick={() => {
                bioForget(user.id);
                setBioOn(false);
                toast('Biometric unlock disabled on this device');
              }}
            >
              Disable
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TotpSetupCard({ close, onEnabled }: { close: () => void; onEnabled: () => void }) {
  const { client } = useAuth();
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.totpSetup().then(async (j) => {
      setSecret(j.secret);
      setQr(await QRCode.toDataURL(j.otpauth, { margin: 1, width: 220 }));
    }).catch(() => setError('Could not start setup'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    if (busy || !code) return;
    setBusy(true);
    setError('');
    try {
      await client.totpVerify(code);
      toast('Two-factor enabled');
      onEnabled();
      close();
    } catch (e) {
      setBusy(false);
      setError((e as Error).message || 'Invalid code');
    }
  };

  return (
    <div className="m-wrap">
      <div className="m-title">Enable two-factor</div>
      <p className="m-body">Scan with any authenticator app, then enter the 6-digit code to confirm.</p>
      {qr ? <img className="totp-qr" src={qr} alt="TOTP QR code" /> : <div className="m-note">Generating…</div>}
      {secret ? (
        <div className="m-note totp-secret">
          Manual key: <code>{secret}</code>
        </div>
      ) : null}
      <input
        className="m-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
        onKeyDown={(e) => e.key === 'Enter' && verify()}
      />
      {error ? <div className="m-error">{error}</div> : null}
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={close}>Cancel</button>
        <button type="button" className="m-btn primary" disabled={busy || code.length !== 6} onClick={verify}>
          {busy ? 'Checking…' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ devices

function DevicesSection() {
  const { client, signOutLocal } = useAuth();
  const toast = useToast();
  const [sessions, setSessions] = useState<
    { id: string; createdAt: string; label: string; current: boolean }[] | null
  >(null);

  const reload = () => {
    client.sessions().then((j) => setSessions(j.sessions)).catch(() => setSessions([]));
  };
  useEffect(reload, [client]);

  return (
    <section className="set-section">
      <h2 className="set-h">Signed-in devices</h2>
      <div className="set-list">
        {sessions === null ? (
          <div className="set-note">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="set-note">No sessions.</div>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="set-listrow">
              <div>
                <div className="set-row-title">
                  {s.label}
                  {s.current ? ' · this device' : ''}
                </div>
                <div className="set-row-sub">
                  since {new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
              <button
                type="button"
                className="m-btn danger-text"
                onClick={async () => {
                  try {
                    await client.revokeSession(s.id);
                    if (s.current) return signOutLocal();
                    toast('Device signed out');
                    reload();
                  } catch {
                    toast('Could not revoke');
                  }
                }}
              >
                {s.current ? 'Sign out' : 'Revoke'}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// -------------------------------------------------------------------- users

function UsersSection() {
  const { client, user } = useAuth();
  const modals = useModals();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);

  const reload = () => client.users().then((j) => setUsers(j.users)).catch(() => setUsers([]));
  useEffect(reload, [client]);

  const addUser = () =>
    modals.openElement((close) => (
      <AddUserCard
        close={close}
        onCreated={() => {
          reload();
          toast('User created');
        }}
      />
    ));

  return (
    <section className="set-section">
      <div className="set-section-head">
        <h2 className="set-h">Users</h2>
        <button type="button" className="m-btn primary" onClick={addUser}>
          Add user
        </button>
      </div>
      <div className="set-list">
        {users === null ? (
          <div className="set-note">Loading…</div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="set-listrow">
              <div>
                <div className="set-row-title">{u.displayName || u.username}</div>
                <div className="set-row-sub">@{u.username}{u.role === 'admin' ? ' · admin' : ''}</div>
              </div>
              {user && u.id !== user.id ? (
                <button
                  type="button"
                  className="m-user-del"
                  title="Delete user"
                  onClick={async () => {
                    const ok = await modals.confirm({
                      title: 'Delete ' + (u.displayName || u.username) + '?',
                      body: 'Their photos and albums are removed from the server. This cannot be undone.',
                      confirm: 'Delete',
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await client.deleteUser(u.id);
                      toast('User deleted');
                      reload();
                    } catch (e) {
                      toast((e as Error).message || 'Could not delete');
                    }
                  }}
                >
                  <Svg html={ICON.trash} />
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AddUserCard({ close, onCreated }: { close: () => void; onCreated: () => void }) {
  const { client } = useAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setError('');
    if (!name.trim() || !username.trim() || !password) {
      setError('All fields are required.');
      return;
    }
    setBusy(true);
    try {
      await client.createUser({ displayName: name.trim(), username: username.trim(), password });
      onCreated();
      close();
    } catch (e) {
      setBusy(false);
      setError((e as Error).message || 'Could not create user');
    }
  };

  return (
    <div className="m-wrap">
      <div className="m-title">Add user</div>
      <div className="set-form">
        <Field label="Name" type="text" value={name} onChange={setName} />
        <Field label="Username" type="text" value={username} onChange={setUsername} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
      </div>
      {error ? <div className="m-error">{error}</div> : null}
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={close}>Cancel</button>
        <button type="button" className="m-btn primary" disabled={busy} onClick={create}>Create</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- server

function ServerSection() {
  const statusQ = useStatusQ();
  const serverQ = useServerInfoQ();
  const s = statusQ.data;
  const st = s?.storage;
  const nav = useNavigate();
  const pct = st && st.totalBytes > 0 ? Math.min(100, (st.usedBytes / st.totalBytes) * 100) : 0;

  return (
    <section className="set-section">
      <h2 className="set-h">Server</h2>
      <div className="set-server-card">
        <div className="set-server-name">{s?.server?.name || serverQ.data?.name || 'nook.local'}</div>
        <div className="set-row-sub">
          {s?.server?.version ? 'Version ' + s.server.version : ''}
          {serverQ.data?.ai ? ' · AI indexer online' : ''}
        </div>
        {st ? (
          <>
            <div className="set-storage-bar">
              <div className="set-storage-fill" style={{ width: pct + '%' }} />
            </div>
            <div className="set-row-sub">
              {fmtBytes(st.usedBytes)} of {fmtBytes(st.totalBytes)} used
              {s?.library ? ' · ' + s.library.photos.toLocaleString('en-US') + ' photos, ' + s.library.videos.toLocaleString('en-US') + ' videos' : ''}
            </div>
          </>
        ) : null}
      </div>
      <div className="set-actions">
        <button type="button" className="m-btn" onClick={() => nav('/backup')}>Backup health</button>
        <button type="button" className="m-btn" onClick={() => nav('/welcome')}>Setup guide</button>
      </div>
    </section>
  );
}
