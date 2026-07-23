/**
 * Post-signup onboarding: a five-step guide from "your server is alive" to a
 * fully working setup — keep the server always-on (Windows/macOS), connect the
 * phone, back up, optionally go public with a tunnel. Reachable any time at
 * /welcome (Account → Setup guide).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStatusQ } from '../state/data';
import { useToast } from '../state/ui';
import { fmtBytes } from '../lib/format';
import { Svg } from '../lib/icons';

const STEPS = ['Welcome', 'Always on', 'Your phone', 'Go anywhere', 'Done'];

const SVG_COPY =
  '<svg viewBox="0 0 24 24" fill="none"><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 15.5A2 2 0 0 1 3.5 13.5v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

function Code({ label, children }: { label?: string; children: string }) {
  const toast = useToast();
  return (
    <div className="ob-code">
      {label ? <div className="ob-code-label">{label}</div> : null}
      <pre>{children}</pre>
      <button
        type="button"
        className="ob-copy"
        title="Copy"
        aria-label="Copy to clipboard"
        onClick={() => {
          navigator.clipboard?.writeText(children).then(
            () => toast('Copied'),
            () => toast('Could not copy'),
          );
        }}
      >
        <Svg html={SVG_COPY} />
      </button>
    </div>
  );
}

export function Onboarding() {
  const nav = useNavigate();
  const statusQ = useStatusQ();
  const [step, setStep] = useState(0);
  const [os, setOs] = useState<'windows' | 'macos'>(() =>
    navigator.userAgent.includes('Mac') ? 'macos' : 'windows',
  );

  const origin = useMemo(() => window.location.origin, []);
  const s = statusQ.data;

  const next = () => setStep((v) => Math.min(STEPS.length - 1, v + 1));
  const back = () => setStep((v) => Math.max(0, v - 1));

  return (
    <div className="ob-wrap">
      <div className="ob-progress" role="progressbar" aria-valuenow={step + 1} aria-valuemax={STEPS.length}>
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={'ob-dot' + (i === step ? ' current' : '') + (i < step ? ' done' : '')}
            onClick={() => setStep(i)}
          >
            <span className="ob-dot-num">{i < step ? '✓' : i + 1}</span>
            <span className="ob-dot-label">{label}</span>
          </button>
        ))}
      </div>

      {step === 0 ? (
        <section className="ob-step">
          <div className="ob-emoji">🎉</div>
          <h1>Your Nook server is alive</h1>
          <p>
            You're the administrator of your own photo cloud
            {s?.server?.name ? (
              <>
                {' '}
                — <strong>{s.server.name}</strong>
                {s.server.version ? ' (v' + s.server.version + ')' : ''}
              </>
            ) : null}
            . Everything your devices back up here stays on hardware you control.
          </p>
          {s?.storage ? (
            <div className="ob-fact">
              <span>{fmtBytes(s.storage.usedBytes)}</span> used of{' '}
              <span>{fmtBytes(s.storage.totalBytes)}</span> available for your library.
            </div>
          ) : null}
          <p className="ob-muted">
            This short guide gets you from "it runs" to "I never think about it". You can reopen it
            any time from <strong>Account → Setup guide</strong>.
          </p>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="ob-step">
          <h1>Keep the server always on</h1>
          <p>
            Your library is only reachable while the server runs. Register it with the operating
            system so it starts on boot and restarts if it ever crashes.
          </p>
          <div className="ob-os-toggle">
            <button
              type="button"
              className={os === 'windows' ? 'active' : ''}
              onClick={() => setOs('windows')}
            >
              Windows
            </button>
            <button
              type="button"
              className={os === 'macos' ? 'active' : ''}
              onClick={() => setOs('macos')}
            >
              macOS
            </button>
          </div>
          {os === 'windows' ? (
            <>
              <p className="ob-muted">
                The repo ships a service installer built on{' '}
                <a href="https://nssm.cc" target="_blank" rel="noopener">
                  NSSM
                </a>
                . From an <strong>elevated</strong> PowerShell in the repo folder:
              </p>
              <Code label="PowerShell (Run as administrator)">
{`Set-ExecutionPolicy -Scope Process Bypass -Force
powershell -File apps/server/install-gateway-service.ps1
Get-Service nook-* | Select Name, Status, StartType`}
              </Code>
              <p className="ob-muted">
                The services start automatically on boot; manage them with{' '}
                <code>Restart-Service nook-gateway</code>.
              </p>
            </>
          ) : (
            <>
              <p className="ob-muted">
                Register a LaunchAgent so macOS starts the server at login and keeps it running:
              </p>
              <Code label="~/Library/LaunchAgents/com.nook.server.plist">
{`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.nook.server</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>/PATH/TO/nook-photos/apps/server/dist/index.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>`}
              </Code>
              <Code label="Load it">
{`launchctl load ~/Library/LaunchAgents/com.nook.server.plist`}
              </Code>
            </>
          )}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="ob-step">
          <h1>Connect your phone</h1>
          <p>
            The Nook mobile app backs up your camera roll — originals, with thumbnails generated on
            the device — and gives you the full library on the go.
          </p>
          <ol className="ob-list">
            <li>
              Open the Nook app on your phone (during development: the project in{' '}
              <strong>Expo Go</strong>).
            </li>
            <li>
              When asked for your server, enter:
              <Code>{origin}</Code>
            </li>
            <li>Tap <strong>Test Connection</strong>, then sign in with this account.</li>
            <li>
              Head to <strong>Backup &amp; Sync</strong> and start your first backup. Photos appear
              here as they upload.
            </li>
          </ol>
          <p className="ob-muted">
            Tip: on the same Wi-Fi you can also use the server's local address for faster first
            backups.
          </p>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="ob-step">
          <h1>Reach it from anywhere (optional)</h1>
          <p>
            A free{' '}
            <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/" target="_blank" rel="noopener">
              Cloudflare Tunnel
            </a>{' '}
            gives your server a public HTTPS address without opening ports on your router.
          </p>
          <Code label="One-time setup">
{`cloudflared tunnel login
cloudflared tunnel create nook
cloudflared tunnel route dns nook photos.yourdomain.com`}
          </Code>
          <Code label="~/.cloudflared/config.yml">
{`tunnel: nook
credentials-file: /path/to/<tunnel-id>.json
ingress:
  - hostname: photos.yourdomain.com
    service: http://localhost:8090
  - service: http_status:404`}
          </Code>
          <Code label="Run it (then install it as a service too)">
{`cloudflared tunnel run nook`}
          </Code>
          <p className="ob-muted">
            Prefer to stay local-only? Skip this — everything works on your home network.
          </p>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="ob-step">
          <div className="ob-emoji">✨</div>
          <h1>You're all set</h1>
          <p>A few things worth knowing as you settle in:</p>
          <ul className="ob-list ob-tips">
            <li><strong>Ctrl + scroll</strong> (or pinch) over the grid changes photo size.</li>
            <li>Every photo has a shareable URL — copy the address bar with a photo open.</li>
            <li><strong>Hidden</strong> and <strong>Recently Deleted</strong> unlock with your password or a fingerprint/face on this device.</li>
            <li>Select photos and download many at once as a ZIP.</li>
            <li>Search understands content: try “sunset”, “dog”, or a person's name.</li>
          </ul>
        </section>
      ) : null}

      <div className="ob-actions">
        {step > 0 ? (
          <button type="button" className="ob-btn ghost" onClick={back}>
            Back
          </button>
        ) : (
          <button type="button" className="ob-btn ghost" onClick={() => nav('/')}>
            Skip for now
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="ob-btn primary" onClick={next}>
            Continue
          </button>
        ) : (
          <button type="button" className="ob-btn primary" onClick={() => nav('/')}>
            Open my library
          </button>
        )}
      </div>
    </div>
  );
}
