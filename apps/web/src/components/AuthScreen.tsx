/** Sign-in / first-run setup card, same markup as the vanilla dashboard. */
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../state/auth';

export function AuthScreen() {
  const { client, startSession } = useAuth();
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    client
      .ping()
      .then((j) => {
        if (j && (j as { setupRequired?: boolean }).setupRequired) setMode('setup');
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    if (mode === 'setup' && !displayName.trim()) {
      setError('Enter a name for your account.');
      return;
    }
    setBusy(true);
    try {
      const data =
        mode === 'setup'
          ? await client.setup({
              username: username.trim(),
              password,
              displayName: displayName.trim(),
              ...(email.trim() ? { email: email.trim() } : {}),
            })
          : await client.login({ username: username.trim(), password });
      startSession(data.token, data.user);
    } catch (err) {
      setBusy(false);
      const anyErr = err as { status?: number; message?: string };
      if (mode === 'setup' && anyErr.status === 409) {
        setMode('login');
        setError('This server has already been set up. Sign in with your account.');
        return;
      }
      if (anyErr.message && !/^HTTP/.test(anyErr.message)) setError(anyErr.message);
      else if (anyErr.status)
        setError(mode === 'setup' ? 'Could not create the account.' : 'Invalid username or password.');
      else setError('Could not reach the server. Check your connection and try again.');
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-mark" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
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
          <div className="auth-wordmark">nook</div>
        </div>

        <h1 className="auth-title">{mode === 'setup' ? 'Create your admin account' : 'Sign in'}</h1>
        <p className="auth-sub">
          {mode === 'setup'
            ? 'This Nook server is brand new. The first account you create becomes its administrator.'
            : 'Sign in to your Nook account to see your library.'}
        </p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {mode === 'setup' ? (
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span>Username</span>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          {mode === 'setup' ? (
            <label className="field">
              <span>
                Email <em>optional</em>
              </span>
              <input
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? (
            <div className="auth-error" role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy
              ? mode === 'setup'
                ? 'Creating…'
                : 'Signing in…'
              : mode === 'setup'
                ? 'Create admin account'
                : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
