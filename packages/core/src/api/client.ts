/**
 * NookClient — the single typed HTTP client for the Nook server, shared by the
 * mobile and web apps. Framework-agnostic: plain `fetch` (global in RN, Node 18+,
 * and browsers). Auth is a per-user bearer token; the base URL is user-configured.
 */
import type {
  Album,
  AuthResult,
  PhotoRecord,
  PhotoUpload,
  PingResponse,
  Person,
  Place,
  ServerInfo,
  StatusRecord,
  User,
} from './types';

export interface NookClientConfig {
  /** e.g. https://photos.example.com or http://192.168.1.20:8080 */
  baseUrl: string;
  /** Bearer token; omit for the public/auth endpoints. */
  token?: string | null;
}

export class NookApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'NookApiError';
  }
}

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

export class NookClient {
  readonly baseUrl: string;
  private token: string | null;

  constructor(config: NookClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.token = config.token ?? null;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  /** Auth headers for direct image/video requests (expo-image `headers`, fetch, etc.). */
  authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  /** Absolute URL for a relative API path (e.g. a record's thumbUrl/originalUrl). */
  url(path: string): string {
    return path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  /**
   * Size-aware thumbnail URL. The new backend resizes on the fly and caches per
   * size; the client passes the exact pixel width the visible grid cell needs.
   */
  thumbUrl(id: string, width?: number): string {
    const base = `${this.baseUrl}/api/photos/${id}/thumb`;
    return width ? `${base}?w=${Math.round(width)}` : base;
  }

  originalUrl(id: string): string {
    return `${this.baseUrl}/api/photos/${id}/original`;
  }

  /** Streaming/range endpoint for video playback (chunked). */
  streamUrl(id: string): string {
    return `${this.baseUrl}/api/photos/${id}/original`;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; auth?: boolean; raw?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const { body, auth = true, signal } = opts;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(this.url(path), { method, headers, body: payload, signal });
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      if (json && typeof json === 'object' && 'error' in json) {
        msg = String((json as { error: unknown }).error);
      }
      throw new NookApiError(res.status, msg, json);
    }
    return json as T;
  }

  // ---- public / auth ----
  ping() {
    return this.request<PingResponse>('GET', '/api/ping', { auth: false });
  }
  serverInfo() {
    return this.request<ServerInfo>('GET', '/api/server', { auth: false });
  }
  setup(input: { username: string; password: string; displayName: string; email?: string }) {
    return this.request<AuthResult>('POST', '/api/setup', { auth: false, body: input });
  }
  login(input: { username: string; password: string }) {
    return this.request<AuthResult>('POST', '/api/login', { auth: false, body: input });
  }
  logout() {
    return this.request<{ ok: true }>('POST', '/api/logout');
  }

  // ---- account / users ----
  account() {
    return this.request<User>('GET', '/api/account');
  }
  updateAccount(input: {
    displayName?: string;
    email?: string;
    newPassword?: string;
    currentPassword?: string;
  }) {
    return this.request<User>('PATCH', '/api/account', { body: input });
  }
  users() {
    return this.request<{ users: User[] }>('GET', '/api/users');
  }
  createUser(input: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
    role?: string;
  }) {
    return this.request<User>('POST', '/api/users', { body: input });
  }
  deleteUser(id: string) {
    return this.request<{ ok: true }>('DELETE', `/api/users/${id}`);
  }

  // ---- library / photos ----
  status() {
    return this.request<StatusRecord>('GET', '/api/status');
  }
  library() {
    return this.request<{ photos: PhotoRecord[] }>('GET', '/api/library');
  }
  search(q: string, limit = 60) {
    return this.request<{ photos: PhotoRecord[] }>(
      'GET',
      `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }
  deleted() {
    return this.request<{ photos: PhotoRecord[] }>('GET', '/api/deleted');
  }
  emptyDeleted() {
    return this.request<{ ok: true; removed: number }>('DELETE', '/api/deleted');
  }
  createPhoto(meta: PhotoUpload) {
    return this.request<PhotoRecord>('POST', '/api/photos', { body: meta });
  }
  patchPhoto(id: string, patch: { favorite?: boolean; hidden?: boolean }) {
    return this.request<PhotoRecord>('PATCH', `/api/photos/${id}`, { body: patch });
  }
  deletePhoto(id: string) {
    return this.request<PhotoRecord>('DELETE', `/api/photos/${id}`);
  }
  restorePhoto(id: string) {
    return this.request<PhotoRecord>('POST', `/api/photos/${id}/restore`);
  }
  permanentDeletePhoto(id: string) {
    return this.request<{ ok: true }>('DELETE', `/api/photos/${id}/permanent`);
  }

  // ---- people / places (AI indexer) ----
  people() {
    return this.request<{ people: Person[] }>('GET', '/api/people');
  }
  personPhotos(id: string) {
    return this.request<{ photos: PhotoRecord[] }>('GET', `/api/people/${id}/photos`);
  }
  renamePerson(id: string, name: string) {
    return this.request<{ ok: true }>('PATCH', `/api/people/${id}`, { body: { name } });
  }
  setPersonHidden(id: string, hidden: boolean) {
    return this.request<{ ok: true }>('PATCH', `/api/people/${id}`, { body: { hidden } });
  }
  mergePeople(fromId: string, intoId: string) {
    return this.request<{ ok: true; moved: number }>('POST', '/api/people/merge', {
      body: { fromId, intoId },
    });
  }
  places() {
    return this.request<{ places: Place[] }>('GET', '/api/places');
  }
  placePhotos(label: string) {
    return this.request<{ photos: PhotoRecord[] }>(
      'GET',
      `/api/place-photos?label=${encodeURIComponent(label)}`,
    );
  }

  // ---- albums ----
  albums() {
    return this.request<{ albums: Album[] }>('GET', '/api/albums');
  }
  album(id: string) {
    return this.request<Album>('GET', `/api/albums/${id}`);
  }
  createAlbum(name: string) {
    return this.request<Album>('POST', '/api/albums', { body: { name } });
  }
  patchAlbum(
    id: string,
    patch: { name?: string; addPhotoIds?: string[]; removePhotoIds?: string[]; coverPhotoId?: string },
  ) {
    return this.request<Album>('PATCH', `/api/albums/${id}`, { body: patch });
  }
  deleteAlbum(id: string) {
    return this.request<{ ok: true }>('DELETE', `/api/albums/${id}`);
  }
}
