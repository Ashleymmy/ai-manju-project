import { createContext, useContext } from "react";

export type CanvasUpscaleAvailability = {
  image: boolean;
  video: boolean;
};

// Defaults to unavailable so the entries stay disabled until the catalog says an admin configured a model.
export const CanvasUpscaleAvailabilityContext =
  createContext<CanvasUpscaleAvailability>({ image: false, video: false });

export function useCanvasUpscaleAvailability() {
  return useContext(CanvasUpscaleAvailabilityContext);
}
