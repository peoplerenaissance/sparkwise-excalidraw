import { render, waitFor } from "./test-utils";
import { Excalidraw } from "../index";
import { API } from "./helpers/api";
import * as clipboard from "../clipboard";
import { actionCopyViewportParams } from "../actions/actionFrame";
import { parseViewportValue } from "../utils";
import { vi } from "vitest";

const { h } = window;

const selectOnly = (...ids: string[]) => {
  h.setState({
    selectedElementIds: ids.reduce(
      (acc, id) => ({ ...acc, [id]: true }),
      {} as Record<string, true>,
    ),
  });
};

const frameAt = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
) => API.createElement({ type: "frame", id, x, y, width, height });

describe("copy viewport params action", () => {
  afterEach(() => vi.restoreAllMocks());

  it("copies the frame's viewport param string to the clipboard (AE5)", async () => {
    const copySpy = vi
      .spyOn(clipboard, "copyTextToSystemClipboard")
      .mockResolvedValue(undefined);
    await render(
      <Excalidraw
        initialData={{ elements: [frameAt("F1", 120, 80, 900, 600)] }}
      />,
    );
    selectOnly("F1");

    h.app.actionManager.executeAction(actionCopyViewportParams);

    await waitFor(() => {
      expect(copySpy).toHaveBeenCalledWith("viewport=120,80,900,600");
      expect(h.state.toast?.message).toBe(
        "Copied viewport link parameters to clipboard.",
      );
    });
  });

  it("the copied string round-trips back to the frame's rectangle (R9, AE5)", async () => {
    let copied = "";
    vi.spyOn(clipboard, "copyTextToSystemClipboard").mockImplementation(
      async (text) => {
        copied = text ?? "";
      },
    );
    await render(
      <Excalidraw
        initialData={{ elements: [frameAt("F1", 120, 80, 900, 600)] }}
      />,
    );
    selectOnly("F1");

    h.app.actionManager.executeAction(actionCopyViewportParams);

    await waitFor(() => expect(copied).not.toBe(""));
    expect(parseViewportValue(copied.replace("viewport=", ""))).toEqual({
      x: 120,
      y: 80,
      w: 900,
      h: 600,
    });
  });

  it("surfaces a toast when the clipboard write fails", async () => {
    vi.spyOn(clipboard, "copyTextToSystemClipboard").mockRejectedValue(
      new Error("clipboard-write denied"),
    );
    await render(
      <Excalidraw
        initialData={{ elements: [frameAt("F1", 120, 80, 900, 600)] }}
      />,
    );
    selectOnly("F1");

    h.app.actionManager.executeAction(actionCopyViewportParams);

    await waitFor(() => {
      expect(h.state.toast?.message).toBe("Couldn't copy to clipboard.");
    });
  });

  it("rounds fractional frame geometry to integers", async () => {
    const copySpy = vi
      .spyOn(clipboard, "copyTextToSystemClipboard")
      .mockResolvedValue(undefined);
    await render(
      <Excalidraw
        initialData={{
          elements: [frameAt("F1", 120.4, 79.6, 899.5, 600.2)],
        }}
      />,
    );
    selectOnly("F1");

    h.app.actionManager.executeAction(actionCopyViewportParams);

    await waitFor(() =>
      expect(copySpy).toHaveBeenCalledWith("viewport=120,80,900,600"),
    );
  });

  it("is available only when a single frame is selected", async () => {
    await render(
      <Excalidraw
        initialData={{
          elements: [
            frameAt("F1", 0, 0, 100, 100),
            API.createElement({
              type: "rectangle",
              id: "R1",
              x: 0,
              y: 0,
              width: 10,
              height: 10,
            }),
          ],
        }}
      />,
    );
    const app = h.app;
    const canRun = () =>
      actionCopyViewportParams.predicate!(h.elements, h.state, app.props, app);

    selectOnly("F1");
    expect(canRun()).toBe(true);

    selectOnly("R1");
    expect(canRun()).toBe(false);

    selectOnly("F1", "R1");
    expect(canRun()).toBe(false);
  });
});
