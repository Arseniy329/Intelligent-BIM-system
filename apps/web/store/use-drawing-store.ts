import { create } from "zustand";

type DrawingState = {
  selectedRoomId: string | null;
  activeLayer: string | null;
  highlightedDeviceId: string | null;
  highlightedFindingId: string | null;
  selectRoom: (roomId: string | null) => void;
  setActiveLayer: (layer: string | null) => void;
  highlightDevice: (deviceId: string | null) => void;
  highlightFinding: (findingId: string | null) => void;
  reset: () => void;
};

const initialState = {
  selectedRoomId: null,
  activeLayer: null,
  highlightedDeviceId: null,
  highlightedFindingId: null,
};

export const useDrawingStore = create<DrawingState>((set) => ({
  ...initialState,
  selectRoom: (selectedRoomId) => set({ selectedRoomId }),
  setActiveLayer: (activeLayer) => set({ activeLayer }),
  highlightDevice: (highlightedDeviceId) => set({ highlightedDeviceId }),
  highlightFinding: (highlightedFindingId) => set({ highlightedFindingId }),
  reset: () => set(initialState),
}));
