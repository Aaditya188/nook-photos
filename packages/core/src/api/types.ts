/**
 * Nook server API records — mirrors `docs/API.md` (contract v2).
 * These are the wire types shared by every client.
 */

export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  role: UserRole;
  /** Two-factor (TOTP) enabled for this account. */
  totpEnabled?: boolean;
  createdAt: string;
}

export interface ServerInfo {
  name: string;
  model: string;
  version: string;
  setupRequired: boolean;
  uptimeSec: number;
  /** true when the local AI indexer is reachable (search/people/places available). */
  ai?: boolean;
  /** Admin-configured public base URL (share links, onboarding). */
  publicUrl?: string;
}

export interface PingResponse {
  ok: true;
  server: string;
  version: string;
  setupRequired: boolean;
}

export type MediaType = 'photo' | 'video';
export type UploadState = 'pending' | 'complete';

export interface PhotoRecord {
  id: string;
  userId: string;
  localIdentifier: string;
  filename: string;
  createdAt: string;
  width: number;
  height: number;
  bytes: number;
  mediaType: MediaType;
  duration: number | null;
  favorite: boolean;
  hidden: boolean;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  fNumber: number | null;
  focalLength: number | null;
  iso: number | null;
  exposureTime: number | null;
  latitude: number | null;
  longitude: number | null;
  live: boolean;
  screenshot: boolean;
  panorama: boolean;
  portrait: boolean;
  uploadState: UploadState;
  deletedAt: string | null;
  thumbUrl: string;
  originalUrl: string;
  /** Set by the gateway when a non-destructive edit recipe exists (cache-bust key). */
  editedAt?: number;
}

/** Body for POST /api/photos — required fields plus optional detail/backfill fields. */
export interface PhotoUpload {
  localIdentifier: string;
  filename: string;
  createdAt: string;
  width: number;
  height: number;
  bytes: number;
  mediaType: MediaType;
  duration?: number | null;
  favorite?: boolean;
  hidden?: boolean;
  live?: boolean;
  screenshot?: boolean;
  panorama?: boolean;
  portrait?: boolean;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lensModel?: string | null;
  fNumber?: number | null;
  focalLength?: number | null;
  iso?: number | null;
  exposureTime?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface AlbumGrant {
  userId: string;
  username: string;
  displayName: string;
  level: 'view' | 'edit';
  expiresAt: number | null;
}

export interface Album {
  id: string;
  userId: string;
  name: string;
  coverPhotoId: string | null;
  photoCount: number;
  photoIds?: string[];
  createdAt: string;
  /** This viewer's access when the album is shared with them. */
  sharedRole?: 'owner' | 'edit' | 'view';
  ownerName?: string;
  /** Present only for the owner. */
  grants?: AlbumGrant[];
}

export interface Person {
  id: string;
  name: string | null;
  count: number;
  coverPhotoId: string;
  coverThumbUrl: string;
}

export interface Place {
  label: string;
  count: number;
  coverPhotoId: string;
  coverThumbUrl: string;
}

export interface StatusRecord {
  server: { name: string; model: string; version: string; uptimeSec: number };
  storage: { usedBytes: number; totalBytes: number; availableBytes?: number | null; photoBytes: number; videoBytes: number };
  library: { items: number; photos: number; videos: number; lastBackupAt: string | null };
}

export interface AuthResult {
  token: string;
  user: User;
}
