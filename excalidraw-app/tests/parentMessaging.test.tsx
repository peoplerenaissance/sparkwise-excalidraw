import { vi } from "vitest";
import { render, waitFor } from "../../packages/excalidraw/tests/test-utils";
import { API } from "../../packages/excalidraw/tests/helpers/api";
import { Keyboard } from "../../packages/excalidraw/tests/helpers/ui";
import { KEYS } from "../../packages/excalidraw/keys";
import { restore } from "../../packages/excalidraw/data/restore";
import { getDefaultAppState } from "../../packages/excalidraw/appState";
import type { AppState } from "../../packages/excalidraw/types";
import type { ExcalidrawImperativeAPI } from "../../packages/excalidraw/types";
import type { BinaryFileData } from "../../packages/excalidraw/types";
import {
  createEmbedBridge,
  EMBED_MESSAGE_TYPES,
  getAllowedParentOrigins,
  getParentOrigin,
  isAllowedParentOrigin,
  isEmbedded,
  isParentOwnedScene,
  PARENT_ORIGIN_PARAM,
} from "../embed/parentMessaging";
import { STORAGE_KEYS } from "../app_constants";
import ExcalidrawApp from "../App";
import { LocalData } from "../data/LocalData";

const { h } = window;

const PARENT_ORIGIN = "https://parent.test";
const OTHER_ORIGIN = "https://evil.test";

Object.defineProperty(window, "crypto", {
  value: {
    getRandomValues: (arr: number[]) =>
      arr.forEach((v, i) => (arr[i] = Math.floor(Math.random() * 256))),
    subtle: {
      generateKey: () => {},
      exportKey: () => ({ k: "sTdLvMC_M3V8_vGa3UVRDg" }),
    },
  },
});

vi.mock("../../excalidraw-app/data/firebase.ts", () => {
  return {
    loadFromFirebase: async () => null,
    saveToFirebase: () => {},
    isSavedToFirebase: () => true,
    loadFilesFromFirebase: async () => ({ loadedFiles: [], erroredFiles: [] }),
    saveFilesToFirebase: async () => ({
      savedFiles: new Map(),
      erroredFiles: new Map(),
    }),
  };
});

vi.mock("socket.io-client", () => {
  return {
    default: () => ({
      close: () => {},
      on: () => {},
      once: () => {},
      off: () => {},
      emit: () => {},
    }),
  };
});

const setSearch = (search: string) => {
  window.history.replaceState({}, "", search);
};

const embedUrl = (origin: string, extra = "") =>
  `/?${PARENT_ORIGIN_PARAM}=${encodeURIComponent(origin)}${extra}`;

const setParentOriginParam = (origin: string) => {
  setSearch(embedUrl(origin));
};

const setParentWindow = (parent: Window) => {
  Object.defineProperty(window, "parent", {
    value: parent,
    configurable: true,
  });
};

const realParent = window.parent;

const makeFile = (id: string): BinaryFileData => ({
  id: id as BinaryFileData["id"],
  mimeType: "image/png",
  dataURL: "data:image/png;base64,AAAA" as BinaryFileData["dataURL"],
  created: 1,
});

const sceneDoc = (extra: Partial<Record<string, unknown>> = {}) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://parent.test",
    elements: [
      API.createElement({ type: "rectangle", id: "A" }),
      API.createElement({ type: "ellipse", id: "B" }),
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: { f1: makeFile("f1") },
    ...extra,
  });

const dispatchMessage = (
  origin: string,
  data: unknown,
  source: unknown = window.parent,
) => {
  const event = new MessageEvent("message", { origin, data });
  // MessageEventInit only accepts a real window, so stamp the sender on after
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
};

beforeEach(() => {
  vi.stubEnv("VITE_APP_TOKEN_SERVICE_ALLOWED_ORIGINS", PARENT_ORIGIN);
  setSearch("/");
  window.location.hash = "";
  setParentWindow(realParent);
  localStorage.clear();
});

// activation now lives in the URL, so a test that fails partway through must
// still hand the next one a clean location and parent window
afterEach(() => {
  setSearch("/");
  window.location.hash = "";
  setParentWindow(realParent);
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parent origin allowlist", () => {
  it("parses the comma-separated env allowlist", () => {
    vi.stubEnv(
      "VITE_APP_TOKEN_SERVICE_ALLOWED_ORIGINS",
      ` ${PARENT_ORIGIN} , https://b.test,`,
    );
    expect(getAllowedParentOrigins()).toEqual([
      PARENT_ORIGIN,
      "https://b.test",
    ]);
    expect(isAllowedParentOrigin(PARENT_ORIGIN)).toBe(true);
    expect(isAllowedParentOrigin(OTHER_ORIGIN)).toBe(false);
  });

  it("takes the parent origin from the URL param only when allowlisted", () => {
    setParentOriginParam(PARENT_ORIGIN);
    expect(getParentOrigin()).toBe(PARENT_ORIGIN);
    setParentOriginParam(OTHER_ORIGIN);
    expect(getParentOrigin()).toBeNull();
    setSearch(`/?${PARENT_ORIGIN_PARAM}=not%20a%20url`);
    expect(getParentOrigin()).toBeNull();
    setSearch("/");
    expect(getParentOrigin()).toBeNull();
  });

  it("does not fall back to the referrer when the param is absent", () => {
    // a Referrer-Policy on the embedder blanks `document.referrer` out, so
    // inferring the origin from it turned the protocol off silently
    Object.defineProperty(document, "referrer", {
      value: `${PARENT_ORIGIN}/resources/123`,
      configurable: true,
    });
    setParentWindow({} as Window);
    setSearch("/");
    expect(getParentOrigin()).toBeNull();
    expect(isEmbedded()).toBe(false);
    expect(isParentOwnedScene()).toBe(false);
  });

  it("is embedded only when framed by an allowlisted parent", () => {
    setParentOriginParam(PARENT_ORIGIN);
    expect(isEmbedded()).toBe(false); // window.parent === window
    setParentWindow({} as Window);
    expect(isEmbedded()).toBe(true);
    setParentOriginParam(OTHER_ORIGIN);
    expect(isEmbedded()).toBe(false);
  });

  it("a collab/shared link is not a parent-owned scene even when embedded", () => {
    setParentOriginParam(PARENT_ORIGIN);
    setParentWindow({} as Window);
    expect(isParentOwnedScene()).toBe(true);
    window.location.hash = "#room=abc,def";
    expect(isEmbedded()).toBe(true);
    expect(isParentOwnedScene()).toBe(false);
    window.location.hash = "";
    setSearch(embedUrl(PARENT_ORIGIN, "&id=xyz"));
    expect(isParentOwnedScene()).toBe(false);
  });

  it("activation is independent of the UI mode", () => {
    setParentWindow({} as Window);
    for (const mode of ["none", "minimal", "full", "all"]) {
      setSearch(embedUrl(PARENT_ORIGIN, `&mode=${mode}`));
      expect(isParentOwnedScene()).toBe(true);
    }
    // ...and no mode turns it on without the param
    setSearch("/?mode=full");
    expect(isParentOwnedScene()).toBe(false);
  });
});

describe("embed bridge", () => {
  type FakeAPI = Pick<
    ExcalidrawImperativeAPI,
    "updateScene" | "addFiles" | "setToast" | "getAppState" | "history"
  >;

  const liveAppState = () =>
    ({
      ...getDefaultAppState(),
      // a camera the author panned to, and the learner-mode frame settings the
      // library installs at init — neither survives an export round-trip
      scrollX: -1200,
      scrollY: -800,
      zoom: { value: 2 as AppState["zoom"]["value"] },
      theme: "dark",
      frameRendering: {
        enabled: false,
        clip: false,
        name: false,
        outline: false,
      },
    } as AppState);

  const setup = ({ start = true }: { start?: boolean } = {}) => {
    vi.useFakeTimers();
    const api = {
      updateScene: vi.fn(),
      addFiles: vi.fn(),
      setToast: vi.fn(),
      getAppState: vi.fn(liveAppState),
      history: { clear: vi.fn() },
    };
    const parent = { postMessage: vi.fn() };
    // the bridge only accepts messages whose sender is its parent window
    setParentWindow(parent as unknown as Window);
    const bridge = createEmbedBridge({
      api: api as unknown as FakeAPI as ExcalidrawImperativeAPI,
      parentOrigin: PARENT_ORIGIN,
      parentWindow: parent as unknown as Window,
    });
    if (start) {
      bridge.start();
      // the bridge defers applying loads to a macrotask, so that the library's
      // own init write cannot land on top of the parent's scene
      vi.advanceTimersByTime(0);
    }
    return { api, parent, bridge };
  };

  const change = (
    bridge: ReturnType<typeof createEmbedBridge>,
    ids: string[],
  ) => {
    const elements = ids.map((id) =>
      API.createElement({ type: "rectangle", id }),
    );
    bridge.onChange(elements, getDefaultAppState() as AppState, {});
    return elements;
  };

  const savesPosted = (parent: { postMessage: ReturnType<typeof vi.fn> }) =>
    parent.postMessage.mock.calls.filter(
      ([msg]) => msg.type === EMBED_MESSAGE_TYPES.SAVE,
    );

  it("posts ready exactly once to the parent origin on start", () => {
    const { parent, bridge } = setup();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: EMBED_MESSAGE_TYPES.READY },
      PARENT_ORIGIN,
    );
    bridge.destroy();
  });

  it("KTD2: a change before any load emits no save", () => {
    const { parent, bridge } = setup();
    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(0);
    bridge.destroy();
  });

  it("ignores a load from a non-allowlisted origin and stays unloaded", () => {
    const { api, parent, bridge } = setup();
    dispatchMessage(OTHER_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    expect(api.updateScene).not.toHaveBeenCalled();
    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(0);
    bridge.destroy();
  });

  it("loads a full scene doc with two elements and one file", () => {
    const { api, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    const arg = api.updateScene.mock.calls[0][0];
    expect(arg.elements.map((el: { id: string }) => el.id)).toEqual(["A", "B"]);
    expect(arg.appState.viewBackgroundColor).toBe("#ffffff");
    expect(arg.commitToHistory).toBe(true);
    expect(api.addFiles).toHaveBeenCalledWith([
      expect.objectContaining({ id: "f1" }),
    ]);
    expect(bridge.isLoaded()).toBe(true);
    bridge.destroy();
  });

  it("loads a bare element array without appState/files", () => {
    const { api, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: JSON.stringify([
        API.createElement({ type: "rectangle", id: "Z" }),
      ]),
    });
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.updateScene.mock.calls[0][0].elements).toEqual([
      expect.objectContaining({ id: "Z" }),
    ]);
    expect(api.addFiles).not.toHaveBeenCalled();
    expect(bridge.isLoaded()).toBe(true);
    bridge.destroy();
  });

  it("malformed JSON shows a toast, leaves the scene alone, and never saves", () => {
    const { api, parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: "{not json",
    });
    expect(api.setToast).toHaveBeenCalledTimes(1);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(bridge.isLoaded()).toBe(false);
    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(0);
    bridge.destroy();
  });

  it("a change after load emits one debounced save that round-trips", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    const elements = change(bridge, ["A", "C"]);
    expect(savesPosted(parent)).toHaveLength(0);
    vi.advanceTimersByTime(499);
    expect(savesPosted(parent)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const saves = savesPosted(parent);
    expect(saves).toHaveLength(1);
    expect(saves[0][1]).toBe(PARENT_ORIGIN);
    const parsed = JSON.parse(saves[0][0].scene);
    expect(parsed.type).toBe("excalidraw");
    const restored = restore(parsed, null, null, { repairBindings: true });
    expect(restored.elements.map((el) => el.id)).toEqual(
      elements.map((el) => el.id),
    );
    bridge.destroy();
  });

  it("two rapid changes collapse into one save carrying the latest state", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    change(bridge, ["A"]);
    vi.advanceTimersByTime(200);
    change(bridge, ["A", "D"]);
    vi.advanceTimersByTime(5000);
    const saves = savesPosted(parent);
    expect(saves).toHaveLength(1);
    expect(
      JSON.parse(saves[0][0].scene).elements.map((el: { id: string }) => el.id),
    ).toEqual(["A", "D"]);
    bridge.destroy();
  });

  it("does not re-send a scene identical to the last one sent", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    const elements = change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(1);
    bridge.onChange(elements, getDefaultAppState() as AppState, {});
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(1);
    bridge.destroy();
  });

  it("a second load replaces the scene and resets the marker", () => {
    const { api, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: JSON.stringify([
        API.createElement({ type: "rectangle", id: "Q" }),
      ]),
    });
    expect(api.updateScene).toHaveBeenCalledTimes(2);
    expect(api.updateScene.mock.calls[1][0].elements).toEqual([
      expect.objectContaining({ id: "Q" }),
    ]);
    expect(bridge.isLoaded()).toBe(true);
    bridge.destroy();
  });

  it("a load cancels a pending save so a stale scene never lands on top of it", () => {
    // The parent persists every save. If it reloads the scene (reset to
    // template) while a debounced save from the OLD scene is still pending,
    // that save must not fire afterwards and revert the reload.
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    change(bridge, ["STALE"]);
    vi.advanceTimersByTime(100); // debounce still pending
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: JSON.stringify([
        API.createElement({ type: "rectangle", id: "FRESH" }),
      ]),
    });
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(0);
    bridge.destroy();
  });

  it("a failed load keeps the previous generation and tells the parent it did not land", () => {
    // The parent drops saves whose `gen` is older than the load it believes is
    // installed. If a failed load still advanced `gen`, every later save would
    // claim a generation it never reached; if the parent were never told, it
    // would silently discard saves under the older one instead.
    const { api, parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
      gen: 8,
    });
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: "{corrupt",
      gen: 9,
    });
    const errors = parent.postMessage.mock.calls.filter(
      ([msg]) => msg.type === EMBED_MESSAGE_TYPES.ERROR,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0][0].gen).toBe(9);
    expect(errors[0][1]).toBe(PARENT_ORIGIN);
    expect(api.setToast).toHaveBeenCalledTimes(1);
    // the scene on screen is untouched by the failed load
    expect(api.updateScene).toHaveBeenCalledTimes(1);

    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    const saves = savesPosted(parent);
    expect(saves).toHaveLength(1);
    expect(saves[0][0].gen).toBe(8);
    bridge.destroy();
  });

  it.each([
    ["a non-string scene", { scene: null }],
    ["a scene the parent forgot to stringify", { scene: { elements: [] } }],
    ["no scene at all", {}],
  ])("reports %s instead of dropping it silently", (_label, payload) => {
    const { api, parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      gen: 5,
      ...payload,
    });
    const errors = parent.postMessage.mock.calls.filter(
      ([msg]) => msg.type === EMBED_MESSAGE_TYPES.ERROR,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0][0].gen).toBe(5);
    expect(api.setToast).toHaveBeenCalledTimes(1);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(bridge.isLoaded()).toBe(false);
    bridge.destroy();
  });

  it("a failed load leaves a pending save armed so pre-load edits are not lost", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
      gen: 1,
    });
    change(bridge, ["DRAWN"]);
    vi.advanceTimersByTime(100); // debounce still pending
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: "{not json",
      gen: 2,
    });
    vi.advanceTimersByTime(5000);
    const saves = savesPosted(parent);
    expect(saves).toHaveLength(1);
    expect(
      JSON.parse(saves[0][0].scene).elements.map((el: { id: string }) => el.id),
    ).toEqual(["DRAWN"]);
    expect(saves[0][0].gen).toBe(1);
    bridge.destroy();
  });

  it("echoes the load's generation id on every save so the parent can drop stale ones", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
      gen: 7,
    });
    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(1);
    expect(savesPosted(parent)[0][0].gen).toBe(7);
    bridge.destroy();
  });

  it("treats a blank load as an empty scene (a new board must still be able to save)", () => {
    const { api, parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: "",
    });
    expect(api.setToast).not.toHaveBeenCalled();
    expect(bridge.isLoaded()).toBe(true);
    change(bridge, ["FIRST"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(1);
    bridge.destroy();
  });

  it("a load preserves camera, theme and frame rendering the scene cannot carry", () => {
    // only gridSize and viewBackgroundColor survive an export round-trip, so
    // everything else must fall back to the live state rather than to defaults
    const { api, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    const { appState } = api.updateScene.mock.calls[0][0];
    expect(appState.scrollX).toBe(-1200);
    expect(appState.scrollY).toBe(-800);
    expect(appState.zoom.value).toBe(2);
    expect(appState.theme).toBe("dark");
    expect(appState.frameRendering).toEqual({
      enabled: false,
      clip: false,
      name: false,
      outline: false,
    });
    // ...while what the scene does carry still wins
    expect(appState.viewBackgroundColor).toBe("#ffffff");
    bridge.destroy();
  });

  it("drops appState keys a scene document cannot legitimately carry", () => {
    // scenes reach us from agents, hand-editing and old revisions; an
    // unrecognised key must be ignored, never installed and never fatal
    const { api, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: JSON.stringify({
        type: "excalidraw",
        elements: [API.createElement({ type: "rectangle", id: "A" })],
        appState: {
          gridSize: 20,
          viewBackgroundColor: "#eeeeee",
          collaborators: [], // a Map in live state; an array would throw
          viewModeEnabled: true,
          errorMessage: "injected",
          openDialog: { name: "settings" },
        },
      }),
    });
    expect(api.setToast).not.toHaveBeenCalled();
    expect(bridge.isLoaded()).toBe(true);

    const { appState } = api.updateScene.mock.calls[0][0];
    expect(appState.gridSize).toBe(20);
    expect(appState.viewBackgroundColor).toBe("#eeeeee");
    expect(appState.collaborators).toBeInstanceOf(Map);
    expect(appState.viewModeEnabled).toBe(false);
    expect(appState.errorMessage).toBeNull();
    expect(appState.openDialog).toBeNull();
    bridge.destroy();
  });

  it("ignores wrongly typed values for the two loadable keys", () => {
    const { api, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: JSON.stringify({
        elements: [],
        appState: { gridSize: "20", viewBackgroundColor: 123 },
      }),
    });
    const { appState } = api.updateScene.mock.calls[0][0];
    // both fall through to the live values rather than being installed
    expect(appState.gridSize).toBe(liveAppState().gridSize);
    expect(appState.viewBackgroundColor).toBe(
      liveAppState().viewBackgroundColor,
    );
    bridge.destroy();
  });

  it("ignores a load from another window on the allowlisted origin", () => {
    const { api, parent, bridge } = setup();
    dispatchMessage(
      PARENT_ORIGIN,
      { type: EMBED_MESSAGE_TYPES.LOAD, scene: sceneDoc() },
      { postMessage: vi.fn() }, // a sibling frame, right origin, wrong window
    );
    expect(api.updateScene).not.toHaveBeenCalled();
    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(0);
    bridge.destroy();
  });

  it("applies a load that arrived before start() instead of dropping it", () => {
    // a parent may post its scene on the frame's load event rather than
    // waiting for ready, and has no reason to send it twice
    const { api, parent, bridge } = setup({ start: false });
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
      gen: 3,
    });
    expect(api.updateScene).not.toHaveBeenCalled();

    bridge.start();
    expect(api.updateScene).not.toHaveBeenCalled(); // deferred past library init
    vi.advanceTimersByTime(0);
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(
      api.updateScene.mock.calls[0][0].elements.map(
        (el: { id: string }) => el.id,
      ),
    ).toEqual(["A", "B"]);
    expect(bridge.isLoaded()).toBe(true);

    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)[0][0].gen).toBe(3);
    bridge.destroy();
  });

  it("start() is idempotent", () => {
    const { api, parent, bridge } = setup();
    bridge.start();
    bridge.start();
    vi.advanceTimersByTime(0);
    expect(
      parent.postMessage.mock.calls.filter(
        ([msg]) => msg.type === EMBED_MESSAGE_TYPES.READY,
      ),
    ).toHaveLength(1);
    expect(api.updateScene).not.toHaveBeenCalled();
    bridge.destroy();
  });

  it("flush posts the pending save, then acks with the request id", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
      gen: 4,
    });
    change(bridge, ["A"]);
    vi.advanceTimersByTime(100); // debounce still pending
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.FLUSH,
      requestId: "req-1",
    });

    const posted = parent.postMessage.mock.calls.map(([msg]) => msg);
    const saveAt = posted.findIndex((m) => m.type === EMBED_MESSAGE_TYPES.SAVE);
    const ackAt = posted.findIndex(
      (m) => m.type === EMBED_MESSAGE_TYPES.FLUSHED,
    );
    expect(saveAt).toBeGreaterThanOrEqual(0);
    // the ack must trail the save it covers, so awaiting it is sufficient
    expect(ackAt).toBeGreaterThan(saveAt);
    expect(posted[ackAt].requestId).toBe("req-1");
    expect(posted[saveAt].gen).toBe(4);

    // nothing left to fire afterwards
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(1);
    bridge.destroy();
  });

  it("flush acks even with nothing pending", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.FLUSH,
      requestId: 7,
    });
    const acks = parent.postMessage.mock.calls.filter(
      ([msg]) => msg.type === EMBED_MESSAGE_TYPES.FLUSHED,
    );
    expect(acks).toHaveLength(1);
    expect(acks[0][0].requestId).toBe(7);
    expect(savesPosted(parent)).toHaveLength(0);
    bridge.destroy();
  });

  it("destroy posts a pending save rather than dropping it", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    change(bridge, ["LAST"]);
    vi.advanceTimersByTime(100); // debounce still pending
    bridge.destroy();
    const saves = savesPosted(parent);
    expect(saves).toHaveLength(1);
    expect(
      JSON.parse(saves[0][0].scene).elements.map((el: { id: string }) => el.id),
    ).toEqual(["LAST"]);
  });

  it("stops posting after destroy", () => {
    const { parent, bridge } = setup();
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc(),
    });
    bridge.destroy();
    change(bridge, ["A"]);
    vi.advanceTimersByTime(5000);
    expect(savesPosted(parent)).toHaveLength(0);
    // a flush arriving after teardown is ignored, ack included
    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.FLUSH,
      requestId: "late",
    });
    expect(
      parent.postMessage.mock.calls.filter(
        ([msg]) => msg.type === EMBED_MESSAGE_TYPES.FLUSHED,
      ),
    ).toHaveLength(0);
  });
});

describe("ExcalidrawApp embedded mode", () => {
  it("posts ready once and round-trips a load through the real app", async () => {
    const parent = { postMessage: vi.fn() };
    setParentWindow(parent as unknown as Window);
    setParentOriginParam(PARENT_ORIGIN);
    // a stale local scene must NOT be restored while embedded (KTD2)
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify([API.createElement({ type: "rectangle", id: "LOCAL" })]),
    );

    const localSave = vi.spyOn(LocalData, "save");

    await render(<ExcalidrawApp />);

    await waitFor(() => {
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: EMBED_MESSAGE_TYPES.READY },
        PARENT_ORIGIN,
      );
    });
    expect(
      parent.postMessage.mock.calls.filter(
        ([m]) => m.type === EMBED_MESSAGE_TYPES.READY,
      ),
    ).toHaveLength(1);
    expect(h.elements).toEqual([]);

    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc({ files: {} }),
    });
    await waitFor(() => {
      expect(h.elements.map((el) => el.id)).toEqual(["A", "B"]);
    });
    // embedded sessions must not write the browser-local scene
    expect(localSave).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!),
    ).toEqual([expect.objectContaining({ id: "LOCAL" })]);
  });

  it("a load applied before the library finished init survives it", async () => {
    // the bridge registers its listener at construction, so a parent that
    // posts on the frame's load event lands here — before the library has
    // resolved initialData and written its own (empty) scene
    const parent = { postMessage: vi.fn() };
    setParentWindow(parent as unknown as Window);
    setParentOriginParam(PARENT_ORIGIN);

    const realAdd = window.addEventListener.bind(window);
    const addSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type: any, listener: any, opts?: any) => {
        realAdd(type, listener, opts);
        if (type === "message") {
          // deliver the parent's scene the instant the bridge is listening
          dispatchMessage(PARENT_ORIGIN, {
            type: EMBED_MESSAGE_TYPES.LOAD,
            scene: sceneDoc({ files: {} }),
            gen: 1,
          });
        }
      });

    await render(<ExcalidrawApp />);
    addSpy.mockRestore();

    await waitFor(() => {
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: EMBED_MESSAGE_TYPES.READY },
        PARENT_ORIGIN,
      );
    });
    expect(h.elements.map((el) => el.id)).toEqual(["A", "B"]);
    // and the empty init scene must never be posted back as a save
    expect(
      parent.postMessage.mock.calls.filter(
        ([m]) => m.type === EMBED_MESSAGE_TYPES.SAVE,
      ),
    ).toHaveLength(0);
  });

  it("undo immediately after a load cannot empty the board", async () => {
    const parent = { postMessage: vi.fn() };
    setParentWindow(parent as unknown as Window);
    setParentOriginParam(PARENT_ORIGIN);

    await render(<ExcalidrawApp />);
    await waitFor(() => {
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: EMBED_MESSAGE_TYPES.READY },
        PARENT_ORIGIN,
      );
    });

    dispatchMessage(PARENT_ORIGIN, {
      type: EMBED_MESSAGE_TYPES.LOAD,
      scene: sceneDoc({ files: {} }),
      gen: 1,
    });
    await waitFor(() => {
      expect(h.elements.map((el) => el.id)).toEqual(["A", "B"]);
    });

    // the loaded scene is the floor: there is nothing before it to undo to
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.Z);
    });
    expect(h.elements.filter((el) => !el.isDeleted).map((el) => el.id)).toEqual(
      ["A", "B"],
    );
  });

  it("not embedded: restores localStorage and posts nothing", async () => {
    const parent = { postMessage: vi.fn() };
    // framed by the same parent, but with no `parentOrigin` in the URL
    setParentWindow(parent as unknown as Window);
    setSearch("/");
    const localElements = [API.createElement({ type: "rectangle", id: "L1" })];
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify(localElements),
    );

    await render(<ExcalidrawApp />);

    await waitFor(() => {
      expect(h.elements.map((el) => el.id)).toEqual(["L1"]);
    });
    expect(
      parent.postMessage.mock.calls.filter(([msg]) =>
        String(msg?.type ?? "").startsWith("excalidraw:"),
      ),
    ).toHaveLength(0);
  });
});
