import { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import { AppState } from "../../packages/excalidraw/types";
import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "../../packages/excalidraw/appState";
import { clearElementsForLocalStorage } from "../../packages/excalidraw/element";
import { STORAGE_KEYS } from "../app_constants";
import { ImportedDataState } from "../../packages/excalidraw/data/types";

export const importFromLocalStorage = () => {
  let savedElements = null;
  let savedState = null;

  try {
    savedElements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    savedState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
  } catch (error: any) {
    // Unable to access localStorage
    console.error(error);
  }

  let elements: ExcalidrawElement[] = [];
  if (savedElements) {
    try {
      elements = clearElementsForLocalStorage(JSON.parse(savedElements));
    } catch (error: any) {
      console.error(error);
      // Do nothing because elements array is already empty
    }
  }

  let appState = null;
  if (savedState) {
    try {
      appState = {
        ...getDefaultAppState(),
        ...clearAppStateForLocalStorage(
          JSON.parse(savedState) as Partial<AppState>,
        ),
      };
    } catch (error: any) {
      console.error(error);
      // Do nothing because appState is already null
    }
  }

  console.info("[draw] Loaded from local storage", elements, appState);
  return { elements, appState };
};

export const getElementsStorageSize = () => {
  try {
    const elements = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
    const elementsSize = elements?.length || 0;
    return elementsSize;
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};

export const getTotalStorageSize = () => {
  try {
    const appState = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
    const collab = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_COLLAB);
    const library = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY);

    const appStateSize = appState?.length || 0;
    const collabSize = collab?.length || 0;
    const librarySize = library?.length || 0;

    return appStateSize + collabSize + librarySize + getElementsStorageSize();
  } catch (error: any) {
    console.error(error);
    return 0;
  }
};

export const getLibraryItemsFromStorage = () => {
  try {
    const libraryItems: ImportedDataState["libraryItems"] = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_LIBRARY) as string,
    );

    return libraryItems || [];
  } catch (error) {
    console.error(error);
    return [];
  }
};
