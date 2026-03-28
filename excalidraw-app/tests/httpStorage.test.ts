import { vi, describe, it, expect, beforeEach } from "vitest";
import { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import { AppState } from "../../packages/excalidraw/types";
import { saveToHttpStorage, TokenService } from "../data/httpStorage";
import Portal from "../collab/Portal";

vi.stubEnv("VITE_APP_HTTP_SERVER_URL", "http://test-backend/api");

let nonceCounter = 0;
const createElement = (
  id: string,
  version: number,
  versionNonce: number = ++nonceCounter,
): ExcalidrawElement =>
  ({
    id,
    version,
    versionNonce,
    isDeleted: false,
    updated: Date.now(),
    width: 100,
    height: 100,
  } as any as ExcalidrawElement);

const makePortal = (): Portal => {
  const portal = new Portal(null as any);
  // Fresh socket per call so the WeakMap version cache doesn't persist
  portal.socket = { id: Math.random().toString() } as any;
  portal.roomId = "test-room";
  portal.roomKey = "test-key";
  return portal;
};

const makeTokenService = (): TokenService => {
  const ts = new TokenService();
  vi.spyOn(ts, "getToken").mockResolvedValue("test-token");
  return ts;
};

const makeFailingTokenService = (error: string): TokenService => {
  const ts = new TokenService();
  vi.spyOn(ts, "getToken").mockRejectedValue(new Error(error));
  return ts;
};

const emptyAppState = {} as AppState;

const mockFetchResponses = (responses: Response[]) => {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const jsonResponse = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getWrittenElements = (fetchMock: ReturnType<typeof vi.fn>) => {
  const postCall = fetchMock.mock.calls[1];
  const postBody = postCall[1].body as URLSearchParams;
  return JSON.parse(postBody.get("data")!);
};

describe("saveToHttpStorage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    nonceCounter = 0;
  });

  it("saves local elements when no remote data exists (404)", async () => {
    const portal = makePortal();
    const elements = [createElement("A", 1), createElement("B", 1)];

    const fetchMock = mockFetchResponses([
      new Response(null, { status: 404 }),
      new Response(null, { status: 200 }),
    ]);

    const result = await saveToHttpStorage(
      portal,
      elements,
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(true);
    expect(result.reconciledElements).toBeNull();

    const writtenElements = getWrittenElements(fetchMock);
    expect(writtenElements).toHaveLength(2);
    expect(writtenElements[0].id).toBe("A");
    expect(writtenElements[1].id).toBe("B");
  });

  it("reconciles when remote data exists with different elements", async () => {
    const portal = makePortal();
    const localElements = [createElement("A", 2), createElement("B", 1)];
    const remoteElements = [createElement("A", 1), createElement("C", 1)];

    const fetchMock = mockFetchResponses([
      jsonResponse({ data: JSON.stringify(remoteElements) }),
      new Response(null, { status: 200 }),
    ]);

    const result = await saveToHttpStorage(
      portal,
      localElements,
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(true);
    expect(result.reconciledElements).not.toBeNull();

    const writtenIds = getWrittenElements(fetchMock).map((e: any) => e.id);
    expect(writtenIds).toContain("A");
    expect(writtenIds).toContain("B");
    expect(writtenIds).toContain("C");
  });

  it.each([
    ["local is newer", 5, 2, 5],
    ["remote is newer", 1, 5, 5],
  ])(
    "resolves version conflict when %s",
    async (_label, localVersion, remoteVersion, expectedVersion) => {
      const portal = makePortal();
      const localA = createElement("A", localVersion, 100);
      const remoteA = createElement("A", remoteVersion, 200);

      const fetchMock = mockFetchResponses([
        jsonResponse({ data: JSON.stringify([remoteA]) }),
        new Response(null, { status: 200 }),
      ]);

      const result = await saveToHttpStorage(
        portal,
        [localA],
        makeTokenService(),
        emptyAppState,
      );

      expect(result.saved).toBe(true);

      const writtenElements = getWrittenElements(fetchMock);
      expect(writtenElements[0].id).toBe("A");
      expect(writtenElements[0].version).toBe(expectedVersion);
    },
  );

  it("returns saved:false with reason when GET fails", async () => {
    const portal = makePortal();

    mockFetchResponses([new Response(null, { status: 500 })]);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(false);
    expect(result.reconciledElements).toBeNull();
    if (!result.saved) {
      expect(result.reason).toBe("get_failed");
    }
  });

  it("returns saved:false with reason when POST fails", async () => {
    const portal = makePortal();

    mockFetchResponses([
      new Response(null, { status: 404 }),
      new Response(null, { status: 500 }),
    ]);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.reason).toBe("post_failed");
    }
  });

  it("skips save when no room exists", async () => {
    const portal = new Portal(null as any);

    const fetchMock = mockFetchResponses([]);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result).toEqual({ saved: true, reconciledElements: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns saved:false on token service failure (does not throw)", async () => {
    const portal = makePortal();

    mockFetchResponses([]);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeFailingTokenService("Request timeout"),
      emptyAppState,
    );

    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.reason).toBe("token_error");
    }
  });

  it("returns saved:false on network error during GET (does not throw)", async () => {
    const portal = makePortal();

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.reason).toBe("network_error");
    }
  });

  it("returns saved:false on network error during POST (does not throw)", async () => {
    const portal = makePortal();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.reason).toBe("network_error");
    }
  });

  it("returns saved:false on malformed response JSON (does not throw)", async () => {
    const portal = makePortal();

    mockFetchResponses([
      new Response("not json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ]);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.reason).toBe("parse_error");
    }
  });

  it.each([401, 403])(
    "returns auth_error and clears token on %i response",
    async (status) => {
      const portal = makePortal();
      const tokenService = makeTokenService();
      const clearSpy = vi.spyOn(tokenService, "clearToken");

      mockFetchResponses([new Response(null, { status })]);

      const result = await saveToHttpStorage(
        portal,
        [createElement("A", 1)],
        tokenService,
        emptyAppState,
      );

      expect(result.saved).toBe(false);
      if (!result.saved) {
        expect(result.reason).toBe("auth_error");
      }
      expect(clearSpy).toHaveBeenCalled();
    },
  );

  it("returns size_exceeded on 413 response from POST", async () => {
    const portal = makePortal();

    mockFetchResponses([
      new Response(null, { status: 404 }),
      new Response(null, { status: 413 }),
    ]);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.reason).toBe("size_exceeded");
    }
  });
});
