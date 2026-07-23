/**
 * Floating multi-select action bar. Bulk actions mirror the vanilla dashboard:
 * favorite / add-to-album / hide / download (single = direct, N = client ZIP) /
 * delete, plus restore/permanent-delete in Recently Deleted and set-cover /
 * remove in an album.
 */
import type { PhotoRecord } from '@nook/core';
import { useAuth } from '../state/auth';
import { useActions, useAlbumsQ, qk } from '../state/data';
import { useModals, useToast } from '../state/ui';
import { useView } from '../state/view';
import { buildZip, dedupeName, saveBlob } from '../lib/zip';
import { fmtSizeMB } from '../lib/format';
import {
  ICON,
  SVG_ADD_ALBUM,
  SVG_DOWNLOAD,
  SVG_HEART_OUTLINE,
  SVG_REMOVE,
  SVG_RESTORE,
  SVG_SET_COVER,
  Svg,
} from '../lib/icons';
import { useQueryClient } from '@tanstack/react-query';

export type BarContext =
  | { kind: 'normal' }
  | { kind: 'deleted' }
  | { kind: 'album'; albumId: string };

export function SelectionBar({ list, context }: { list: PhotoRecord[]; context: BarContext }) {
  const { selectMode, selectedIds, exitSelect } = useView();
  const { client } = useAuth();
  const actions = useActions();
  const modals = useModals();
  const toast = useToast();
  const albumsQ = useAlbumsQ();
  const qc = useQueryClient();

  if (!selectMode) return null;
  const n = selectedIds.size;

  const selectedPhotos = () => list.filter((p) => selectedIds.has(p.id));

  const finish = (count: number, verb: string) => {
    toast(count + (count === 1 ? ' photo · ' : ' photos · ') + verb);
    exitSelect();
  };

  const bulkEach = async (fn: (p: PhotoRecord) => Promise<unknown>) => {
    let ok = 0;
    for (const p of selectedPhotos()) {
      try {
        await fn(p);
        ok += 1;
      } catch {
        /* per-item tolerance */
      }
    }
    return ok;
  };

  const bulkFavorite = async () => {
    const done = await bulkEach(async (p) => {
      if (!p.favorite) await actions.toggleFavorite(p);
    });
    finish(done, 'Added to Favorites');
  };

  const bulkHide = async () => {
    const done = await bulkEach(async (p) => {
      if (!p.hidden) await actions.toggleHidden(p);
    });
    finish(done, 'Hidden');
  };

  const bulkDelete = async () => {
    const ok = await modals.confirm({
      title: 'Delete ' + n + (n === 1 ? ' photo?' : ' photos?'),
      body: 'They move to Recently Deleted and are removed forever after 30 days.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const done = await bulkEach((p) => actions.deletePhoto(p));
    finish(done, 'Moved to Recently Deleted');
  };

  const bulkRestore = async () => {
    const done = await bulkEach((p) => actions.restorePhoto(p));
    finish(done, 'Restored');
  };

  const bulkPermanent = async () => {
    const ok = await modals.confirm({
      title: 'Delete ' + n + (n === 1 ? ' photo' : ' photos') + ' permanently?',
      body: 'This cannot be undone.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const done = await bulkEach((p) => actions.permanentDelete(p));
    finish(done, 'Deleted');
  };

  const bulkAddToAlbum = async () => {
    const albums = albumsQ.data || [];
    const choice = await modals.albumPicker(albums, null);
    if (!choice) return;
    let albumId = choice.albumId;
    if (choice.createName) {
      const created = await actions.createAlbum(choice.createName);
      if (!created) return;
      albumId = created.id;
    }
    if (!albumId) return;
    const updated = await actions.patchAlbum(
      albumId,
      { addPhotoIds: [...selectedIds] },
      'Could not add to album',
    );
    if (updated) finish(n, 'Added to “' + updated.name + '”');
  };

  const bulkRemoveFromAlbum = async () => {
    if (context.kind !== 'album') return;
    const updated = await actions.patchAlbum(
      context.albumId,
      { removePhotoIds: [...selectedIds] },
      'Could not remove',
    );
    if (updated) finish(n, 'Removed from album');
  };

  const bulkSetCover = async () => {
    if (context.kind !== 'album' || n !== 1) return;
    const updated = await actions.patchAlbum(
      context.albumId,
      { coverPhotoId: [...selectedIds][0] },
      'Could not set cover',
    );
    if (updated) finish(1, 'Set as cover');
  };

  const bulkDownload = async () => {
    const photos = selectedPhotos().filter((p) => p.uploadState === 'complete');
    if (!photos.length) {
      toast('Nothing downloadable selected');
      return;
    }
    if (photos.length === 1) {
      const p = photos[0];
      try {
        const res = await fetch(p.originalUrl, { headers: client.authHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        saveBlob(await res.blob(), p.filename);
        finish(1, 'Downloaded');
      } catch {
        toast('Download failed');
      }
      return;
    }
    const totalBytes = photos.reduce((s, p) => s + (p.bytes || 0), 0);
    if (totalBytes > 400 * 1024 * 1024) {
      const ok = await modals.confirm({
        title: 'Large download',
        body: 'This selection is about ' + fmtSizeMB(totalBytes) + '. Build the ZIP anyway?',
        confirm: 'Download',
      });
      if (!ok) return;
    }
    const files: { name: string; data: Uint8Array; date: Date }[] = [];
    const used = new Set<string>();
    let i = 0;
    for (const p of photos) {
      i++;
      toast('Downloading ' + i + ' of ' + photos.length + '…');
      try {
        const res = await fetch(p.originalUrl, { headers: client.authHeaders() });
        if (!res.ok) continue;
        const name = dedupeName(p.filename || p.id, used);
        used.add(name);
        files.push({ name, data: new Uint8Array(await res.arrayBuffer()), date: new Date(p.createdAt) });
      } catch {
        /* skip failed item */
      }
    }
    if (!files.length) {
      toast('Download failed');
      return;
    }
    toast('Building ZIP…');
    const stamp = new Date().toISOString().slice(0, 10);
    saveBlob(buildZip(files), 'nook-photos-' + stamp + '.zip');
    finish(files.length, 'Downloaded');
  };

  const btn = (title: string, icon: string, fn: () => void, danger = false) => (
    <button
      key={title}
      type="button"
      className={'sel-btn' + (danger ? ' danger' : '')}
      title={title}
      disabled={n === 0}
      onClick={fn}
    >
      <Svg html={icon} />
      <span>{title}</span>
    </button>
  );

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection actions">
      <span className="sel-count">{n === 0 ? 'Select photos' : n + ' selected'}</span>
      <div className="sel-actions">
        {context.kind === 'deleted' ? (
          <>
            {btn('Restore', SVG_RESTORE, bulkRestore)}
            {btn('Download', SVG_DOWNLOAD, bulkDownload)}
            {btn('Delete', ICON.trash, bulkPermanent, true)}
          </>
        ) : (
          <>
            {btn('Favorite', SVG_HEART_OUTLINE, bulkFavorite)}
            {btn('Add to Album', SVG_ADD_ALBUM, bulkAddToAlbum)}
            {btn('Hide', ICON.hidden, bulkHide)}
            {btn('Download', SVG_DOWNLOAD, bulkDownload)}
            {btn('Delete', ICON.trash, bulkDelete, true)}
            {context.kind === 'album' && n === 1 ? btn('Set cover', SVG_SET_COVER, bulkSetCover) : null}
            {context.kind === 'album' ? btn('Remove', SVG_REMOVE, bulkRemoveFromAlbum) : null}
          </>
        )}
      </div>
    </div>
  );
}
