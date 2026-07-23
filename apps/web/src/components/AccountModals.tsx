/** Account settings, user management, and add-user modal cards. */
import { useEffect, useState } from 'react';
import type { User } from '@nook/core';
import { useAuth } from '../state/auth';
import { useModals, useToast } from '../state/ui';
import { ICON, Svg } from '../lib/icons';

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
