/**
 * Sign-in / first-run setup: a split brand moment — hero panel (identity +
 * what Nook is) beside the auth card. First run (no accounts on the server)
 * becomes admin signup; afterwards it's sign-in. A successful signup routes
 * into the onboarding guide.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../state/auth';
import { Svg } from '../lib/icons';

const SVG_EYE_OPEN =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.7"/></svg>';
const SVG_EYE_OFF =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10.5 6.3A9.6 9.6 0 0 1 12 6.2c5 0 8.5 5.8 8.5 5.8a15 15 0 0 1-2.4 3M6.1 7.9A15.5 15.5 0 0 0 3.5 12s3.5 5.8 8.5 5.8c1.2 0 2.3-.3 3.3-.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const FEATURES = [
  {
    icon: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-3.2-3.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    title: 'Search that understands your photos',
    sub: '“beach sunset with friends” — AI search, faces, and places, indexed on your machine.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 18.5a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17.3 9a4 4 0 0 1-.3 8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12.5v5m0-5l-2 2m2-2l2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    title: 'Original quality, forever',
    sub: 'Every photo and video backed up untouched to hardware you own. No compression, no subscription.',
  },
  {
    icon: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="9.5" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    title: 'Private by design',
    sub: 'Your library never leaves your server. Locked albums, biometric unlock, per-user accounts.',
  },
];

export function AuthScreen() {
  const { client, startSession } = useAuth();
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);

  useEffect(() => {
    client
      .ping()
      .then((j) => {
        if (j?.setupRequired) setMode('setup');
        if (j?.server) setServerName(j.server);
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
      // A fresh admin signup lands in the onboarding guide.
      if (mode === 'setup') localStorage.setItem('nookShowOnboarding', '1');
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
    <div className="auth-screen auth-split">
      {/* ---------------------------------------------------- brand hero */}
      <div className="auth-hero">
        <div className="auth-hero-inner">
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

          <h1 className="auth-hero-title">
            Your photos.
            <br />
            Your server.
            <br />
            <span>Nobody else's.</span>
          </h1>
          <p className="auth-hero-sub">
            A private, self-hosted home for every photo and video you take — with the polish of the
            big clouds and none of the strings.
          </p>

          <div className="auth-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="auth-feature">
                <Svg className="auth-feature-ico" html={f.icon} />
                <div>
                  <div className="auth-feature-title">{f.title}</div>
                  <div className="auth-feature-sub">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------ auth card */}
      <div className="auth-panel">
        <div className="auth-card">
          <h2 className="auth-title">
            {mode === 'setup' ? 'Create your admin account' : 'Welcome back'}
          </h2>
          <p className="auth-sub">
            {mode === 'setup'
              ? 'This Nook server is brand new. The first account you create becomes its administrator.'
              : serverName
                ? 'Sign in to ' + serverName + ' to see your library.'
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
            <label className="field field-pw">
              <span>Password</span>
              <div className="pw-wrap">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="pw-toggle"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPw((v) => !v)}
                >
                  <Svg html={showPw ? SVG_EYE_OFF : SVG_EYE_OPEN} />
                </button>
              </div>
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

          <div className="auth-foot">
            {mode === 'setup'
              ? 'Self-hosted · open source · your data stays here'
              : 'Nook Photos · self-hosted photo backup'}
          </div>
        </div>
      </div>
    </div>
  );
}
