/** Account settings, security (devices, 2FA), user management modal cards. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import type { User } from '@nook/core';
import { useAuth } from '../state/auth';
import { useModals, useToast } from '../state/ui';
import { ICON, Svg } from '../lib/icons';
import { bioEnrolled, bioForget } from '../lib/webauthn';

export function useAccountModals() {
  const modals = useModals();
  const openAccount = () => {
    modals.openElement((close) => <AccountCard close={close} />);
  };
  return { openAccount };
}

function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="m-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        autoCapitalize="none"
        spellCheck={false}
      />
    </label>
  );
}

function AccountCard({ close }: { close: () => void }) {
  const { client, user, setUser } = useAuth();
  const modals = useModals();
  const toast = useToast();
  const navigate = useNavigate();
  const [account, setAccount] = useState<User | null>(user);
  const [name, setName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client
      .account()
      .then((a) => {
        setAccount(a);
        setUser(a);
        setName(a.displayName || '');
        setEmail(a.email || '');
      })
      .catch(() => {});
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
    if (Object.keys(body).length === 0) {
      close();
      return;
    }
    setBusy(true);
    try {
      const updated = await client.updateAccount(body);
      setUser(updated);
      close();
      toast('Account updated');
    } catch (e) {
      setBusy(false);
      setError((e as Error).message || 'Could not update account');
    }
  };

  return (
    <div className="m-wrap">
      <div className="m-title">Account</div>
      <div className="m-form">
        <Field label="Name" type="text" value={name} onChange={setName} />
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <div className="m-note">
          @{account?.username || ''}
          {account?.role === 'admin' ? ' · Administrator' : ''}
        </div>
        <div className="m-subtitle">Change password</div>
        <Field label="Current password" type="password" value={curPw} onChange={setCurPw} />
        <Field label="New password" type="password" value={newPw} onChange={setNewPw} />
      </div>
      {error ? <div className="m-error">{error}</div> : null}
      <button
        type="button"
        className="m-link"
        onClick={() => modals.openElement((c) => <DevicesCard close={c} />)}
      >
        Signed-in devices →
      </button>
      <button
        type="button"
        className="m-link"
        onClick={() => {
          if (account?.totpEnabled) {
            void (async () => {
              const code = await modals.prompt({
                title: 'Disable two-factor',
                placeholder: '6-digit code from your app',
                confirm: 'Disable',
              });
              if (!code) return;
              try {
                await client.totpDisable(code);
                setAccount((a) => (a ? { ...a, totpEnabled: false } : a));
                toast('Two-factor disabled');
              } catch (e) {
                toast((e as Error).message || 'Could not disable');
              }
            })();
          } else {
            modals.openElement((c) => <TotpSetupCard close={c} onEnabled={() => setAccount((a) => (a ? { ...a, totpEnabled: true } : a))} />);
          }
        }}
      >
        {account?.totpEnabled ? 'Disable two-factor authentication' : 'Enable two-factor authentication →'}
      </button>
      <button
        type="button"
        className="m-link"
        onClick={() => {
          close();
          navigate('/welcome');
        }}
      >
        Setup guide →
      </button>
      {account && bioEnrolled(account.id) ? (
        <button
          type="button"
          className="m-link"
          onClick={() => {
            bioForget(account.id);
            toast('Biometric unlock disabled on this device');
            close();
          }}
        >
          Disable biometric unlock on this device
        </button>
      ) : null}
      {account?.role === 'admin' ? (
        <button
          type="button"
          className="m-link"
          onClick={() => modals.openElement((c) => <UsersCard close={c} />)}
        >
          Manage users →
        </button>
      ) : null}
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="m-btn primary" disabled={busy} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

/** Signed-in devices with per-session revoke. */
function DevicesCard({ close }: { close: () => void }) {
  const { client, signOutLocal } = useAuth();
  const toast = useToast();
  const [sessions, setSessions] = useState<
    { id: string; createdAt: string; label: string; current: boolean }[] | null
  >(null);

  const reload = () => {
    client
      .sessions()
      .then((j) => setSessions(j.sessions))
      .catch(() => setSessions([]));
  };
  useEffect(reload, [client]);

  return (
    <div className="m-wrap">
      <div className="m-title">Signed-in devices</div>
      <div className="m-list">
        {sessions === null ? (
          <div className="m-note">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="m-note">No sessions.</div>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="m-user">
              <div className="m-user-info">
                <div className="m-user-name">
                  {s.label}
                  {s.current ? ' · this device' : ''}
                </div>
                <div className="m-user-sub">
                  since{' '}
                  {new Date(s.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
              <button
                type="button"
                className="m-user-del"
                title={s.current ? 'Sign out this device' : 'Revoke'}
                onClick={async () => {
                  try {
                    await client.revokeSession(s.id);
                    if (s.current) {
                      signOutLocal();
                      return;
                    }
                    toast('Device signed out');
                    reload();
                  } catch {
                    toast('Could not revoke');
                  }
                }}
              >
                <Svg html={ICON.trash} />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="m-buttons">
        <button type="button" className="m-btn primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Enable TOTP: QR + secret, then a code to confirm. */
function TotpSetupCard({ close, onEnabled }: { close: () => void; onEnabled: () => void }) {
  const { client } = useAuth();
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client
      .totpSetup()
      .then(async (j) => {
        setSecret(j.secret);
        setQr(await QRCode.toDataURL(j.otpauth, { margin: 1, width: 220 }));
      })
      .catch(() => setError('Could not start setup'));
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
      <p className="m-body">
        Scan with any authenticator app (Google Authenticator, 1Password, Authy…), then enter the
        6-digit code to confirm.
      </p>
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
        <button type="button" className="m-btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="m-btn primary" disabled={busy || code.length !== 6} onClick={verify}>
          {busy ? 'Checking…' : 'Turn on'}
        </button>
      </div>
    </div>
  );
}

function UsersCard({ close }: { close: () => void }) {
  const { client, user } = useAuth();
  const modals = useModals();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = () => {
    client
      .users()
      .then((j) => setUsers(j.users))
      .catch(() => setFailed(true));
  };
  useEffect(reload, [client]);

  return (
    <div className="m-wrap">
      <div className="m-title">Users</div>
      <div className="m-list">
        {failed ? (
          <div className="m-note">Could not load users.</div>
        ) : users === null ? (
          <div className="m-note">Loading…</div>
        ) : users.length === 0 ? (
          <div className="m-note">No users.</div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="m-user">
              <div className="m-user-info">
                <div className="m-user-name">{u.displayName || u.username}</div>
                <div className="m-user-sub">
                  @{u.username}
                  {u.role === 'admin' ? ' · admin' : ''}
                </div>
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
                    // Re-open the users list either way (confirm replaced us).
                    modals.openElement((c) => <UsersCard close={c} />);
                    if (!ok) return;
                    try {
                      await client.deleteUser(u.id);
                      toast('User deleted');
                    } catch (e) {
                      toast((e as Error).message || 'Could not delete user');
                    }
                    modals.openElement((c) => <UsersCard close={c} />);
                  }}
                >
                  <Svg html={ICON.trash} />
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        className="m-link"
        onClick={() => modals.openElement((c) => <AddUserCard close={c} />)}
      >
        + Add user
      </button>
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

function AddUserCard({ close }: { close: () => void }) {
  const { client } = useAuth();
  const modals = useModals();
  const toast = useToast();
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
      await client.createUser({
        displayName: name.trim(),
        username: username.trim(),
        password,
      });
      toast('User created');
      modals.openElement((c) => <UsersCard close={c} />);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message || 'Could not create user');
    }
  };

  return (
    <div className="m-wrap">
      <div className="m-title">Add User</div>
      <div className="m-form">
        <Field label="Name" type="text" value={name} onChange={setName} />
        <Field label="Username" type="text" value={username} onChange={setUsername} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
      </div>
      {error ? <div className="m-error">{error}</div> : null}
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="m-btn primary" disabled={busy} onClick={create}>
          Create
        </button>
      </div>
    </div>
  );
}
