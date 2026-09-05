import { Excalidraw } from "../index";
import { render } from "./test-utils";
import { API } from "./helpers/api";
import {
  actionToggleElementLock,
  actionUnlockAllElements,
} from "../actions/actionElementLock";

const h = window.h;

// An embedding parent's AI stamps its locks with customData.lockedBy so its
// guard can tell them from a person's. Unlocking in the canvas is a person
// taking ownership: the stamp goes, everything else in customData stays.
describe("unlocking clears the AI lock stamp", () => {
  beforeEach(async () => {
    await render(<Excalidraw />);
  });

  it("toggle lock: unlock drops lockedBy and keeps other customData", () => {
    const el = {
      ...API.createElement({ type: "rectangle", id: "A", locked: true }),
      customData: { lockedBy: "ai", role: "header" },
    };
    h.elements = [el];
    h.setState({ selectedElementIds: { A: true } });
    h.app.actionManager.executeAction(actionToggleElementLock);
    expect(h.elements[0].locked).toBe(false);
    expect(h.elements[0].customData).toEqual({ role: "header" });
  });

  it("toggle lock: unlock removes customData entirely when lockedBy was its only key", () => {
    h.elements = [
      {
        ...API.createElement({ type: "rectangle", id: "A", locked: true }),
        customData: { lockedBy: "ai" },
      },
    ];
    h.setState({ selectedElementIds: { A: true } });
    h.app.actionManager.executeAction(actionToggleElementLock);
    expect(h.elements[0].locked).toBe(false);
    expect(h.elements[0].customData).toBeUndefined();
  });

  it("toggle lock: locking adds nothing and leaves customData untouched", () => {
    h.elements = [
      {
        ...API.createElement({ type: "rectangle", id: "A", locked: false }),
        customData: { lockedBy: "ai" },
      },
      API.createElement({ type: "rectangle", id: "B", locked: false }),
    ];
    h.setState({ selectedElementIds: { A: true, B: true } });
    h.app.actionManager.executeAction(actionToggleElementLock);
    expect(h.elements.map((el) => el.locked)).toEqual([true, true]);
    expect(h.elements[0].customData).toEqual({ lockedBy: "ai" });
    expect(h.elements[1].customData).toBeUndefined();
  });

  it("unlock all: drops lockedBy on every locked element, leaves unlocked ones alone", () => {
    h.elements = [
      {
        ...API.createElement({ type: "rectangle", id: "A", locked: true }),
        customData: { lockedBy: "ai" },
      },
      {
        ...API.createElement({ type: "rectangle", id: "B", locked: true }),
        customData: { note: "human lock" },
      },
      {
        ...API.createElement({ type: "rectangle", id: "C", locked: false }),
        customData: { lockedBy: "ai" },
      },
    ];
    h.app.actionManager.executeAction(actionUnlockAllElements);
    expect(h.elements.map((el) => el.locked)).toEqual([false, false, false]);
    expect(h.elements[0].customData).toBeUndefined();
    expect(h.elements[1].customData).toEqual({ note: "human lock" });
    // was never locked, so not a person's unlock: stamp stays
    expect(h.elements[2].customData).toEqual({ lockedBy: "ai" });
  });
});
