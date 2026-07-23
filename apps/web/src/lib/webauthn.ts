/**
 * Biometric unlock for private albums via WebAuthn platform authenticators —
 * Windows Hello on desktop, Face ID / Touch ID on iOS Safari, fingerprint on
 * Android. A platform credential is enrolled per device+user after a
 * successful password unlock; later unlocks call `navigator.credentials.get`
 * with `userVerification: 'required'`, which makes the OS itself verify the
 * user's face/fingerprint/PIN locally. This gates the UI (the private-album
 * wall), with the account password always available as fallback.
 */

const CRED_KEY = 'nookBioCred';
const DECLINED_KEY = 'nookBioDeclined';

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (
      !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function bioEnrolled(userId: string): boolean {
  return !!localStorage.getItem(CRED_KEY + ':' + userId);
}

export function bioForget(userId: string) {
  localStorage.removeItem(CRED_KEY + ':' + userId);
  localStorage.removeItem(DECLINED_KEY + ':' + userId);
}

export function bioDeclined(userId: string): boolean {
  return !!localStorage.getItem(DECLINED_KEY + ':' + userId);
}

export function bioDecline(userId: string) {
  localStorage.setItem(DECLINED_KEY + ':' + userId, '1');
}

export async function bioEnroll(
  userId: string,
  username: string,
  displayName: string,
): Promise<boolean> {
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Nook Photos', id: location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: username,
          displayName: displayName || username,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(CRED_KEY + ':' + userId, b64(cred.rawId));
    localStorage.removeItem(DECLINED_KEY + ':' + userId);
    return true;
  } catch {
    return false;
  }
}

export async function bioVerify(userId: string): Promise<boolean> {
  const stored = localStorage.getItem(CRED_KEY + ':' + userId);
  if (!stored) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [
          { type: 'public-key', id: unb64(stored) as BufferSource, transports: ['internal'] },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}
