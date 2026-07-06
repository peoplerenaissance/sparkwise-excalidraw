import { render, waitFor } from "./test-utils";
import { Excalidraw } from "../index";
import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import * as utils from "../utils";
import { vi } from "vitest";

const { h } = window;
const mouse = new Pointer("mouse");

const LEARNER_FRAME_RENDERING = {
  enabled: false,
  clip: false,
  name: false,
  outline: false,
};

const makeFrame = () =>
  API.createElement({
    type: "frame",
    id: "F1",
    x: 100,
    y: 100,
    width: 200,
    height: 200,
  });

// A frame large enough to cover wherever a dragged element lands, so adoption
// depends only on the UI mode, not on exact pointer coordinates.
const makeBigFrame = () =>
  API.createElement({
    type: "frame",
    id: "BIG",
    x: -1000,
    y: -1000,
    width: 3000,
    height: 3000,
  });

const makeRect = () =>
  API.createElement({
    type: "rectangle",
    id: "R1",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
  });

// Select the rectangle, then drag it so pointer-up lands inside the frame.
const selectAndDrag = () => {
  const el = h.elements.find((e) => e.id === "R1")!;
  mouse.clickOn(el);
  mouse.downAt(el.x + el.width / 2, el.y + el.height / 2);
  mouse.moveTo(60, 60);
  mouse.upAt(60, 60);
};

describe("frame rendering suppression in learner modes (R10)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mouse.reset();
  });

  it("disables all frame rendering in minimal mode", async () => {
    vi.spyOn(utils, "getUiMode").mockReturnValue("minimal");
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => {
      expect(h.state.frameRendering).toEqual(LEARNER_FRAME_RENDERING);
    });
  });

  it("disables all frame rendering in none mode", async () => {
    vi.spyOn(utils, "getUiMode").mockReturnValue("none");
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => {
      expect(h.state.frameRendering).toEqual(LEARNER_FRAME_RENDERING);
    });
  });

  it("keeps frame rendering enabled in the default (all) mode", async () => {
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => {
      expect(h.state.frameRendering.enabled).toBe(true);
    });
  });
});

describe("frame inertness in learner modes (R11)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mouse.reset();
  });

  it("does not select an inert frame on click", async () => {
    vi.spyOn(utils, "getUiMode").mockReturnValue("minimal");
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => expect(h.elements.length).toBe(1));

    mouse.clickAt(100, 150); // on the frame's left border
    expect(h.state.selectedElementIds.F1).toBeFalsy();
  });

  it("does not marquee-select an inert frame", async () => {
    vi.spyOn(utils, "getUiMode").mockReturnValue("minimal");
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => expect(h.elements.length).toBe(1));

    // box-select from empty canvas fully enclosing the frame (100-300)
    mouse.reset();
    mouse.downAt(50, 50);
    mouse.moveTo(350, 350);
    mouse.upAt(350, 350);
    expect(h.state.selectedElementIds.F1).toBeFalsy();
  });

  it("does not adopt an element dragged into an inert frame", async () => {
    vi.spyOn(utils, "getUiMode").mockReturnValue("minimal");
    await render(
      <Excalidraw initialData={{ elements: [makeBigFrame(), makeRect()] }} />,
    );
    await waitFor(() => expect(h.elements.length).toBe(2));

    selectAndDrag();

    await waitFor(() => {
      const moved = h.elements.find((el) => el.id === "R1")!;
      expect(moved.x).not.toBe(0); // dragged
      expect(moved.frameId).toBe(null); // but never adopted
    });
  });
});

describe("frame interactivity remains in author mode (regression)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mouse.reset();
  });

  it("selects a frame on click", async () => {
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => expect(h.elements.length).toBe(1));

    mouse.clickAt(100, 150);
    expect(h.state.selectedElementIds.F1).toBe(true);
  });

  it("marquee-selects a frame", async () => {
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => expect(h.elements.length).toBe(1));

    mouse.reset();
    mouse.downAt(50, 50);
    mouse.moveTo(350, 350);
    mouse.upAt(350, 350);
    expect(h.state.selectedElementIds.F1).toBe(true);
  });

  it("adopts an element dragged into a frame", async () => {
    await render(
      <Excalidraw initialData={{ elements: [makeBigFrame(), makeRect()] }} />,
    );
    await waitFor(() => expect(h.elements.length).toBe(2));

    selectAndDrag();

    await waitFor(() => {
      const moved = h.elements.find((el) => el.id === "R1")!;
      expect(moved.x).not.toBe(0); // the drag actually moved it
      expect(moved.frameId).toBe("BIG"); // and it was adopted
    });
  });

  it("frame rendering toggle no longer affects selectability", async () => {
    // Regression for the review finding: toggling frameRendering off in author
    // mode must NOT make frames inert (inertness is mode-derived, not flag-derived).
    await render(<Excalidraw initialData={{ elements: [makeFrame()] }} />);
    await waitFor(() => expect(h.elements.length).toBe(1));

    h.setState({ frameRendering: LEARNER_FRAME_RENDERING });
    mouse.clickAt(100, 150);
    expect(h.state.selectedElementIds.F1).toBe(true);
  });
});
