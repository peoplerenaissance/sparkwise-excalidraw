import { ExcalidrawTextContainer } from "./types";

export const originalContainerCache: {
  [id: ExcalidrawTextContainer["id"]]:
    | {
        height: ExcalidrawTextContainer["height"];
      }
    | undefined;
} = {};

export const updateOriginalContainerCache = (
  id: ExcalidrawTextContainer["id"],
  height: ExcalidrawTextContainer["height"],
) => {
  if (typeof id !== "string" || id === "__proto__") {
    throw new Error("Invalid cache key");
  }

  const data =
    originalContainerCache[id] || (originalContainerCache[id] = { height });
  data.height = height;
  return data;
};

export const resetOriginalContainerCache = (
  id: ExcalidrawTextContainer["id"],
) => {
  if (originalContainerCache[id]) {
    delete originalContainerCache[id];
  }
};

export const getOriginalContainerHeightFromCache = (
  id: ExcalidrawTextContainer["id"],
) => {
  return originalContainerCache[id]?.height ?? null;
};
