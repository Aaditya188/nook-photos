/** All routed views: Library/categories/Hidden, Deleted, People, Places,
 *  Person, Place, Albums, Album detail — same structure as the vanilla UI. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PhotoRecord } from '@nook/core';
import { useAuth } from '../state/auth';
import {
  useActions,
  useAlbumsQ,
  useDeletedQ,
  useLibraryQ,
  usePeopleQ,
  usePersonPhotosQ,
  usePlacePhotosQ,
  usePlacesQ,
} from '../state/data';
import { useModals, useToast } from '../state/ui';
import { useRegisterList, useView } from '../state/view';
import { PhotoGrid } from '../components/PhotoGrid';
import { MemoriesStrip } from '../components/Memories';
import { ShareCard } from '../components/ShareModal';
import { SelectionBar, type BarContext } from '../components/SelectionBar';
import {
  CoverTile,
  DeletedNote,
  EmptyState,
  PersonTile,
  ViewHead,
  type HeadAction,
} from '../components/chrome';
import { fmtCount } from '../lib/format';
import { ICON, SVG_FINGERPRINT, SVG_LOCK, SVG_PLUS, Svg } from '../lib/icons';
import type { Person } from '@nook/core';
import {
  bioDecline,
  bioDeclined,
  bioEnroll,
  bioEnrolled,
  bioVerify,
  biometricsAvailable,
} from '../lib/webauthn';

// Media-type categories, mirroring iOS BrowseFilter.
export const CATEGORIES: Record<
  string,
  { title: string; icon: string; test: (p: PhotoRecord) => boolean }
> = {
  favorites: { title: 'Favorites', icon: 'heart', test: (p) => p.favorite },
  videos: { title: 'Videos', icon: 'video', test: (p) => p.mediaType === 'video' },
  portrait: { title: 'Portrait', icon: 'portrait', test: (p) => p.portrait },
  live: { title: 'Live Photos', icon: 'live', test: (p) => p.live },
  panoramas: { title: 'Panoramas', icon: 'pano', test: (p) => p.panorama },
  screenshots: { title: 'Screenshots', icon: 'screenshot', test: (p) => p.screenshot },
};
export const CATEGORY_ORDER = ['favorites', 'videos', 'portrait', 'live', 'panoramas', 'screenshots'];

function useSelectAction(hasItems: boolean): HeadAction[] {
  const { selectMode, enterSelect, exitSelect } = useView();
  if (!hasItems) return [];
  return [{ label: selectMode ? 'Done' : 'Select', onClick: selectMode ? exitSelect : enterSelect }];
}

/** Shared scaffold for a photo-list view. */
function PhotoListView({
  title,
  subtitle,
  list,
  grouped,
  emptyKind,
  back,
  extraActions = [],
  barContext = { kind: 'normal' },
  note,
  lead,
}: {
  title: string;
  subtitle?: string;
  list: PhotoRecord[];
  grouped: boolean;
  emptyKind: string;
  back?: { label: string; to: string };
  extraActions?: HeadAction[];
  barContext?: BarContext;
  note?: boolean;
  lead?: React.ReactNode;
}) {
  useRegisterList(list);
  const selectAction = useSelectAction(list.length > 0);
  return (
    <>
      <ViewHead
        title={title}
        subtitle={subtitle ?? (list.length ? fmtCount(list.length) : '')}
        back={back}
        actions={[...selectAction, ...extraActions]}
      />
      <div id="grid" aria-label="Photo library">
        {list.length === 0 ? (
          <EmptyState kind={emptyKind} />
        ) : (
          <>
            {note ? <DeletedNote /> : null}
            {lead}
            <PhotoGrid list={list} grouped={grouped} />
          </>
        )}
      </div>
      <SelectionBar list={list} context={barContext} />
    </>
  );
}

// ---------------------------------------------------------- library & co.

export function LibraryView() {
  const lib = useLibraryQ();
  const list = useMemo(() => (lib.data || []).filter((p) => !p.hidden), [lib.data]);
  return (
    <PhotoListView
      title="Library"
      list={list}
      grouped
      emptyKind="library"
      lead={<MemoriesStrip photos={list} />}
    />
  );
}

export function CategoryView() {
  const { key = '' } = useParams();
  const cat = CATEGORIES[key];
  const lib = useLibraryQ();
  const list = useMemo(
    () => (cat ? (lib.data || []).filter((p) => !p.hidden && cat.test(p)) : []),
    [lib.data, cat],
  );
  return (
    <PhotoListView title={cat ? cat.title : 'Photos'} list={list} grouped emptyKind={key} />
  );
}

// --------------------------------------------------------------- private gate

/**
 * Hidden / Recently Deleted require unlocking once per session. Until then the
 * view is a wall with a centered "Unlock Album" action. When a biometric
 * credential is enrolled on this device (Windows Hello / Face ID / Touch ID /
 * fingerprint via WebAuthn), unlocking tries that first and silently falls
 * back to the account password; after a successful password unlock on a
 * capable device, we offer to enable biometrics for next time.
 */
function PrivateGate({ label, children }: { label: string; children: React.ReactNode }) {
  const { privateUnlocked, setPrivateUnlocked, user, client } = useAuth();
  const modals = useModals();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioReady, setBioReady] = useState(false);

  useEffect(() => {
    let alive = true;
    biometricsAvailable().then((s) => {
      if (!alive) return;
      setBioSupported(s);
      setBioReady(s && !!user && bioEnrolled(user.id));
    });
    return () => {
      alive = false;
    };
  }, [user]);

  const unlockWithPassword = async (): Promise<boolean> => {
    const pw = await modals.prompt({
      title: 'Unlock ' + label,
      placeholder: 'Account password',
      confirm: 'Unlock',
      password: true,
    });
    if (!pw) return false; // cancelled — stay on the wall
    setBusy(true);
    try {
      await client.login({ username: user?.username || '', password: pw });
      setBusy(false);
      // First successful password unlock on a biometric-capable device:
      // offer to enroll (once — declining is remembered).
      if (bioSupported && user && !bioEnrolled(user.id) && !bioDeclined(user.id)) {
        const enable = await modals.confirm({
          title: 'Enable biometric unlock?',
          body: 'Unlock private albums on this device with your face, fingerprint, or device PIN instead of your password.',
          confirm: 'Enable',
        });
        if (enable) {
          const ok = await bioEnroll(user.id, user.username, user.displayName || '');
          toast(ok ? 'Biometric unlock enabled' : 'Could not enable biometrics');
          setBioReady(ok);
        } else {
          bioDecline(user.id);
        }
      }
      return true;
    } catch {
      setBusy(false);
      toast('Incorrect password');
      return false;
    }
  };

  const unlock = async () => {
    if (busy) return;
    // Biometric first when enrolled; cancel/failure falls back to password.
    if (bioReady && user) {
      setBusy(true);
      const ok = await bioVerify(user.id);
      setBusy(false);
      if (ok) {
        setPrivateUnlocked(true);
        return;
      }
    }
    if (await unlockWithPassword()) setPrivateUnlocked(true);
  };

  if (!privateUnlocked) {
    return (
      <>
        <ViewHead title={label} />
        <div id="grid">
          <div className="lock-wall">
            <div className="lock-wall-icon">
              <Svg html={SVG_LOCK} />
            </div>
            <h2 className="lock-wall-title">{label} is locked</h2>
            <p className="lock-wall-sub">
              This album is protected. Enter your account password to view its photos.
            </p>
            <button type="button" className="lock-wall-btn" disabled={busy} onClick={unlock}>
              <Svg html={bioReady ? SVG_FINGERPRINT : SVG_LOCK} />
              <span>{busy ? 'Unlocking…' : 'Unlock Album'}</span>
            </button>
            {bioReady ? (
              <div className="lock-wall-hint">Face / fingerprint unlock is on for this device</div>
            ) : null}
          </div>
        </div>
      </>
    );
  }
  return <>{children}</>;
}

export function HiddenView() {
  const lib = useLibraryQ();
  const list = useMemo(() => (lib.data || []).filter((p) => p.hidden), [lib.data]);
  return (
    <PrivateGate label="Hidden">
      <PhotoListView title="Hidden" list={list} grouped emptyKind="hidden" />
    </PrivateGate>
  );
}

export function DeletedView() {
  const { privateUnlocked } = useAuth();
  const q = useDeletedQ(privateUnlocked);
  const list = q.data || [];
  const actions = useActions();
  const modals = useModals();

  const extra: HeadAction[] = list.length
    ? [
        {
          label: 'Empty',
          danger: true,
          onClick: async () => {
            const ok = await modals.confirm({
              title: 'Empty Recently Deleted?',
              body: 'All photos here will be removed from your server forever. This cannot be undone.',
              confirm: 'Empty',
              danger: true,
            });
            if (ok) await actions.emptyDeleted();
          },
        },
      ]
    : [];

  return (
    <PrivateGate label="Recently Deleted">
      <PhotoListView
        title="Recently Deleted"
        list={list}
        grouped={false}
        emptyKind="deleted"
        extraActions={extra}
        barContext={{ kind: 'deleted' }}
        note
      />
    </PrivateGate>
  );
}

// ------------------------------------------------------------ people & places

export function PeopleView() {
  const q = usePeopleQ();
  const people = q.data || [];
  const nav = useNavigate();
  useRegisterList(useMemo(() => [], []));
  return (
    <>
      <ViewHead
        title="People"
        subtitle={
          people.length
            ? fmtCount(people.length).replace('items', 'people').replace('item', 'person')
            : ''
        }
      />
      <div id="grid">
        {people.length === 0 ? (
          <EmptyState kind="people" />
        ) : (
          <div className="people-grid">
            {people.map((person) => (
              <PersonTile
                key={person.id}
                person={person}
                onClick={() => nav('/person/' + encodeURIComponent(person.id))}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function PlacesView() {
  const q = usePlacesQ();
  const places = q.data || [];
  const nav = useNavigate();
  useRegisterList(useMemo(() => [], []));
  return (
    <>
      <ViewHead
        title="Places"
        subtitle={
          places.length
            ? fmtCount(places.length).replace('items', 'places').replace('item', 'place')
            : ''
        }
      />
      <div id="grid">
        {places.length === 0 ? (
          <EmptyState kind="places" />
        ) : (
          <div className="cover-grid">
            {places.map((pl) => (
              <CoverTile
                key={pl.label}
                title={pl.label}
                subtitle={fmtCount(pl.count)}
                coverPhotoId={pl.coverPhotoId}
                icon="places"
                onClick={() => nav('/place/' + encodeURIComponent(pl.label))}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function PersonView() {
  const { id = '' } = useParams();
  const peopleQ = usePeopleQ();
  const people = peopleQ.data || [];
  const person = people.find((x) => x.id === id) || null;
  const photosQ = usePersonPhotosQ(id);
  const list = photosQ.data || [];
  const actions = useActions();
  const modals = useModals();
  const nav = useNavigate();

  const extra: HeadAction[] = [
    {
      label: person && person.name ? 'Rename' : 'Add name',
      onClick: async () => {
        const name = await modals.prompt({
          title: person?.name ? 'Rename Person' : 'Name this person',
          placeholder: 'Name',
          value: person?.name || '',
          confirm: 'Save',
        });
        if (name === null) return;
        await actions.renamePerson(id, name);
      },
    },
    {
      label: 'Merge into…',
      onClick: () =>
        modals.openElement((close) => (
          <MergePickerCard
            people={people.filter((x) => x.id !== id)}
            close={close}
            onPick={async (target) => {
              close();
              const ok = await modals.confirm({
                title: 'Merge people?',
                body:
                  'All photos of ' +
                  (person?.name || 'this person') +
                  ' will move into ' +
                  (target.name || 'the selected person') +
                  '. This cannot be undone from the app.',
                confirm: 'Merge',
              });
              if (!ok) return;
              if (await actions.mergePeople(id, target.id)) {
                nav('/person/' + encodeURIComponent(target.id), { replace: true });
              }
            }}
          />
        )),
    },
    {
      label: 'Hide',
      danger: true,
      onClick: async () => {
        const ok = await modals.confirm({
          title: 'Hide ' + (person?.name || 'this person') + '?',
          body: 'They disappear from the People rail. Their photos stay in your library.',
          confirm: 'Hide',
          danger: true,
        });
        if (!ok) return;
        if (await actions.hidePerson(id)) nav('/people', { replace: true });
      },
    },
  ];

  return (
    <PhotoListView
      title={(person && person.name) || 'Person'}
      list={list}
      grouped={false}
      emptyKind="generic"
      back={{ label: 'People', to: '/people' }}
      extraActions={extra}
    />
  );
}

/** Pick the person a cluster should merge into. */
function MergePickerCard({
  people,
  close,
  onPick,
}: {
  people: Person[];
  close: () => void;
  onPick: (target: Person) => void;
}) {
  return (
    <div className="m-wrap">
      <div className="m-title">Merge into…</div>
      <p className="m-body">Pick who these photos actually belong to.</p>
      <div className="m-list">
        {people.length === 0 ? (
          <div className="m-note">No other people to merge into.</div>
        ) : (
          people.map((t) => (
            <button key={t.id} type="button" className="m-row" onClick={() => onPick(t)}>
              <span className="m-row-ico">
                <Svg html={ICON.people} />
              </span>
              <span className="m-row-name">{t.name || 'Unnamed'}</span>
              <span className="m-row-in">{fmtCount(t.count)}</span>
            </button>
          ))
        )}
      </div>
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PlaceView() {
  const { label = '' } = useParams();
  const photosQ = usePlacePhotosQ(label);
  const list = photosQ.data || [];
  return (
    <PhotoListView
      title={label}
      list={list}
      grouped={false}
      emptyKind="generic"
      back={{ label: 'Places', to: '/places' }}
    />
  );
}

// -------------------------------------------------------------------- albums

export function AlbumsView() {
  const q = useAlbumsQ();
  const albums = q.data || [];
  const nav = useNavigate();
  const actions = useActions();
  const modals = useModals();
  useRegisterList(useMemo(() => [], []));

  const create: HeadAction = {
    label: 'New Album',
    primary: true,
    icon: SVG_PLUS,
    onClick: async () => {
      const name = await modals.prompt({ title: 'New Album', placeholder: 'Album name', confirm: 'Create' });
      if (!name) return;
      const album = await actions.createAlbum(name);
      if (album) nav('/album/' + encodeURIComponent(album.id));
    },
  };

  return (
    <>
      <ViewHead
        title="Albums"
        subtitle={
          albums.length
            ? fmtCount(albums.length).replace('items', 'albums').replace('item', 'album')
            : ''
        }
        actions={[create]}
      />
      <div id="grid">
        {albums.length === 0 ? (
          <EmptyState kind="albums" />
        ) : (
          <div className="cover-grid">
            {albums.map((a) => (
              <CoverTile
                key={a.id}
                title={a.name}
                subtitle={fmtCount(a.photoCount)}
                coverPhotoId={a.coverPhotoId}
                icon="albums"
                onClick={() => nav('/album/' + encodeURIComponent(a.id))}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function AlbumView() {
  const { id = '' } = useParams();
  const albumsQ = useAlbumsQ();
  const lib = useLibraryQ();
  const nav = useNavigate();
  const actions = useActions();
  const modals = useModals();

  const album = (albumsQ.data || []).find((a) => a.id === id) || null;

  const list = useMemo(() => {
    if (!album || !lib.data) return [];
    const index = new Map(lib.data.map((p) => [p.id, p]));
    return (album.photoIds || []).map((pid) => index.get(pid)).filter(Boolean) as PhotoRecord[];
  }, [album, lib.data]);

  // Album vanished (deleted elsewhere) → back to Albums.
  useEffect(() => {
    if (albumsQ.data && !album) nav('/albums', { replace: true });
  }, [albumsQ.data, album, nav]);

  if (!album) return <div id="grid" />;

  const extra: HeadAction[] = [
    {
      label: 'Share',
      primary: true,
      onClick: () => modals.openElement((c) => <ShareCard albumId={album.id} close={c} />),
    },
    {
      label: 'Rename',
      onClick: async () => {
        const name = await modals.prompt({
          title: 'Rename Album',
          placeholder: 'Album name',
          value: album.name,
          confirm: 'Save',
        });
        if (!name || name === album.name) return;
        await actions.patchAlbum(album.id, { name }, 'Could not rename album');
      },
    },
    {
      label: 'Delete',
      danger: true,
      onClick: async () => {
        const ok = await modals.confirm({
          title: 'Delete “' + album.name + '”?',
          body: 'The album is removed. Your photos are not deleted.',
          confirm: 'Delete',
          danger: true,
        });
        if (!ok) return;
        if (await actions.deleteAlbum(album.id)) nav('/albums');
      },
    },
  ];

  return (
    <PhotoListView
      title={album.name}
      list={list}
      grouped={false}
      emptyKind="album"
      back={{ label: 'Albums', to: '/albums' }}
      extraActions={extra}
      barContext={{ kind: 'album', albumId: album.id }}
    />
  );
}

// -------------------------------------------------------------------- search

export function SearchResults() {
  const { searchQuery, searchResults, searching } = useView();
  const list = searchResults || [];
  useRegisterList(list);
  const selectAction = useSelectAction(list.length > 0);

  return (
    <>
      <ViewHead
        title="Search"
        subtitle={list.length ? list.length + ' result' + (list.length === 1 ? '' : 's') : ''}
        actions={selectAction}
      />
      <div id="grid">
        {list.length === 0 ? (
          <div className="search-empty">
            {searching ? 'Searching…' : 'No results for “' + searchQuery + '”'}
          </div>
        ) : (
          <PhotoGrid list={list} grouped={false} />
        )}
      </div>
      <SelectionBar list={list} context={{ kind: 'normal' }} />
    </>
  );
}
