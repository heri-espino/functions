import test from "node:test";
import assert from "node:assert/strict";
import {
  finiteBounds, inverse2x2, apply2x2, worldAtPixel, pixelAtWorld,
  worldToTexturePixel, sampleBilinear, fitBounds,
} from "../warp-core.js";

const approx = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Number.isFinite(actual), "value must be finite");
  assert.ok(Math.abs(actual - expected) < tolerance, actual + " ≉ " + expected);
};

test("matrix inversion: identity, rotation, shear, reflection", () => {
  for (const A of [
    [[1, 0], [0, 1]],
    [[0, -1], [1, 0]],
    [[1, 2], [0, 1]],
    [[-1, 0], [0, 1]],
  ]) {
    const inverse = inverse2x2(A);
    assert.ok(inverse);
    const image = apply2x2(A, 1.25, -1.5);
    const recovered = apply2x2(inverse, ...image);
    approx(recovered[0], 1.25);
    approx(recovered[1], -1.5);
  }
});

test("singular and invalid matrices are rejected", () => {
  assert.equal(inverse2x2([[1, 2], [2, 4]]), null);
  assert.equal(inverse2x2([[0, 0], [0, 0]]), null);
  assert.equal(inverse2x2([[1, NaN], [0, 1]]), null);
});

test("world-to-pixel convention uses y-up and pixel centers", () => {
  const bounds = { xmin: -2, xmax: 3, ymin: -1, ymax: 4 };
  for (const [px, py] of [[0, 0], [320, 220], [639, 439]]) {
    const [x, y] = worldAtPixel(px, py, 640, 440, bounds);
    const [xx, yy] = pixelAtWorld(x, y, 640, 440, bounds);
    approx(xx, px + 0.5);
    approx(yy, py + 0.5);
  }
});

test("image placement corresponds to texture center", () => {
  const bounds = { xmin: -1, xmax: 1, ymin: -1, ymax: 1 };
  const uv = worldToTexturePixel(0, 0, bounds, 100, 100);
  approx(uv[0], 49.5);
  approx(uv[1], 49.5);
});

test("bilinear filtering blends opaque pixels", () => {
  const source = {
    width: 2, height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
  };
  const result = new Uint8ClampedArray(4);
  sampleBilinear(source, 0.5, 0, result, 0);
  assert.deepEqual([...result], [128, 0, 128, 255]);
});

test("bilinear filtering respects premultiplied alpha", () => {
  const source = {
    width: 2, height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
  };
  const result = new Uint8ClampedArray(4);
  sampleBilinear(source, 0.5, 0, result, 0);
  assert.deepEqual([...result], [255, 0, 0, 128]);
});

test("out-of-image pixels are transparent", () => {
  const source = {
    width: 1, height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255]),
  };
  const result = new Uint8ClampedArray(4);
  sampleBilinear(source, 4, 4, result, 0);
  assert.deepEqual([...result], [0, 0, 0, 0]);
});

test("fitBounds maintains world-unit aspect ratio", () => {
  assert.equal(finiteBounds({ xmin: 0, xmax: 1, ymin: 0, ymax: 2 }), true);
  assert.equal(finiteBounds({ xmin: 1, xmax: 0, ymin: 0, ymax: 2 }), false);
  const fitted = fitBounds([{ xmin: 0, xmax: 2, ymin: 0, ymax: 1 }], 640 / 440);
  approx((fitted.xmax - fitted.xmin) / (fitted.ymax - fitted.ymin), 640 / 440);
  assert.ok(fitted.xmin < 0 && fitted.xmax > 2);
});
