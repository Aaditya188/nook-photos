/**
 * Upload UX: a full-window drag-and-drop overlay, an imperative picker (files
 * or a folder), and a floating progress panel. Ingests loose photos/videos,
 * dropped folders, and Google Takeout .zip archives. On completion it
 * invalidates the library so new photos appear.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../state/auth';
import { useToast } from '../state/ui';
import { collectItems, runUpload, type UploadProgress } from '../lib/upload';
import { Svg } from '../lib/icons';

const SVG_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15v3A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

interface UploadCtx {
  pickFiles: () => void;
  pickFolder: () => void;
}
const Ctx = createContext<UploadCtx | null>(null);
export const useUpload = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUpload outside UploadProvider');
  return c;
};

export function UploadProvider({ children }: { children: ReactNode }) {
  const { client, token } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);

  const start = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const items = await collectItems(files);
      if (!items.length) {
        toast('No photos or videos found');
        return;
      }
      setProgress({ total: items.length, done: 0, ok: 0, failed: 0, current: '' });
      const result = await runUpload(client, items, setProgress);
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['status'] });
      toast(
        result.failed
          ? `Uploaded ${result.ok}, ${result.failed} failed`
          : `Uploaded ${result.ok} ${result.ok === 1 ? 'item' : 'items'}`,
      );
      setTimeout(() => setProgress(null), 2500);
    },
    [client, qc, toast],
  );

  // Window-level drag & drop (only while signed in).
  useEffect(() => {
    if (!token) return;
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onLeave = () => {
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length) void start(files);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [token, start]);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length) void start(files);
  };

  const value: UploadCtx = {
    pickFiles: () => fileInput.current?.click(),
    pickFolder: () => folderInput.current?.click(),
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Ctx.Provider value={value}>
      {children}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*,.zip"
        style={{ display: 'none' }}
        onChange={onInput}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        directory=""
        style={{ display: 'none' }}
        onChange={onInput}
      />

      {dragging ? (
        <div className="up-overlay">
          <div className="up-overlay-card">
            <Svg className="up-overlay-ico" html={SVG_UPLOAD} />
            <div className="up-overlay-title">Drop to upload</div>
            <div className="up-overlay-sub">Photos, videos, folders, or a Google Takeout .zip</div>
          </div>
        </div>
      ) : null}

      {progress ? (
        <div className="up-panel" role="status">
          <div className="up-panel-top">
            <span className="up-panel-title">
              {progress.done < progress.total ? 'Uploading…' : 'Upload complete'}
            </span>
            <span className="up-panel-count">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="up-bar">
            <div className="up-bar-fill" style={{ width: pct + '%' }} />
          </div>
          <div className="up-panel-sub">
            {progress.done < progress.total ? progress.current : `${progress.ok} added${progress.failed ? ` · ${progress.failed} failed` : ''}`}
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
