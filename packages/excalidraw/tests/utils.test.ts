import * as utils from "../utils";
import { parseViewportValue, formatViewportParam } from "../utils";

describe("Test isTransparent", () => {
  it("should return true when color is rgb transparent", () => {
    expect(utils.isTransparent("#ff00")).toEqual(true);
    expect(utils.isTransparent("#fff00000")).toEqual(true);
    expect(utils.isTransparent("transparent")).toEqual(true);
  });

  it("should return false when color is not transparent", () => {
    expect(utils.isTransparent("#ced4da")).toEqual(false);
  });
});

describe("parseViewportValue", () => {
  it("parses four comma-separated numbers into a rect", () => {
    expect(parseViewportValue("120,80,900,600")).toEqual({
      x: 120,
      y: 80,
      w: 900,
      h: 600,
    });
  });

  it("allows negative origin coordinates", () => {
    expect(parseViewportValue("-50,-30,400,200")).toEqual({
      x: -50,
      y: -30,
      w: 400,
      h: 200,
    });
  });

  it("accepts decimals and scientific notation", () => {
    expect(parseViewportValue("12.5,80,1e3,600")).toEqual({
      x: 12.5,
      y: 80,
      w: 1000,
      h: 600,
    });
  });

  it("tolerates surrounding whitespace around components", () => {
    expect(parseViewportValue(" 120 , 80 , 900 , 600 ")).toEqual({
      x: 120,
      y: 80,
      w: 900,
      h: 600,
    });
  });

  it("does not itself decode percent-encoding (URLSearchParams does that upstream)", () => {
    // a literal %2C is not a comma at this layer -> one component -> rejected
    expect(parseViewportValue("120%2C80%2C900%2C600")).toBeNull();
  });

  it("returns null for malformed or degenerate input", () => {
    expect(parseViewportValue(null)).toBeNull();
    expect(parseViewportValue("")).toBeNull();
    expect(parseViewportValue("abc")).toBeNull();
    expect(parseViewportValue("120,80,900")).toBeNull(); // too few
    expect(parseViewportValue("120,80,900,600,10")).toBeNull(); // too many
    expect(parseViewportValue("120,,900,600")).toBeNull(); // empty component
    expect(parseViewportValue("120,80,0,600")).toBeNull(); // zero width
    expect(parseViewportValue("120,80,900,0")).toBeNull(); // zero height
    expect(parseViewportValue("120,80,-900,600")).toBeNull(); // negative width
    expect(parseViewportValue("120,80,900,-600")).toBeNull(); // negative height
    expect(parseViewportValue("120,80,NaN,600")).toBeNull();
    expect(parseViewportValue("120,80,Infinity,600")).toBeNull();
  });
});

describe("formatViewportParam", () => {
  it("serializes a rect into the full query param string", () => {
    expect(formatViewportParam({ x: 120, y: 80, w: 900, h: 600 })).toBe(
      "viewport=120,80,900,600",
    );
  });

  it("rounds fractional geometry to integers", () => {
    expect(formatViewportParam({ x: 120.4, y: 79.6, w: 899.5, h: 600.2 })).toBe(
      "viewport=120,80,900,600",
    );
  });

  it("round-trips through parseViewportValue for integer rects", () => {
    const rect = { x: -12, y: 34, w: 900, h: 600 };
    const value = formatViewportParam(rect).replace("viewport=", "");
    expect(parseViewportValue(value)).toEqual(rect);
  });
});
