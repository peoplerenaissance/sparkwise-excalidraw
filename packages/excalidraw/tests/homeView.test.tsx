import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";
import { Excalidraw } from "../index";
import { API } from "./helpers/api";
import * as utils from "../utils";
import { actionResetZoom } from "../actions/actionCanvas";
import { AppState, NormalizedZoomValue } from "../types";
import { vi } from "vitest";

const { h } = window;

const VIEWPORT = { x: 120, y: 80, w: 900, h: 600 };
const centerX = VIEWPORT.x + VIEWPORT.w / 2; // 570
const centerY = VIEWPORT.y + VIEWPORT.h / 2; // 380

const TALL = {
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  x: 0,
  y: 0,
  width: 100,
  height: 300,
  toJSON: () => {},
};

// Assert the framed rectangle's center sits at the viewport center for the
// current dimensions and zoom.
const expectHomeView = () => {
  expect(h.state.scrollX).toBeCloseTo(
    h.state.width / 2 / h.state.zoom.value - centerX,
    5,
  );
  expect(h.state.scrollY).toBeCloseTo(
    h.state.height / 2 / h.state.zoom.value - centerY,
    5,
  );
};

describe("sticky viewport home view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreOriginalGetBoundingClientRect();
  });

  it("reset-zoom returns to the home view, not to fit-all or 100% (AE4)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect();
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => expect(h.state.width).toBe(200));

    // zoom in and pan away from the home view
    h.setState({
      zoom: { value: 5 as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    });
    h.app.actionManager.executeAction(actionResetZoom);

    await waitFor(() => {
      // fit-by-height of the region, not 100% and not fit-all
      expect(h.state.zoom.value).toBeCloseTo(100 / 600, 5);
      expectHomeView();
    });
  });

  it("re-applies the home view when the window changes shape (AE3)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect(); // wide 200x100
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => expect(h.state.width).toBe(200));

    // learner pans away
    h.setState({ scrollX: 0, scrollY: 0 });

    // window becomes tall and narrow
    mockBoundingClientRect(TALL);
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(h.state.width).toBe(100);
      expect(h.state.height).toBe(300);
      // now fit by width
      expect(h.state.zoom.value).toBeCloseTo(100 / 900, 5);
      expectHomeView();
    });
  });

  it("does not re-fit on resize while editing text (guard)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect();
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => expect(h.state.width).toBe(200));

    h.setState({
      editingElement: API.createElement({ type: "text", id: "t" }),
      scrollX: 12345,
      scrollY: 6789,
    });

    mockBoundingClientRect(TALL);
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(h.state.width).toBe(100); // resize processed
      expect(h.state.scrollX).toBe(12345); // but camera left alone
      expect(h.state.scrollY).toBe(6789);
    });
  });

  it("does not re-fit on resize while following a collaborator (guard)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect();
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => expect(h.state.width).toBe(200));

    h.setState({
      userToFollow: {
        socketId: "s1",
        username: "u",
      } as unknown as AppState["userToFollow"],
      scrollX: 12345,
      scrollY: 6789,
    });

    mockBoundingClientRect(TALL);
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(h.state.width).toBe(100);
      expect(h.state.scrollX).toBe(12345);
      expect(h.state.scrollY).toBe(6789);
    });
  });

  it("does not re-fit when dimensions are unchanged (guard)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect();
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => expect(h.state.width).toBe(200));

    h.setState({ scrollX: 12345, scrollY: 6789 });

    // same dimensions -> no dimension change -> no re-fit
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(h.state.scrollX).toBe(12345);
      expect(h.state.scrollY).toBe(6789);
    });
  });

  it("without a viewport param, reset-zoom keeps upstream behavior", async () => {
    // No spy: real getter reads empty location.search -> null.
    mockBoundingClientRect();
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => expect(h.state.width).toBe(200));

    h.setState({
      zoom: { value: 5 as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    });
    h.app.actionManager.executeAction(actionResetZoom);

    // default UI mode is "all" -> reset returns to 100%, not a home view
    await waitFor(() => {
      expect(h.state.zoom.value).toBe(1);
    });
  });
});
