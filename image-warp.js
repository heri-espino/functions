import {
  finiteBounds, inverse2x2, apply2x2, worldAtPixel, pixelAtWorld,
  worldToTexturePixel, sampleBilinear, fitBounds,
} from "./warp-core.js";

const $ = (id) => document.getElementById(id);
const controls = {
  mode: $("image-mode"), upload: $("warp-upload"), fileInfo: $("warp-file-description"),
  imageXmin: $("warp-image-xmin"), imageXmax: $("warp-image-xmax"),
  imageYmin: $("warp-image-ymin"), imageYmax: $("warp-image-ymax"),
  viewXmin: $("warp-view-xmin"), viewXmax: $("warp-view-xmax"),
  viewYmin: $("warp-view-ymin"), viewYmax: $("warp-view-ymax"),
  preset: $("warp-preset"), kind: $("warp-kind"),
  linearOptions: $("warp-linear-options"), separableOptions: $("warp-separable-options"),
  m11: $("warp-m11"), m12: $("warp-m12"), m21: $("warp-m21"), m22: $("warp-m22"),
  fx: $("warp-forward-x"), ifx: $("warp-inverse-x"),
  fy: $("warp-forward-y"), ify: $("warp-inverse-y"),
  grid: $("warp-grid"), resetPosition: $("warp-reset-position"),
  fitView: $("warp-fit-view"), sourceCanvas: $("warp-source"), outputCanvas: $("warp-output"),
  status: $("warp-status"), summary: $("warp-summary"), error: $("warp-error"), save: $("warp-save"),
};

const DEFAULT_BOUNDS = { xmin: -1, xmax: 1, ymin: -1, ymax: 1 };
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 440;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TEXTURE_SIDE = 2048;
let math = null;
let sourceData = null;
let sourceCanvas = null;
let sourceName = "";
let loadSequence = 0;
let drawQueued = false;
let dragging = null;
let validWarp = false;

const imageFields = [controls.imageXmin, controls.imageXmax, controls.imageYmin, controls.imageYmax];
const viewFields = [controls.viewXmin, controls.viewXmax, controls.viewYmin, controls.viewYmax];
const transformFields = [
  controls.m11, controls.m12, controls.m21, controls.m22,
  controls.fx, controls.ifx, controls.fy, controls.ify,
];

function showError(text = "") {
  controls.error.textContent = text;
  controls.error.classList.toggle("hidden", !text);
}

function format(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return String(Number(n.toFixed(5)));
}

function getBounds(fields, label) {
  const values = fields.map(field => {
    if (field.value.trim() === "") return NaN;
    return Number(field.value);
  });
  const bounds = { xmin: values[0], xmax: values[1], ymin: values[2], ymax: values[3] };
  if (!finiteBounds(bounds)) {
    throw new Error(label + ": los límites deben ser números finitos, con mínimo menor que máximo.");
  }
  return bounds;
}

function setBounds(fields, bounds) {
  fields.forEach((field, index) => {
    const keys = ["xmin", "xmax", "ymin", "ymax"];
    field.value = format(bounds[keys[index]]);
  });
}

function normalizeExpression(text) {
  return String(text).replace(/\bln\s*\(/gi, "log(").replace(/π/g, "pi").replace(/−/g, "-").trim();
}

function compileExpression(text, label) {
  if (!math) throw new Error("El evaluador matemático está cargando.");
  try {
    return math.compile(normalizeExpression(text));
  } catch (error) {
    throw new Error("No pude interpretar " + label + ".");
  }
}

function evaluateExpression(compiled, scope) {
  try {
    const raw = compiled.evaluate(scope);
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : NaN;
  } catch (error) {
    return NaN;
  }
}

function verifyAxis(forward, inverse, start, end, axisName) {
  // An inverse is unambiguous only if the map is one-to-one on this interval.
  let previous = null;
  let direction = 0;
  const tolerance = 1e-5 * Math.max(1, Math.abs(start), Math.abs(end), end - start);
  for (let i = 0; i <= 24; i += 1) {
    const x = start + (end - start) * i / 24;
    const mapped = forward(x);
    const recovered = inverse(mapped);
    if (!Number.isFinite(mapped) || !Number.isFinite(recovered)) {
      throw new Error(axisName + ": la función o su inversa está fuera de dominio en la imagen.");
    }
    if (Math.abs(recovered - x) > tolerance) {
      throw new Error(axisName + ": la inversa proporcionada no recupera las coordenadas originales.");
    }
    if (previous !== null) {
      const difference = mapped - previous;
      if (Math.abs(difference) <= 1e-12 * Math.max(1, Math.abs(mapped))) {
        throw new Error(axisName + ": la función no parece invertible en este intervalo.");
      }
      const sign = Math.sign(difference);
      if (direction !== 0 && sign !== direction) {
        throw new Error(axisName + ": la función no es monótona en este intervalo.");
      }
      direction = sign;
    }
    previous = mapped;
  }
}

function readWarp(imageBounds) {
  if (controls.kind.value === "linear") {
    const expressions = [controls.m11.value, controls.m12.value, controls.m21.value, controls.m22.value];
    const entries = expressions.map((value, index) =>
      evaluateExpression(compileExpression(value, "A[" + (Math.floor(index / 2) + 1) + "," + (index % 2 + 1) + "]"), {})
    );
    if (!entries.every(Number.isFinite)) throw new Error("La matriz debe contener números reales finitos.");
    const A = [[entries[0], entries[1]], [entries[2], entries[3]]];
    const inv = inverse2x2(A);
    if (!inv) throw new Error("La matriz es singular o demasiado cercana a singular; el muestreo inverso necesita A⁻¹.");
    return {
      forward: (x, y) => apply2x2(A, x, y),
      inverse: (u, v) => apply2x2(inv, u, v),
      kind: "linear",
      label: "T(x,y) = (" + format(entries[0]) + "x + " + format(entries[1]) + "y, " +
        format(entries[2]) + "x + " + format(entries[3]) + "y)",
    };
  }

  const forwardX = compileExpression(controls.fx.value, "φ(x)");
  const inverseX = compileExpression(controls.ifx.value, "φ⁻¹(u)");
  const forwardY = compileExpression(controls.fy.value, "ψ(y)");
  const inverseY = compileExpression(controls.ify.value, "ψ⁻¹(v)");

  const phi = x => evaluateExpression(forwardX, { x });
  const invPhi = u => evaluateExpression(inverseX, { u });
  const psi = y => evaluateExpression(forwardY, { y });
  const invPsi = v => evaluateExpression(inverseY, { v });
  verifyAxis(phi, invPhi, imageBounds.xmin, imageBounds.xmax, "Eje x");
  verifyAxis(psi, invPsi, imageBounds.ymin, imageBounds.ymax, "Eje y");
  return {
    kind: "separable",
    forward: (x, y) => [phi(x), psi(y)],
    inverse: (u, v) => [invPhi(u), invPsi(v)],
    invPhi, invPsi,
    label: "T(x,y) = (" + controls.fx.value + ", " + controls.fy.value + ")",
  };
}

function transformedBounds(sourceBounds, warp) {
  const points = [];
  const n = 32;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const x = sourceBounds.xmin + t * (sourceBounds.xmax - sourceBounds.xmin);
    const y = sourceBounds.ymin + t * (sourceBounds.ymax - sourceBounds.ymin);
    points.push(warp.forward(x, sourceBounds.ymin));
    points.push(warp.forward(x, sourceBounds.ymax));
    points.push(warp.forward(sourceBounds.xmin, y));
    points.push(warp.forward(sourceBounds.xmax, y));
  }
  const good = points.filter(p => p.length === 2 && p.every(Number.isFinite));
  if (good.length !== points.length) throw new Error("Parte del borde transformado está fuera de dominio.");
  let xmin = Math.min(...good.map(p => p[0]));
  let xmax = Math.max(...good.map(p => p[0]));
  let ymin = Math.min(...good.map(p => p[1]));
  let ymax = Math.max(...good.map(p => p[1]));
  const epsilon = 0.005;
  if (xmax - xmin < epsilon) { xmin -= epsilon; xmax += epsilon; }
  if (ymax - ymin < epsilon) { ymin -= epsilon; ymax += epsilon; }
  return { xmin, xmax, ymin, ymax };
}

function niceTickStep(range) {
  const raw = Math.max(range / 7, 1e-10);
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / power;
  const multiple = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return multiple * power;
}

function drawGrid(ctx, view) {
  if (!controls.grid.checked) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const stepX = niceTickStep(view.xmax - view.xmin);
  const stepY = niceTickStep(view.ymax - view.ymin);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(162,181,209,0.20)";
  ctx.fillStyle = "rgba(229,236,249,0.76)";
  ctx.font = "12px ui-monospace, Consolas, monospace";
  for (let i = Math.ceil(view.xmin / stepX); i * stepX <= view.xmax && i <= 100000; i++) {
    const x = i * stepX;
    const px = pixelAtWorld(x, 0, W, H, view)[0];
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    if (Math.abs(x) > stepX * 0.001) ctx.fillText(format(x), px + 3, H - 8);
  }
  for (let j = Math.ceil(view.ymin / stepY); j * stepY <= view.ymax && j <= 100000; j++) {
    const y = j * stepY;
    const py = pixelAtWorld(0, y, W, H, view)[1];
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
    if (Math.abs(y) > stepY * 0.001) ctx.fillText(format(y), 6, py - 5);
  }
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgba(246,250,255,0.74)";
  if (view.xmin <= 0 && view.xmax >= 0) {
    const px = pixelAtWorld(0, 0, W, H, view)[0];
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }
  if (view.ymin <= 0 && view.ymax >= 0) {
    const py = pixelAtWorld(0, 0, W, H, view)[1];
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }
  ctx.restore();
}

function paintCanvasGround(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#0b111f";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function paintSource(imageBounds, view) {
  const ctx = controls.sourceCanvas.getContext("2d", { willReadFrequently: false });
  paintCanvasGround(ctx);
  if (sourceCanvas) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const topLeft = pixelAtWorld(imageBounds.xmin, imageBounds.ymax, W, H, view);
    const bottomRight = pixelAtWorld(imageBounds.xmax, imageBounds.ymin, W, H, view);
    ctx.drawImage(sourceCanvas, topLeft[0], topLeft[1],
      bottomRight[0] - topLeft[0], bottomRight[1] - topLeft[1]);
    ctx.save();
    ctx.strokeStyle = "rgba(240,198,116,0.8)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(topLeft[0], topLeft[1],
      bottomRight[0] - topLeft[0], bottomRight[1] - topLeft[1]);
    ctx.restore();
  }
  drawGrid(ctx, view);
  if (!sourceCanvas) {
    ctx.fillStyle = "#d2ddec";
    ctx.textAlign = "center";
    ctx.font = "17px sans-serif";
    ctx.fillText("Sube una imagen para empezar", ctx.canvas.width / 2, ctx.canvas.height / 2);
  }
}

function paintOutput(imageBounds, view, warp) {
  const ctx = controls.outputCanvas.getContext("2d", { willReadFrequently: false });
  paintCanvasGround(ctx);
  if (!sourceData || !warp) {
    drawGrid(ctx, view);
    return;
  }
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const frame = ctx.createImageData(W, H);
  const image = frame.data;
  // In separable mode, inverse formulas are independent in each coordinate.
  // Precompute O(W + H) evaluations instead of O(W * H).
  const xInverse = warp.kind === "separable" ? new Float64Array(W) : null;
  const yInverse = warp.kind === "separable" ? new Float64Array(H) : null;
  if (xInverse) {
    for (let px = 0; px < W; px++) {
      const xp = view.xmin + (px + 0.5) / W * (view.xmax - view.xmin);
      xInverse[px] = warp.invPhi(xp);
    }
    for (let py = 0; py < H; py++) {
      const yp = view.ymax - (py + 0.5) / H * (view.ymax - view.ymin);
      yInverse[py] = warp.invPsi(yp);
    }
  }
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const point = xInverse
        ? [xInverse[px], yInverse[py]]
        : warp.inverse(...worldAtPixel(px, py, W, H, view));
      if (!point.every(Number.isFinite)) continue;
      const [sx, sy] = worldToTexturePixel(
        point[0], point[1], imageBounds, sourceData.width, sourceData.height
      );
      sampleBilinear(sourceData, sx, sy, image, (py * W + px) * 4);
    }
  }
  ctx.putImageData(frame, 0, 0);
  drawGrid(ctx, view);
}

function renderWarp() {
  drawQueued = false;
  if (controls.mode.classList.contains("hidden")) return;
  showError("");
  let imageBounds, view;
  try {
    imageBounds = getBounds(imageFields, "Imagen");
    view = getBounds(viewFields, "Vista");
    paintSource(imageBounds, view);
    const warp = readWarp(imageBounds);
    paintOutput(imageBounds, view, warp);
    controls.summary.textContent = warp.label;
    controls.status.textContent = sourceData ?
      sourceData.width + " × " + sourceData.height + " px · listo" : "Carga una imagen";
    validWarp = Boolean(sourceData);
    controls.save.disabled = !validWarp;
  } catch (error) {
    validWarp = false;
    controls.save.disabled = true;
    showError(error.message || "No se pudo dibujar la transformación.");
    controls.status.textContent = "Revisa los parámetros";
    paintCanvasGround(controls.outputCanvas.getContext("2d"));
    if (view && finiteBounds(view)) drawGrid(controls.outputCanvas.getContext("2d"), view);
  }
}

function requestRender() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(renderWarp);
}

function fitViewToWarp() {
  try {
    const image = getBounds(imageFields, "Imagen");
    const warp = readWarp(image);
    const after = transformedBounds(image, warp);
    setBounds(viewFields, fitBounds([image, after], CANVAS_WIDTH / CANVAS_HEIGHT, 0.12));
  } catch (error) {
    // Keep controls usable if a custom transformation is not yet valid.
    try {
      const image = getBounds(imageFields, "Imagen");
      setBounds(viewFields, fitBounds([image], CANVAS_WIDTH / CANVAS_HEIGHT, 0.12));
    } catch (_) {}
  }
  requestRender();
}

function toggleOptions() {
  const linear = controls.kind.value === "linear";
  controls.linearOptions.classList.toggle("hidden", !linear);
  controls.separableOptions.classList.toggle("hidden", linear);
}

function changePreset(name) {
  const matrix = {
    identity: ["1", "0", "0", "1"],
    rotate: ["cos(pi/6)", "-sin(pi/6)", "sin(pi/6)", "cos(pi/6)"],
    shear: ["1", "1", "0", "1"],
    stretch: ["2", "0", "0", "0.5"],
    reflect: ["1", "0", "0", "-1"],
  };

  if (matrix[name]) {
    controls.kind.value = "linear";
    [controls.m11, controls.m12, controls.m21, controls.m22].forEach((field, index) => {
      field.value = matrix[name][index];
    });
  } else if (name !== "custom") {
    controls.kind.value = "separable";
    controls.fx.value = (name === "logx" || name === "both") ? "ln(x)" : "x";
    controls.ifx.value = (name === "logx" || name === "both") ? "exp(u)" : "u";
    controls.fy.value = (name === "expy" || name === "both") ? "exp(y)" : "y";
    controls.ify.value = (name === "expy" || name === "both") ? "ln(v)" : "v";
    const bounds = getBounds(imageFields, "Imagen");
    if ((name === "logx" || name === "both") && bounds.xmin <= 0) {
      const span = bounds.xmax - bounds.xmin;
      setBounds(imageFields, { ...bounds, xmin: 0.5, xmax: 0.5 + span });
    }
  }
  toggleOptions();
  fitViewToWarp();
}

function defaultPosition() {
  const ratio = sourceData ? sourceData.width / sourceData.height : 1;
  const spanX = 3;
  const spanY = spanX / ratio;
  const xmin = controls.kind.value === "separable" &&
    (controls.fx.value.includes("log") || controls.fx.value.includes("ln")) ? 0.5 : -spanX / 2;
  setBounds(imageFields, { xmin, xmax: xmin + spanX, ymin: -spanY / 2, ymax: spanY / 2 });
  fitViewToWarp();
}

async function decodeImage(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("La imagen supera 25 MB; selecciona un archivo más pequeño.");
  const url = URL.createObjectURL(file);
  let image;
  try {
    image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("No se pudo abrir la imagen."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("La imagen está vacía.");
    const ratio = Math.min(1, MAX_TEXTURE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const texture = document.createElement("canvas");
    texture.width = width;
    texture.height = height;
    const ctx = texture.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    return { texture, data: ctx.getImageData(0, 0, width, height), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pointerWorld(event) {
  const canvas = controls.sourceCanvas;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * canvas.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height * canvas.height - 0.5;
  const view = getBounds(viewFields, "Vista");
  return worldAtPixel(x, y, canvas.width, canvas.height, view);
}

function bindDrag() {
  controls.sourceCanvas.addEventListener("pointerdown", event => {
    if (!sourceData || event.button !== 0) return;
    try {
      const point = pointerWorld(event);
      const bounds = getBounds(imageFields, "Imagen");
      if (point[0] < bounds.xmin || point[0] > bounds.xmax ||
          point[1] < bounds.ymin || point[1] > bounds.ymax) return;
      dragging = { pointerId: event.pointerId, start: point, bounds };
      controls.sourceCanvas.setPointerCapture(event.pointerId);
    } catch (_) {}
  });
  controls.sourceCanvas.addEventListener("pointermove", event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    try {
      const point = pointerWorld(event);
      const dx = point[0] - dragging.start[0];
      const dy = point[1] - dragging.start[1];
      const b = dragging.bounds;
      setBounds(imageFields, {
        xmin: b.xmin + dx, xmax: b.xmax + dx,
        ymin: b.ymin + dy, ymax: b.ymax + dy,
      });
      requestRender();
    } catch (_) {}
  });
  const end = event => {
    if (dragging && event.pointerId === dragging.pointerId) dragging = null;
  };
  controls.sourceCanvas.addEventListener("pointerup", end);
  controls.sourceCanvas.addEventListener("pointercancel", end);
  controls.sourceCanvas.addEventListener("lostpointercapture", () => { dragging = null; });
}

function bindEvents() {
  controls.upload.addEventListener("change", async () => {
    const file = controls.upload.files && controls.upload.files[0];
    if (!file) return;
    const seq = ++loadSequence;
    showError("");
    controls.status.textContent = "Abriendo imagen…";
    try {
      const decoded = await decodeImage(file);
      if (seq !== loadSequence) return;
      sourceCanvas = decoded.texture;
      sourceData = decoded.data;
      sourceName = file.name;
      controls.fileInfo.textContent = file.name + " · " + decoded.width + " × " + decoded.height +
        " px (el archivo no se envía a ningún servidor).";
      defaultPosition();
      window.dispatchEvent(new CustomEvent("functionmapper:image-loaded", {
        detail: { canvas: sourceCanvas, data: sourceData, name: sourceName },
      }));
    } catch (error) {
      if (seq === loadSequence) {
        showError(error.message);
        controls.status.textContent = "Error al abrir la imagen";
      }
    }
  });
  [...imageFields, ...viewFields, ...transformFields].forEach(field => {
    field.addEventListener("input", () => {
      if (transformFields.includes(field)) controls.preset.value = "custom";
      requestRender();
    });
  });
  controls.preset.addEventListener("change", () => {
    try { changePreset(controls.preset.value); }
    catch (error) { showError(error.message); }
  });
  controls.kind.addEventListener("change", () => {
    controls.preset.value = "custom";
    toggleOptions();
    requestRender();
  });
  controls.grid.addEventListener("change", requestRender);
  controls.resetPosition.addEventListener("click", defaultPosition);
  controls.fitView.addEventListener("click", fitViewToWarp);
  controls.save.addEventListener("click", () => {
    if (!validWarp) return;
    controls.outputCanvas.toBlob(blob => {
      if (!blob) {
        showError("No se pudo crear el archivo PNG.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = (sourceName.replace(/\.[^.]+$/, "") || "imagen") + "-warp.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  });
  bindDrag();
  window.addEventListener("functionmapper:image-loaded", (event) => {
    const shared = event.detail;
    if (!shared || shared.data === sourceData) return;
    sourceCanvas = shared.canvas;
    sourceData = shared.data;
    sourceName = shared.name || "imagen";
    controls.fileInfo.textContent = sourceName + " · imagen compartida entre modos";
    defaultPosition();
  });
  window.addEventListener("functionmapper:image-visible", requestRender);
}

async function initialize() {
  if (!controls.mode) return;
  bindEvents();
  toggleOptions();
  requestRender();
  try {
    const module = await import("https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm");
    math = module.default || module;
    requestRender();
  } catch (error) {
    showError("No se pudo cargar Math.js. Comprueba tu conexión a internet.");
    controls.status.textContent = "Sin evaluador matemático";
  }
}
initialize();
