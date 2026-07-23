/** Formatting helpers, ported 1:1 from the vanilla dashboard. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function fmtBytes(n: number): string {
  n = Number(n) || 0;
  if (n <= 0) return '0 MB';
  let v = n;
  let i = 0;
  while (v >= 1000 && i < BYTE_UNITS.length - 1) {
    v /= 1000;
    i += 1;
  }
  let str: string;
  if (v >= 100) str = String(Math.round(v));
  else if (v >= 1) str = v.toFixed(1).replace(/\.0$/, '');
  else str = v.toFixed(2);
  return str + ' ' + BYTE_UNITS[i];
}

export function fmtSizeMB(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' MB';
  return fmtBytes(n);
}

export function fmtDuration(seconds: number | null): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function fmtCount(n: number): string {
  n = Number(n) || 0;
  return n === 1 ? '1 item' : n.toLocaleString('en-US') + ' items';
}

/** Format a shutter speed: <1s → 1/N, else seconds. */
export function fmtExposure(t: number | null): string | null {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1) return n.toFixed(n % 1 === 0 ? 0 : 1) + 's';
  return '1/' + Math.round(1 / n) + 's';
}

export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

export function dayLabelOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfThat.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

export function deletedDaysLeft(deletedAt: string): number | null {
  const t = Date.parse(deletedAt);
  if (!t) return null;
  const left = 30 - Math.floor((Date.now() - t) / 86400000);
  return Math.max(0, left);
}
