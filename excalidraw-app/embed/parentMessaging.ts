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
 *   parent -> { type: "excalidraw:flush",                 post any pending save
 *               requestId? }                               immediately
 *   parent <- { type: "excalidraw:flushed",               ack, ordered behind
 *               requestId? }                               the save it covers
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
  FLUSH: "excalidraw:flush",
  FLUSHED: "excalidraw:flushed",
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

/** URL param by which an embedding parent names its own origin. */
export const PARENT_ORIGIN_PARAM = "parentOrigin";

/**
 * The embedding parent's origin, named by `?parentOrigin=`; null unless it
 * parses to an origin on the allowlist.
 *
 * The parent states its origin rather than us inferring it from
 * `document.referrer`, which a `Referrer-Policy` on the parent document (or a
 * `referrerpolicy` on the iframe) blanks out. Inferring it meant a policy
 * change on the embedder's side silently turned the protocol off and dropped
 * the frame back to browser-local behaviour, with nothing logged or thrown.
 * The param is untrusted input and earns nothing by being present: it only
 * selects which allowlisted origin we will talk to.
 */
export const getParentOrigin = (): string | null => {
  const param = new URLSearchParams(window.location.search).get(
    PARENT_ORIGIN_PARAM,
  );
  if (!param) {
    return null;
  }
  let origin: string;
  try {
    origin = new URL(param).origin;
  } catch {
    return null;
  }
  return isAllowedParentOrigin(origin) ? origin : null;
};

export const isEmbedded = (): boolean =>
  window.parent !== window && getParentOrigin() !== null;

/**
 * True when an allowlisted parent embeds us to own the scene over
 * postMessage. `?parentOrigin=` is the activation signal and is independent of
 * the UI mode. An embedded `#room=`/`#json=`/`#url=`/`?id=` link is still a
 * collab/shared scene and keeps its normal initialization, including
 * `FLUSH_SAVE`.
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
  /**
   * Posts `ready`, applying first any load that arrived before the editor
   * finished initializing. The message listener itself is registered at
   * construction. Calling this more than once does nothing.
   */
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
  type PendingLoad = { scene: string; gen: number | undefined };

  let loaded = false;
  let started = false;
  let destroyed = false;
  let lastScene: string | null = null;
  // A load that arrives before `start()` is held rather than dropped. The
  // parent may post its scene as soon as the frame loads rather than waiting
  // for `ready`, and it has no reason to send it a second time.
  let pendingLoad: PendingLoad | null = null;
  // Generation id of the load the current scene descends from; echoed on
  // every save so the parent can drop a save that crossed a newer load.
  let gen: number | undefined;

  const post = (message: {
    type: string;
    scene?: string;
    gen?: number;
    message?: string;
    requestId?: unknown;
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

  const applyLoad = ({ scene, gen: nextGen }: PendingLoad) => {
    const live = api.getAppState();

    // Parse and restore before touching any bridge state, so a payload that
    // throws leaves the scene, the generation it descends from, and any armed
    // save exactly as they were.
    let restored: ReturnType<typeof restore>;
    try {
      // Restore against the live appState. Only `gridSize` and
      // `viewBackgroundColor` survive an export round-trip, so every other key
      // is absent from the parent's document; with no local state to fall back
      // on, `restore` fills defaults and the load would reset the camera,
      // re-enable frame rendering, and force the light theme.
      restored = restore(parseEmbeddedScene(scene), live, null, {
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
    // `restoreAppState` special-cases zoom and falls back to the default
    // rather than to the local state, so carry the live value across by hand.
    // A scene document can never supply one: zoom is not an exported key.
    const nextAppState = { ...restored.appState, zoom: live.zoom };
    api.updateScene({
      elements: restored.elements,
      appState: nextAppState,
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
      nextAppState,
      restored.files,
      "local",
    );
    loaded = true;
  };

  const handleMessage = (event: MessageEvent) => {
    if (
      destroyed ||
      // origin equality alone does not identify a sender: any window on an
      // allowlisted origin can reach this frame
      event.source !== parentWindow ||
      event.origin !== parentOrigin
    ) {
      return;
    }

    if (event.data?.type === EMBED_MESSAGE_TYPES.FLUSH) {
      // Post whatever is pending, then acknowledge. Messages from one source
      // are delivered in order, so the ack cannot overtake the save it covers
      // and the parent need only wait for the ack before tearing us down.
      save.flush();
      post({
        type: EMBED_MESSAGE_TYPES.FLUSHED,
        requestId: event.data.requestId,
      });
      return;
    }

    if (
      event.data?.type !== EMBED_MESSAGE_TYPES.LOAD ||
      typeof event.data.scene !== "string"
    ) {
      return;
    }
    const load: PendingLoad = {
      scene: event.data.scene,
      gen: typeof event.data.gen === "number" ? event.data.gen : undefined,
    };
    if (!started) {
      pendingLoad = load;
      return;
    }
    applyLoad(load);
  };

  window.addEventListener("message", handleMessage);

  return {
    start: () => {
      if (started || destroyed) {
        return;
      }
      started = true;
      if (pendingLoad) {
        const load = pendingLoad;
        pendingLoad = null;
        applyLoad(load);
      }
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
      // A parent that tears the frame down without the flush handshake still
      // gets whatever was pending, on the occasions this cleanup runs at all.
      // It is a backstop, not the mechanism: React cleanup does not reliably
      // run when the frame is removed from the parent's DOM.
      save.flush();
      destroyed = true;
      window.removeEventListener("message", handleMessage);
    },
    isLoaded: () => loaded,
  };
};
