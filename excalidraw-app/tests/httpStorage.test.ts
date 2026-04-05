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

  it("returns saved:false when GET fails with non-404 status", async () => {
    const portal = makePortal();

    mockFetchResponses([new Response(null, { status: 500 })]);

    const result = await saveToHttpStorage(
      portal,
      [createElement("A", 1)],
      makeTokenService(),
      emptyAppState,
    );

    expect(result).toEqual({ saved: false, reconciledElements: null });
  });

  it("returns saved:false when POST fails", async () => {
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

    expect(result).toEqual({ saved: false, reconciledElements: null });
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
});
