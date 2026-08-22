import { serializeAsJSON } from "../../packages/excalidraw/data/json";
import { restore } from "../../packages/excalidraw/data/restore";
import type { ImportedDataState } from "../../packages/excalidraw/data/types";
import type { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "../../packages/excalidraw/types";
import { debounce } from "../../packages/excalidraw/utils";

/**
 * postMessage protocol between this app (running in an iframe) and the
 * embedding parent window that owns the scene.
 *
 *   parent <- { type: "excalidraw:ready" }                 once, after init
 *   parent -> { type: "excalidraw:load", scene: string,   JSON scene doc, bare
 *               gen?: number }                             element array, or ""
 *                                                          for an empty board
 *   parent <- { type: "excalidraw:save", scene: string,   serializeAsJSON(),
 *               gen?: number }                             debounced; `gen`
 *                                                          echoes the load it
 *                                                          descends from
 *   parent <- { type: "excalidraw:error",                 a load did not land;
 *               gen?: number, message: string }            the scene and the
 *                                                          generation it
 *                                                          descends from are
 *                                                          unchanged
 *
 * Invariant: a `save` is never posted before a `load` succeeded. The parent
 * persists whatever it receives, so echoing a blank/local scene would wipe
 * the author's stored scene.
 */
export const EMBED_MESSAGE_TYPES = {
  READY: "excalidraw:ready",
  LOAD: "excalidraw:load",
  SAVE: "excalidraw:save",
  ERROR: "excalidraw:error",
} as const;

export const EMBED_SAVE_DEBOUNCE_MS = 500;

// Origin allowlist (shared with Collab FLUSH_SAVE and the token service)
// ---------------------------------------------------------------------------

export const getAllowedParentOrigins = (): string[] =>
  (import.meta.env.VITE_APP_TOKEN_SERVICE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin: string) => origin.trim())
    .filter(Boolean);

export const isAllowedParentOrigin = (origin: string): boolean =>
  getAllowedParentOrigins().includes(origin);

/** The embedding parent's origin, derived from the referrer; null unless allowlisted. */
export const getParentOrigin = (): string | null => {
  if (!document.referrer) {
    return null;
  }
  let origin: string;
  try {
    origin = new URL(document.referrer).origin;
  } catch {
    return null;
  }
  return isAllowedParentOrigin(origin) ? origin : null;
};

export const isEmbedded = (): boolean =>
  window.parent !== window && getParentOrigin() !== null;

/**
 * True when an allowlisted parent embeds us to own the scene over
 * postMessage (`?mode=full`, no hash). An embedded `#room=`/`#json=`/
 * `#url=`/`?id=` link is still a collab/shared scene and keeps its normal
 * initialization, including `FLUSH_SAVE`.
 */
export const isParentOwnedScene = (): boolean =>
  isEmbedded() &&
  !window.location.hash.slice(1) &&
  !new URLSearchParams(window.location.search).get("id");

// Scene parsing
// ---------------------------------------------------------------------------

type LoadableScene = Pick<ImportedDataState, "elements" | "appState" | "files">;

/** Accepts a full scene doc (serializeAsJSON output) or a bare element array. Throws on anything else. */
export const parseEmbeddedScene = (scene: string): LoadableScene => {
  if (!scene.trim()) {
    return { elements: [] };
  }
  const parsed: unknown = JSON.parse(scene);
  if (Array.isArray(parsed)) {
    return { elements: parsed as ExcalidrawElement[] };
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { elements?: unknown }).elements)
  ) {
    const { elements, appState, files } = parsed as LoadableScene;
    return { elements, appState, files };
  }
  throw new Error("Scene must be a scene document or an element array");
};

// Bridge
// ---------------------------------------------------------------------------

export type EmbedBridge = {
  /** Registers the message listener and posts `ready`. */
  start: () => void;
  /** Wire into Excalidraw's `onChange`; no-op until a load succeeded. */
  onChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void;
  /** Posts any pending save immediately. */
  flush: () => void;
  destroy: () => void;
  isLoaded: () => boolean;
};

export const createEmbedBridge = ({
  api,
  parentOrigin,
  parentWindow,
  debounceMs = EMBED_SAVE_DEBOUNCE_MS,
}: {
  api: ExcalidrawImperativeAPI;
  parentOrigin: string;
  parentWindow: Window;
  debounceMs?: number;
}): EmbedBridge => {
  let loaded = false;
  let destroyed = false;
  let lastScene: string | null = null;
  // Generation id of the load the current scene descends from; echoed on
  // every save so the parent can drop a save that crossed a newer load.
  let gen: number | undefined;

  const post = (message: {
    type: string;
    scene?: string;
    gen?: number;
    message?: string;
  }) => {
    parentWindow.postMessage(message, parentOrigin);
  };

  const save = debounce(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      if (destroyed || !loaded) {
        return;
      }
      const scene = serializeAsJSON(elements, appState, files, "local");
      if (scene === lastScene) {
        return;
      }
      lastScene = scene;
      post({ type: EMBED_MESSAGE_TYPES.SAVE, scene, gen });
    },
    debounceMs,
  );

  const handleMessage = (event: MessageEvent) => {
    if (
      destroyed ||
      event.origin !== parentOrigin ||
      event.data?.type !== EMBED_MESSAGE_TYPES.LOAD ||
      typeof event.data.scene !== "string"
    ) {
      return;
    }
    const nextGen =
      typeof event.data.gen === "number" ? event.data.gen : undefined;

    // Parse and restore before touching any bridge state, so a payload that
    // throws leaves the scene, the generation it descends from, and any armed
    // save exactly as they were.
    let restored: ReturnType<typeof restore>;
    try {
      restored = restore(parseEmbeddedScene(event.data.scene), null, null, {
        repairBindings: true,
      });
    } catch (error: any) {
      const message = error?.message || "invalid scene";
      console.error("[draw][embed] failed to load scene from parent", error);
      // The parent has to hear that this load did not land. Otherwise it
      // believes `nextGen` is installed and silently discards every save the
      // editor goes on to send under the older generation.
      post({ type: EMBED_MESSAGE_TYPES.ERROR, gen: nextGen, message });
      api.setToast({
        message: `Could not load the whiteboard scene: ${message}`,
        closable: true,
        duration: Infinity,
      });
      return;
    }

    // The load supersedes anything the author drew before it arrived: drop a
    // pending debounced save so it cannot fire afterwards and hand the parent
    // the pre-load scene on top of the one it just sent.
    save.cancel();
    gen = nextGen;
    api.updateScene({
      elements: restored.elements,
      appState: restored.appState,
      commitToHistory: true,
    });
    const files = Object.values(restored.files);
    if (files.length) {
      api.addFiles(files);
    }
    // Remember the loaded scene in the same form a save would take so the
    // onChange Excalidraw fires for this very update is not echoed back.
    lastScene = serializeAsJSON(
      restored.elements,
      restored.appState,
      restored.files,
      "local",
    );
    loaded = true;
  };

  return {
    start: () => {
      window.addEventListener("message", handleMessage);
      post({ type: EMBED_MESSAGE_TYPES.READY });
    },
    onChange: (elements, appState, files) => {
      if (!loaded) {
        return;
      }
      save(elements, appState, files);
    },
    flush: () => save.flush(),
    destroy: () => {
      destroyed = true;
      save.cancel();
      window.removeEventListener("message", handleMessage);
    },
    isLoaded: () => loaded,
  };
};
