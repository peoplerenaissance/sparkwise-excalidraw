import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";
import { Excalidraw } from "../index";
import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { KEYS } from "../keys";
import * as utils from "../utils";
import { NormalizedZoomValue } from "../types";
import { vi } from "vitest";

const { h } = window;

describe("appState", () => {
  it("scroll-to-content on init works with non-zero offsets", async () => {
    const WIDTH = 200;
    const HEIGHT = 100;
    const OFFSET_LEFT = 20;
    const OFFSET_TOP = 10;

    const ELEM_WIDTH = 100;
    const ELEM_HEIGHT = 60;

    mockBoundingClientRect();

    await render(
      <div>
        <Excalidraw
          initialData={{
            elements: [
              API.createElement({
                type: "rectangle",
                id: "A",
                width: ELEM_WIDTH,
                height: ELEM_HEIGHT,
              }),
            ],
            scrollToContent: true,
          }}
        />
      </div>,
    );
    await waitFor(() => {
      expect(h.state.width).toBe(200);
      expect(h.state.height).toBe(100);
      expect(h.state.offsetLeft).toBe(OFFSET_LEFT);
      expect(h.state.offsetTop).toBe(OFFSET_TOP);

      // assert scroll is in center
      expect(h.state.scrollX).toBe(
        WIDTH / 2 / h.state.zoom.value - ELEM_WIDTH / 2,
      );

      // subtract 60 because offset added to make room for toolbar
      expect(h.state.scrollY).toBe(
        HEIGHT / 2 / h.state.zoom.value - (ELEM_HEIGHT / 2 - 30),
      );
    });
    restoreOriginalGetBoundingClientRect();
  });

  it("moving by page up/down/left/right", async () => {
    mockBoundingClientRect();
    await render(<Excalidraw handleKeyboardGlobally={true} />, {});

    const scrollTest = () => {
      const initialScrollY = h.state.scrollY;
      const initialScrollX = h.state.scrollX;
      const pageStepY = h.state.height / h.state.zoom.value;
      const pageStepX = h.state.width / h.state.zoom.value;
      // Assert the following assertions have meaning
      expect(pageStepY).toBeGreaterThan(0);
      expect(pageStepX).toBeGreaterThan(0);
      // Assert we scroll up
      Keyboard.keyPress(KEYS.PAGE_UP);
      expect(h.state.scrollY).toBe(initialScrollY + pageStepY);
      // x-axis unchanged
      expect(h.state.scrollX).toBe(initialScrollX);

      // Assert we scroll down
      Keyboard.keyPress(KEYS.PAGE_DOWN);
      Keyboard.keyPress(KEYS.PAGE_DOWN);
      expect(h.state.scrollY).toBe(initialScrollY - pageStepY);
      // x-axis unchanged
      expect(h.state.scrollX).toBe(initialScrollX);

      // Assert we scroll left
      Keyboard.withModifierKeys({ shift: true }, () => {
        Keyboard.keyPress(KEYS.PAGE_UP);
      });
      expect(h.state.scrollX).toBe(initialScrollX + pageStepX);
      // y-axis unchanged
      expect(h.state.scrollY).toBe(initialScrollY - pageStepY);

      // Assert we scroll right
      Keyboard.withModifierKeys({ shift: true }, () => {
        Keyboard.keyPress(KEYS.PAGE_DOWN);
        Keyboard.keyPress(KEYS.PAGE_DOWN);
      });
      expect(h.state.scrollX).toBe(initialScrollX - pageStepX);
      // y-axis unchanged
      expect(h.state.scrollY).toBe(initialScrollY - pageStepY);
    };

    const zoom = h.state.zoom.value;
    // Assert we scroll properly when zoomed in
    h.setState({ zoom: { value: (zoom * 1.1) as typeof zoom } });
    scrollTest();
    // Assert we scroll properly when zoomed out
    h.setState({ zoom: { value: (zoom * 0.9) as typeof zoom } });
    scrollTest();
    // Assert we scroll properly with normal zoom
    h.setState({ zoom: { value: zoom } });
    scrollTest();
    restoreOriginalGetBoundingClientRect();
  });
});

describe("viewport URL param home view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreOriginalGetBoundingClientRect();
  });

  const VIEWPORT = { x: 120, y: 80, w: 900, h: 600 };
  const centerX = VIEWPORT.x + VIEWPORT.w / 2;
  const centerY = VIEWPORT.y + VIEWPORT.h / 2;

  // Assert the camera fits-and-centers the given rectangle: zoom fits the tight
  // axis and the rectangle's center sits at the viewport center.
  const expectHomeView = (expectedZoom: number) => {
    expect(h.state.zoom.value).toBeCloseTo(expectedZoom, 5);
    expect(h.state.scrollX).toBeCloseTo(
      h.state.width / 2 / h.state.zoom.value - centerX,
      5,
    );
    expect(h.state.scrollY).toBeCloseTo(
      h.state.height / 2 / h.state.zoom.value - centerY,
      5,
    );
  };

  it("fits and centers the URL viewport, fit by the tight axis (AE1)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect(); // wide 200x100 window

    await render(
      <Excalidraw
        initialData={{
          elements: [
            API.createElement({
              type: "rectangle",
              id: "A",
              width: 50,
              height: 50,
            }),
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(h.state.width).toBe(200);
      expect(h.state.height).toBe(100);
      // 200/900 vs 100/600 -> fit by height
      expectHomeView(100 / 600);
    });
  });

  it("fits by width in a tall window (AE1)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect({
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      width: 100,
      height: 300,
      toJSON: () => {},
    });

    await render(<Excalidraw initialData={{ elements: [] }} />);

    await waitFor(() => {
      expect(h.state.width).toBe(100);
      expect(h.state.height).toBe(300);
      // 100/900 vs 300/600 -> fit by width
      expectHomeView(100 / 900);
    });
  });

  it("wins over restored camera and scrollToContent fit-all (R4)", async () => {
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue(VIEWPORT);
    mockBoundingClientRect();

    await render(
      <Excalidraw
        initialData={{
          elements: [
            API.createElement({
              type: "rectangle",
              id: "A",
              width: 100,
              height: 60,
            }),
          ],
          // stand-in for a restored localStorage camera
          appState: {
            scrollX: 9999,
            scrollY: 9999,
            zoom: { value: 3 as NormalizedZoomValue },
          },
          scrollToContent: true,
        }}
      />,
    );

    await waitFor(() => {
      expect(h.state.scrollX).not.toBe(9999);
      expectHomeView(100 / 600);
    });
  });

  it("leaves the no-param scrollToContent path unchanged (AE2)", async () => {
    // No spy: the real getter reads an empty location.search and returns null,
    // so the home-view block is skipped and behavior matches upstream.
    const ELEM_WIDTH = 100;
    const ELEM_HEIGHT = 60;
    mockBoundingClientRect();

    await render(
      <Excalidraw
        initialData={{
          elements: [
            API.createElement({
              type: "rectangle",
              id: "A",
              width: ELEM_WIDTH,
              height: ELEM_HEIGHT,
            }),
          ],
          scrollToContent: true,
        }}
      />,
    );

    await waitFor(() => {
      expect(h.state.scrollX).toBe(
        200 / 2 / h.state.zoom.value - ELEM_WIDTH / 2,
      );
      // subtract 30 for the toolbar-room offset (matches upstream scroll-to-content)
      expect(h.state.scrollY).toBe(
        100 / 2 / h.state.zoom.value - (ELEM_HEIGHT / 2 - 30),
      );
    });
  });

  it("clamps zoom for extreme rectangles but still centers (KTD6)", async () => {
    mockBoundingClientRect();

    // Tiny region implies zoom > 30 -> clamped to 30
    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue({
      x: 120,
      y: 80,
      w: 1,
      h: 1,
    });
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => {
      expect(h.state.zoom.value).toBe(30);
      expect(h.state.scrollX).toBeCloseTo(
        h.state.width / 2 / 30 - (120 + 0.5),
        5,
      );
    });
  });

  it("clamps huge rectangles to the minimum zoom but still centers (KTD6)", async () => {
    mockBoundingClientRect();

    vi.spyOn(utils, "getViewportFromSearchParams").mockReturnValue({
      x: 0,
      y: 0,
      w: 100000,
      h: 100000,
    });
    await render(<Excalidraw initialData={{ elements: [] }} />);
    await waitFor(() => {
      expect(h.state.zoom.value).toBe(0.1);
      expect(h.state.scrollX).toBeCloseTo(h.state.width / 2 / 0.1 - 50000, 5);
    });
  });
});
