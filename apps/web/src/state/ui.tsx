/**
 * Lightweight UI state: toast + promise-based modals (prompt / confirm /
 * album picker / arbitrary element), matching the vanilla dashboard's UX.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Album } from '@nook/core';

// --------------------------------------------------------------------- toast

interface ToastState {
  toast: (msg: string) => void;
}
const ToastContext = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string) => {
    setMsg(m);
    setShown(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 2200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={'toast' + (shown ? ' show' : ' hidden')} role="status">
        {msg}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (msg: string) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx.toast;
}

// -------------------------------------------------------------------- modals

export interface PromptOpts {
  title: string;
  placeholder?: string;
  value?: string;
  confirm?: string;
  password?: boolean;
}
export interface ConfirmOpts {
  title: string;
  body?: string;
  confirm?: string;
  danger?: boolean;
}
export type AlbumPick = { albumId?: string; createName?: string } | null;

interface ModalsState {
  prompt: (opts: PromptOpts) => Promise<string | null>;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  albumPicker: (albums: Album[], photoId: string | null) => Promise<AlbumPick>;
  /** Show an arbitrary modal element; `close` dismisses it. */
  openElement: (render: (close: () => void) => ReactNode) => void;
  closeAll: () => void;
  isOpen: boolean;
}

const ModalsContext = createContext<ModalsState | null>(null);

type ActiveModal =
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | {
      kind: 'albums';
      albums: Album[];
      photoId: string | null;
      resolve: (v: AlbumPick) => void;
    }
  | { kind: 'element'; node: ReactNode };

export function ModalProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveModal | null>(null);

  // Resolve THIS modal's promise (captured per-card), then clear whatever is
  // currently shown. Never resolve "the current modal" — a nested prompt (album
  // picker → New Album…) replaces the state entry while the outer promise is
  // still pending, and it must still resolve when the flow finishes.
  const clear = useCallback(() => setActive(null), []);
  const dismiss = useCallback(
    (value?: unknown) => {
      setActive((cur) => {
        if (cur && 'resolve' in cur) (cur.resolve as (v: unknown) => void)(value ?? null);
        return null;
      });
    },
    [],
  );

  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => setActive({ kind: 'prompt', opts, resolve })),
    [],
  );
  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) =>
        setActive({ kind: 'confirm', opts, resolve: (v) => resolve(!!v) }),
      ),
    [],
  );
  const albumPicker = useCallback(
    (albums: Album[], photoId: string | null) =>
      new Promise<AlbumPick>((resolve) => setActive({ kind: 'albums', albums, photoId, resolve })),
    [],
  );
  const openElement = useCallback(
    (render: (close: () => void) => ReactNode) => {
      const close = () => setActive(null);
      setActive({ kind: 'element', node: render(close) });
    },
    [],
  );
  const closeAll = useCallback(() => dismiss(null), [dismiss]);

  // Escape dismisses the current modal (resolving its promise as cancelled).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(active.kind === 'confirm' ? false : null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, dismiss]);

  const value = useMemo<ModalsState>(
    () => ({ prompt, confirm, albumPicker, openElement, closeAll, isOpen: active !== null }),
    [prompt, confirm, albumPicker, openElement, closeAll, active],
  );

  return (
    <ModalsContext.Provider value={value}>
      {children}
      <ModalHost active={active} clear={clear} promptFn={prompt} />
    </ModalsContext.Provider>
  );
}

export function useModals(): ModalsState {
  const ctx = useContext(ModalsContext);
  if (!ctx) throw new Error('useModals outside ModalProvider');
  return ctx;
}

// ----------------------------------------------------------- modal rendering

import { ICON, SVG_PLUS, Svg } from '../lib/icons';

function ModalHost({
  active,
  clear,
  promptFn,
}: {
  active: ActiveModal | null;
  clear: () => void;
  promptFn: (opts: PromptOpts) => Promise<string | null>;
}) {
  if (!active) return <div className="modal-root hidden" />;
  // Per-card `done`: resolve the promise captured for THIS modal, then clear.
  const finish = (v: unknown) => {
    if ('resolve' in active) (active.resolve as (x: unknown) => void)(v);
    clear();
  };
  return (
    <div className="modal-root" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={() => finish(active.kind === 'confirm' ? false : null)} />
      <div className="modal-card">
        {active.kind === 'prompt' && <PromptCard opts={active.opts} done={(v) => finish(v)} />}
        {active.kind === 'confirm' && <ConfirmCard opts={active.opts} done={(v) => finish(v)} />}
        {active.kind === 'albums' && (
          <AlbumPickerCard
            albums={active.albums}
            photoId={active.photoId}
            promptFn={promptFn}
            done={(v) => finish(v)}
          />
        )}
        {active.kind === 'element' && active.node}
      </div>
    </div>
  );
}

function PromptCard({ opts, done }: { opts: PromptOpts; done: (v: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submit = () => done((inputRef.current?.value ?? '').trim());
  return (
    <div className="m-wrap">
      <div className="m-title">{opts.title}</div>
      <input
        ref={(n) => {
          inputRef.current = n;
          if (n) setTimeout(() => n.select(), 40);
        }}
        className="m-input"
        type={opts.password ? 'password' : 'text'}
        autoCapitalize={opts.password ? 'none' : undefined}
        placeholder={opts.placeholder || ''}
        defaultValue={opts.value || ''}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={() => done(null)}>
          Cancel
        </button>
        <button type="button" className="m-btn primary" onClick={submit}>
          {opts.confirm || 'OK'}
        </button>
      </div>
    </div>
  );
}

function ConfirmCard({ opts, done }: { opts: ConfirmOpts; done: (v: boolean) => void }) {
  return (
    <div className="m-wrap">
      <div className="m-title">{opts.title}</div>
      {opts.body ? <p className="m-body">{opts.body}</p> : null}
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={() => done(false)}>
          Cancel
        </button>
        <button
          type="button"
          className={'m-btn primary' + (opts.danger ? ' danger' : '')}
          onClick={() => done(true)}
        >
          {opts.confirm || 'OK'}
        </button>
      </div>
    </div>
  );
}

function AlbumPickerCard({
  albums,
  photoId,
  promptFn,
  done,
}: {
  albums: Album[];
  photoId: string | null;
  promptFn: (opts: PromptOpts) => Promise<string | null>;
  done: (v: AlbumPick) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="m-wrap">
      <div className="m-title">Add to Album</div>
      <div className="m-list">
        <button
          type="button"
          className="m-row m-row-new"
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            const name = await promptFn({
              title: 'New Album',
              placeholder: 'Album name',
              confirm: 'Create',
            });
            done(name ? { createName: name } : null);
          }}
        >
          <span className="m-row-ico">
            <Svg html={SVG_PLUS} />
          </span>
          <span>New Album…</span>
        </button>
        {albums.map((a) => {
          const has = photoId != null && (a.photoIds || []).indexOf(photoId) !== -1;
          return (
            <button
              key={a.id}
              type="button"
              className="m-row"
              disabled={has}
              onClick={() => (has ? undefined : done({ albumId: a.id }))}
            >
              <span className="m-row-ico">
                <Svg html={ICON.albums} />
              </span>
              <span className="m-row-name">{a.name}</span>
              {has ? <span className="m-row-in">Added</span> : null}
            </button>
          );
        })}
      </div>
      <div className="m-buttons">
        <button type="button" className="m-btn" onClick={() => done(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
