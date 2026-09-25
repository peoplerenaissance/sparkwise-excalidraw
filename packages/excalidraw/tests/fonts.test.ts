import { describe, expect, it } from "vitest";
import { API } from "./helpers/api";
import Scene from "../scene/Scene";
import { Fonts } from "../scene/Fonts";
import type { ExcalidrawTextElement } from "../element/types";

describe("Fonts.onFontsLoaded", () => {
  it("re-wraps and re-centres bound text measured before the font loaded", () => {
    // In the test env a glyph measures 10px; the box's inner width is 205px.
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: 100,
      y: 220,
      width: 215,
      height: 190,
      boundElements: [{ type: "text", id: "label" }],
    });
    // Laid out with fallback metrics: wrapped too early, box off-centre.
    const label = {
      ...API.createElement({
        type: "text",
        id: "label",
        containerId: "box",
        text: "Short\nlabel",
        fontSize: 20,
        textAlign: "center",
        verticalAlign: "middle",
      }),
      originalText: "Short label",
      lineHeight: 1.25 as ExcalidrawTextElement["lineHeight"],
      x: 150,
      y: 290,
      width: 70,
      height: 50,
    };
    const scene = new Scene();
    scene.replaceAllElements([box, label]);
    const fonts = new Fonts({ scene, onSceneUpdated: () => {} });

    fonts.onFontsLoaded([
      { family: "BoundTextTest", style: "normal", weight: "400" } as FontFace,
    ]);

    const refreshed = scene.getElement("label") as ExcalidrawTextElement;
    expect(refreshed.text).toBe("Short label");
    expect(refreshed.width).toBe(110);
    expect(refreshed.height).toBe(25);
    expect(refreshed.x).toBe(box.x + (box.width - 110) / 2);
    expect(refreshed.y).toBe(box.y + (box.height - 25) / 2);
  });
});
