/**
 * Holds the ordered photo list the full-screen viewer swipes through. The opening
 * screen (library, album, person, place, search) sets the list before navigating
 * so the viewer can page through the right context.
 */
import { create } from 'zustand';
import type { PhotoRecord } from '@nook/core';

interface ViewerState {
  photos: PhotoRecord[];
  setList: (photos: PhotoRecord[]) => void;
}

export const useViewer = create<ViewerState>((set) => ({
  photos: [],
  setList: (photos) => set({ photos }),
}));
