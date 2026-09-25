import { afterEach, describe, expect, it, vi } from "vitest";
import { API } from "../../packages/excalidraw/tests/helpers/api";
import { getBoundTextMaxWidth } from "../../packages/excalidraw/element/textElement";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "../../packages/excalidraw/element/types";
import { loadFromHttpStorage, TokenService } from "../data/httpStorage";

// In the test env a glyph measures 10px, so this 215-wide box has a 205px
// inner width: one line holds 20 characters.
const container = () =>
  API.createElement({
    type: "rectangle",
    id: "box",
    x: 100,
    y: 220,
    width: 215,
    height: 190,
    boundElements: [{ type: "text", id: "label" }],
  });

// A label as an AI agent writes it: one line of text, but a box guessed for
// two wrapped lines and narrower than the line itself.
const guessedLabel = (text: string) => ({
  ...API.createElement({
    type: "text",
    id: "label",
    containerId: "box",
    text,
    fontSize: 20,
    textAlign: "center",
    verticalAlign: "middle",
  }),
  lineHeight: 1.25 as ExcalidrawTextElement["lineHeight"],
  x: 112,
  y: 290,
  width: 90,
  height: 50,
});

const loadRoom = async (elements: readonly ExcalidrawElement[]) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({ data: JSON.stringify(elements) }),
    })),
  );
  const tokenService = {
    getToken: async () => "token",
  } as unknown as TokenService;
  const loaded = await loadFromHttpStorage("room", "key", null, tokenService);
  return loaded!.find(
    (element) => element.id === "label",
  ) as ExcalidrawTextElement;
};

describe("loadFromHttpStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-measures and re-centres a bound label stored with a guessed box", async () => {
    const box = container();
    const stored = guessedLabel("Short label");

    const label = await loadRoom([box, stored]);

    expect(label.text).toBe("Short label");
    expect(label.width).toBe(110);
    expect(label.height).toBe(25);
    expect(label.x).toBe(box.x + (box.width - 110) / 2);
    expect(label.y).toBe(box.y + (box.height - 25) / 2);
    // measured locally on every load, so nothing is broadcast or re-saved
    expect(label.version).toBe(stored.version);
  });

  it("wraps a bound label's original text to the container's inner width", async () => {
    const box = container();
    const stored = guessedLabel("a label long enough to need a wrap");

    const label = await loadRoom([box, stored]);

    const lines = label.text.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(label.text.replace(/\s+/g, " ")).toBe(stored.originalText);
    const innerWidth = getBoundTextMaxWidth(box, label);
    for (const line of lines) {
      expect(line.length * 10).toBeLessThanOrEqual(innerWidth);
    }
    expect(label.height).toBe(lines.length * 25);
    expect(label.y).toBe(box.y + (box.height - label.height) / 2);
  });
});
