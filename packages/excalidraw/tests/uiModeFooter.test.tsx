import { render, waitFor } from "./test-utils";
import { Excalidraw } from "../index";
import * as utils from "../utils";
import { vi } from "vitest";

const footer = () => document.querySelector("footer.layer-ui__wrapper__footer");

describe("footer visibility by UI mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hides the zoom/undo footer in mode none (chromeless capture)", async () => {
    vi.spyOn(utils, "getUiMode").mockReturnValue("none");
    await render(<Excalidraw />);
    await waitFor(() => expect(footer()).toBeNull());
  });

  it("keeps the footer in minimal mode", async () => {
    vi.spyOn(utils, "getUiMode").mockReturnValue("minimal");
    await render(<Excalidraw />);
    await waitFor(() => expect(footer()).not.toBeNull());
  });

  it("keeps the footer in the default (all) mode", async () => {
    await render(<Excalidraw />);
    await waitFor(() => expect(footer()).not.toBeNull());
  });
});
