/**
 * Pure geometry and sampling primitives used by the browser warp explorer.
 * World coordinates use mathematical +y upward; image pixels use +y downward.
 * No DOM dependencies: can be tested with Node's built-in test runner.
 */
export function finiteBounds(bounds) {
  const { xmin, xmax, ymin, ymax } = bounds;
  return [xmin, xmax, ymin, ymax].every(Number.isFinite) &&
    xmax > xmin && ymax > ymin;
}

export function inverse2x2(A) {
  if (!Array.isArray(A) || A.length !== 2 || A.some(row => !Array.isArray(row) || row.length !== 2)) {
    return null;
  }
  const [a, b] = A[0];
  const [c, d] = A[1];
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const det = a * d - b * c;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (scale === 0 || !Number.isFinite(det) || Math.abs(det) <= 1e-12 * scale * scale) return null;
  return [[d / det, -b / det], [-c / det, a / det]];
}

export function apply2x2(A, x, y) {
  return [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y];
}

export function worldAtPixel(px, py, width, height, bounds) {
  // Sampling at pixel centers reduces systematic half-pixel shifts.
  return [
    bounds.xmin + (px + 0.5) / width * (bounds.xmax - bounds.xmin),
    bounds.ymax - (py + 0.5) / height * (bounds.ymax - bounds.ymin),
  ];
}

export function pixelAtWorld(x, y, width, height, bounds) {
  return [
    (x - bounds.xmin) / (bounds.xmax - bounds.xmin) * width,
    (bounds.ymax - y) / (bounds.ymax - bounds.ymin) * height,
  ];
}

export function worldToTexturePixel(x, y, sourceBounds, textureWidth, textureHeight) {
  // Pixel-center convention: the outside of the image maps to the boundary.
  const u = (x - sourceBounds.xmin) / (sourceBounds.xmax - sourceBounds.xmin);
  const v = (sourceBounds.ymax - y) / (sourceBounds.ymax - sourceBounds.ymin);
  return [u * textureWidth - 0.5, v * textureHeight - 0.5];
}

/**
 * Interpolate in premultiplied alpha to avoid dark fringes around transparent
 * images. Writes four uint8 channels at offset; defaults to transparent.
 */
export function sampleBilinear(source, sx, sy, out, offset) {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
      sx < -0.5 || sy < -0.5 ||
      sx > source.width - 0.5 || sy > source.height - 0.5) return;

  const width = source.width;
  const height = source.height;
  const data = source.data;
  const fx = Math.max(0, Math.min(width - 1, sx));
  const fy = Math.max(0, Math.min(height - 1, sy));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = fx - x0;
  const dy = fy - y0;
  const corners = [
    [4 * (y0 * width + x0), (1 - dx) * (1 - dy)],
    [4 * (y0 * width + x1), dx * (1 - dy)],
    [4 * (y1 * width + x0), (1 - dx) * dy],
    [4 * (y1 * width + x1), dx * dy],
  ];
  let a = 0, r = 0, g = 0, b = 0;
  for (const [i, w] of corners) {
    const alpha = data[i + 3] * w;
    a += alpha;
    r += data[i] * alpha;
    g += data[i + 1] * alpha;
    b += data[i + 2] * alpha;
  }
  if (a === 0) return;
  out[offset] = Math.round(r / a);
  out[offset + 1] = Math.round(g / a);
  out[offset + 2] = Math.round(b / a);
  out[offset + 3] = Math.round(a);
}

export function fitBounds(boundsList, aspect = 640 / 440, padding = 0.12) {
  const good = boundsList.filter(finiteBounds);
  if (!good.length) return { xmin: -3, xmax: 3, ymin: -2, ymax: 2 };
  let xmin = Math.min(...good.map(b => b.xmin));
  let xmax = Math.max(...good.map(b => b.xmax));
  let ymin = Math.min(...good.map(b => b.ymin));
  let ymax = Math.max(...good.map(b => b.ymax));
  const centerX = (xmin + xmax) / 2;
  const centerY = (ymin + ymax) / 2;
  let sx = Math.max(xmax - xmin, 0.1) * (1 + 2 * padding);
  let sy = Math.max(ymax - ymin, 0.1) * (1 + 2 * padding);
  if (sx / sy > aspect) sy = sx / aspect;
  else sx = sy * aspect;
  xmin = centerX - sx / 2;
  xmax = centerX + sx / 2;
  ymin = centerY - sy / 2;
  ymax = centerY + sy / 2;
  return { xmin, xmax, ymin, ymax };
}
