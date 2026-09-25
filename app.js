const root = document;

const ui = {
  functionList: root.getElementById("function-list"),
  addFunction: root.getElementById("add-function"),
  xmin: root.getElementById("x-min"),
  xmax: root.getElementById("x-max"),
  lockXlim: root.getElementById("lock-xlim"),
  count: root.getElementById("point-count"),
  extraPoints: root.getElementById("extra-points"),
  clearExtra: root.getElementById("clear-extra"),
  colorMode: root.getElementById("color-mode"),
  palette: root.getElementById("palette"),
  palettePreview: root.getElementById("palette-preview"),
  play: root.getElementById("play-animation"),
  progress: root.getElementById("animation-progress"),
  progressValue: root.getElementById("animation-value"),
  animationStage: root.getElementById("animation-stage"),
  speed: root.getElementById("animation-speed"),
  svg: root.getElementById("mapping-svg"),
  status: root.getElementById("status"),
  title: root.getElementById("map-title"),
  error: root.getElementById("error-box"),
  metricX: root.getElementById("metric-x"),
  metricY: root.getElementById("metric-y"),
  metricD: root.getElementById("metric-d"),
  metricOrientation: root.getElementById("metric-orientation"),
};

const SVG_NS = "http://www.w3.org/2000/svg";
const SYMBOLS = ["f", "g", "h", "k", "m", "n"];
const STAGE_COLORS = ["#d75452", "#7057c8", "#2aa198", "#d3a13b", "#4b8ed1", "#c75ea8"];

const PALETTES = {
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  cividis: ["#00204c", "#31446b", "#666970", "#958f78", "#c8b568", "#ffe945"],
  turbo: ["#30123b", "#4666e6", "#28bbec", "#32f298", "#a4fc3c", "#f9ba38", "#e85b17", "#7a0403"],
};

let math = null;
let functionsState = [
  { symbol: "f", expression: "x^2" },
  { symbol: "g", expression: "x + 1" },
];
let customPoints = [];
let selectedX = 0;
let animationProgress = 0;
let animationFrame = null;
let animationPlaying = false;
let lastAnimationTime = null;

function svgElement(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  const safeAttrs = attrs || {};
  Object.entries(safeAttrs).forEach(function (entry) {
    node.setAttribute(entry[0], String(entry[1]));
  });
  return node;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 10000 || magnitude < 0.001)) {
    return value.toExponential(3);
  }
  return Number(value.toFixed(5)).toString();
}

function normalizeExpression(expression) {
  return String(expression)
    .replace(/\bln\s*\(/gi, "log(")
    .replace(/π/g, "pi")
    .replace(/−/g, "-")
    .trim();
}

function showError(message) {
  const text = message || "";
  ui.error.textContent = text;
  ui.error.classList.toggle("hidden", !text);
}

function evaluate(compiled, x) {
  try {
    const raw = compiled.evaluate({ x: x });
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : NaN;
  } catch (error) {
    return NaN;
  }
}

function numericDerivative(fn, x) {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  const left = fn(x - h);
  const right = fn(x + h);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return NaN;
  return (right - left) / (2 * h);
}

function parseRange() {
  let xmin = Number(ui.xmin.value);
  let xmax = Number(ui.xmax.value);
  let count = Math.round(Number(ui.count.value));

  if (!Number.isFinite(xmin)) xmin = -1;
  if (!Number.isFinite(xmax)) xmax = 1;
  if (xmax <= xmin) xmax = xmin + 1;
  if (!Number.isFinite(count)) count = 15;

  count = clamp(count, 2, 101);

  ui.xmin.value = xmin;
  ui.xmax.value = xmax;
  ui.count.value = count;

  return { xmin: xmin, xmax: xmax, count: count };
}

function parseExtraPoints(text) {
  const parts = String(text || "")
    .split(/[\s,;]+/)
    .map(function (part) { return Number(part); })
    .filter(Number.isFinite);

  const unique = [];
  parts.forEach(function (value) {
    if (!unique.some(function (existing) { return Math.abs(existing - value) < 1e-10; })) {
      unique.push(value);
    }
  });
  return unique;
}

function buildPoints(xmin, xmax, count) {
  const uniform = Array.from({ length: count }, function (_, index) {
    return xmin + ((xmax - xmin) * index) / (count - 1);
  });

  const all = uniform.concat(customPoints);
  const unique = [];

  all.forEach(function (value) {
    if (!Number.isFinite(value)) return;
    if (!unique.some(function (existing) { return Math.abs(existing - value) < 1e-10; })) {
      unique.push(value);
    }
  });

  return unique.sort(function (a, b) { return a - b; });
}

function nearestPoint(points, target) {
  if (!points.length) return NaN;
  let best = points[0];
  let bestDistance = Math.abs(best - target);
  points.forEach(function (value) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  });
  return best;
}

function makeFixedScale(min, max, left, right) {
  return {
    min: min,
    max: max,
    project: function (value) {
      return left + ((value - min) / (max - min)) * (right - left);
    },
    invert: function (pixel) {
      return min + ((pixel - left) / (right - left)) * (max - min);
    },
  };
}

function makeAutoScale(values, left, right, fallbackMin, fallbackMax) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return makeFixedScale(fallbackMin, fallbackMax, left, right);

  let min = Math.min.apply(null, finite);
  let max = Math.max.apply(null, finite);

  if (min === max) {
    const delta = Math.max(1, Math.abs(min) * 0.2);
    min -= delta;
    max += delta;
  } else {
    const padding = (max - min) * 0.08;
    min -= padding;
    max += padding;
  }

  return makeFixedScale(min, max, left, right);
}

function linearTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  return Array.from({ length: count }, function (_, index) {
    return min + ((max - min) * index) / (count - 1);
  });
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(rgb) {
  function part(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  }
  return "#" + part(rgb.r) + part(rgb.g) + part(rgb.b);
}

function paletteColor(name, t) {
  const anchors = PALETTES[name] || PALETTES.viridis;
  const u = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  const scaled = u * (anchors.length - 1);
  const index = Math.min(Math.floor(scaled), anchors.length - 2);
  const local = scaled - index;
  const a = hexToRgb(anchors[index]);
  const b = hexToRgb(anchors[index + 1]);
  return rgbToHex({
    r: a.r + (b.r - a.r) * local,
    g: a.g + (b.g - a.g) * local,
    b: a.b + (b.b - a.b) * local,
  });
}

function updatePalettePreview() {
  const anchors = PALETTES[ui.palette.value] || PALETTES.viridis;
  ui.palettePreview.style.background = "linear-gradient(90deg, " + anchors.join(", ") + ")";
  ui.palette.disabled = ui.colorMode.value !== "gradient";
  ui.palette.style.opacity = ui.palette.disabled ? "0.55" : "1";
}

function trajectoryColor(x, stageIndex, xmin, xmax) {
  if (ui.colorMode.value === "gradient") {
    const t = xmax === xmin ? 0.5 : (x - xmin) / (xmax - xmin);
    return paletteColor(ui.palette.value, t);
  }
  return STAGE_COLORS[stageIndex % STAGE_COLORS.length];
}

function stagePointColor(x, stageIndex, xmin, xmax) {
  if (ui.colorMode.value === "gradient") {
    return trajectoryColor(x, stageIndex, xmin, xmax);
  }
  if (stageIndex === 0) return "#f4f7fb";
  return STAGE_COLORS[(stageIndex - 1) % STAGE_COLORS.length];
}

function stageLabels() {
  const labels = ["x"];
  let current = "x";
  functionsState.forEach(function (item) {
    current = item.symbol + "(" + current + ")";
    labels.push(current);
  });
  return labels;
}

function compositionName() {
  if (functionsState.length === 1) return functionsState[0].symbol;
  return functionsState
    .map(function (item) { return item.symbol; })
    .reverse()
    .join("∘");
}

function renderFunctionList() {
  ui.functionList.innerHTML = "";

  functionsState.forEach(function (item, index) {
    const row = document.createElement("div");
    row.className = "function-row";

    const swatch = document.createElement("span");
    swatch.className = "function-color";
    swatch.style.background = STAGE_COLORS[index % STAGE_COLORS.length];
    swatch.setAttribute("aria-hidden", "true");

    const expressionWrap = document.createElement("div");
    expressionWrap.className = "function-expression";

    const prefix = document.createElement("span");
    prefix.className = "function-prefix";
    prefix.textContent = item.symbol + "(x) =";

    const input = document.createElement("input");
    input.className = "function-input";
    input.value = item.expression;
    input.placeholder = "x";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", item.symbol + " de x");

    input.addEventListener("input", function () {
      functionsState[index].expression = input.value;
      stopAnimation(false);
      render();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-function";
    remove.textContent = "×";
    remove.title = "Eliminar función";
    remove.setAttribute("aria-label", "Eliminar " + item.symbol);
    remove.disabled = functionsState.length <= 1;
    remove.addEventListener("click", function () {
      if (functionsState.length <= 1) return;
      functionsState.splice(index, 1);
      functionsState.forEach(function (fn, i) { fn.symbol = SYMBOLS[i]; });
      stopAnimation(true);
      renderFunctionList();
      render();
    });

    expressionWrap.appendChild(prefix);
    expressionWrap.appendChild(input);
    row.appendChild(swatch);
    row.appendChild(expressionWrap);
    row.appendChild(remove);
    ui.functionList.appendChild(row);
  });

  ui.addFunction.disabled = functionsState.length >= SYMBOLS.length;
  ui.addFunction.title = ui.addFunction.disabled ? "Máximo de " + SYMBOLS.length + " funciones" : "Agregar función";
}

function compileFunctions() {
  const compiled = [];

  for (let i = 0; i < functionsState.length; i += 1) {
    const item = functionsState[i];
    try {
      compiled.push(math.compile(normalizeExpression(item.expression)));
    } catch (error) {
      throw new Error("No pude interpretar " + item.symbol + "(x). Revisa la expresión.");
    }
  }
  return compiled;
}

function buildStages(xs, compiled) {
  const stages = [xs.slice()];

  compiled.forEach(function (fn) {
    const previous = stages[stages.length - 1];
    stages.push(
      previous.map(function (value) {
        return Number.isFinite(value) ? evaluate(fn, value) : NaN;
      }),
    );
  });

  return stages;
}

function clearSvg() {
  while (ui.svg.firstChild) ui.svg.removeChild(ui.svg.firstChild);
}

function drawAxis(y, label, scale, color, clickable, inputScale) {
  const left = 92;
  const right = 918;

  const base = svgElement("line", {
    x1: left,
    y1: y,
    x2: right,
    y2: y,
    stroke: color,
    "stroke-width": 1.6,
  });
  ui.svg.appendChild(base);

  if (clickable) {
    const hit = svgElement("line", {
      x1: left,
      y1: y,
      x2: right,
      y2: y,
      stroke: "transparent",
      "stroke-width": 24,
      cursor: "crosshair",
    });

    hit.addEventListener("click", function (event) {
      const rect = ui.svg.getBoundingClientRect();
      const viewBox = ui.svg.viewBox.baseVal;
      const svgX = ((event.clientX - rect.left) / rect.width) * viewBox.width;
      const value = inputScale.invert(svgX);
      customPoints.push(value);
      customPoints = parseExtraPoints(customPoints.join(","));
      ui.extraPoints.value = customPoints.map(formatNumber).join(", ");
      selectedX = value;
      stopAnimation(false);
      render();
    });

    ui.svg.appendChild(hit);
  }

  const labelNode = svgElement("text", {
    x: 24,
    y: y + 6,
    fill: "#dfe7f6",
    "font-size": 18,
    "font-family": "STIX Two Math, Cambria Math, Times New Roman, serif",
    "font-style": label === "x" ? "italic" : "normal",
  });
  labelNode.textContent = label;
  ui.svg.appendChild(labelNode);

  linearTicks(scale.min, scale.max, 5).forEach(function (value) {
    const x = scale.project(value);
    const tick = svgElement("line", {
      x1: x,
      y1: y - 5,
      x2: x,
      y2: y + 5,
      stroke: "#99a6bc",
      "stroke-width": 1,
      "stroke-opacity": 0.72,
    });
    ui.svg.appendChild(tick);

    const text = svgElement("text", {
      x: x,
      y: y + 22,
      fill: "#8996aa",
      "font-size": 11,
      "text-anchor": "middle",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
    });
    text.textContent = formatNumber(value);
    ui.svg.appendChild(text);
  });
}

function drawConnection(x1, y1, x2, y2, color, selected) {
  const line = svgElement("line", {
    x1: x1,
    y1: y1,
    x2: x2,
    y2: y2,
    stroke: selected ? "#ffffff" : color,
    "stroke-width": selected ? 3 : 1.35,
    "stroke-opacity": selected ? 0.96 : 0.42,
    "stroke-linecap": "round",
    "clip-path": "url(#plot-clip)",
  });
  ui.svg.appendChild(line);
}

function drawPoint(px, py, color, xValue, selected, selectable) {
  const circle = svgElement("circle", {
    cx: px,
    cy: py,
    r: selected ? 6.2 : 4.1,
    fill: selected ? "#ffffff" : color,
    stroke: selected ? color : "none",
    "stroke-width": selected ? 2.4 : 0,
    "clip-path": "url(#plot-clip)",
  });

  if (selectable) {
    circle.style.cursor = "pointer";
    circle.setAttribute("tabindex", "0");
    circle.setAttribute("role", "button");
    circle.setAttribute("aria-label", "Seleccionar x = " + formatNumber(xValue));

    const choose = function (event) {
      if (event) event.stopPropagation();
      selectedX = xValue;
      render();
    };

    circle.addEventListener("click", choose);
    circle.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose(event);
      }
    });
  }

  ui.svg.appendChild(circle);
}

function addClipPath(height) {
  const defs = svgElement("defs");
  const clip = svgElement("clipPath", { id: "plot-clip" });
  clip.appendChild(svgElement("rect", {
    x: 92,
    y: 0,
    width: 826,
    height: height,
  }));
  defs.appendChild(clip);
  ui.svg.appendChild(defs);
}

function composedEvaluator(compiled) {
  return function (x) {
    let value = x;
    for (let i = 0; i < compiled.length; i += 1) {
      if (!Number.isFinite(value)) return NaN;
      value = evaluate(compiled[i], value);
    }
    return value;
  };
}

function updateMetrics(xs, stages, compiled, labels) {
  selectedX = nearestPoint(xs, selectedX);
  const index = xs.findIndex(function (value) { return Math.abs(value - selectedX) < 1e-9; });
  const finalValue = index >= 0 ? stages[stages.length - 1][index] : NaN;
  const finalLabel = labels[labels.length - 1];
  const derivative = numericDerivative(composedEvaluator(compiled), selectedX);

  ui.metricX.textContent = "x = " + formatNumber(selectedX);
  ui.metricY.textContent = finalLabel + " = " + formatNumber(finalValue);
  ui.metricD.textContent = "|" + compositionName() + "′(x)| ≈ " + formatNumber(Math.abs(derivative));

  if (!Number.isFinite(derivative)) {
    ui.metricOrientation.textContent = "derivada no disponible aquí";
  } else if (Math.abs(derivative) < 1e-8) {
    ui.metricOrientation.textContent = "aplanamiento local";
  } else if (derivative < 0) {
    ui.metricOrientation.textContent = "orientación total invertida";
  } else {
    ui.metricOrientation.textContent = "orientación total preservada";
  }
}

function drawAnimatedParticles(xs, stages, scales, yPositions, xmin, xmax) {
  const segments = stages.length - 1;
  if (segments <= 0) return;

  const total = clamp(animationProgress, 0, 1) * segments;
  let segment = Math.floor(total);
  let local = total - segment;

  if (animationProgress >= 1) {
    segment = segments - 1;
    local = 1;
  }

  const labels = stageLabels();
  if (animationProgress >= 1) {
    ui.animationStage.textContent = labels[labels.length - 1];
  } else {
    ui.animationStage.textContent = labels[segment] + " → " + labels[segment + 1];
  }

  xs.forEach(function (xValue, pointIndex) {
    const startValue = stages[segment][pointIndex];
    const endValue = stages[segment + 1][pointIndex];
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return;

    const x1 = scales[segment].project(startValue);
    const x2 = scales[segment + 1].project(endValue);
    const y1 = yPositions[segment];
    const y2 = yPositions[segment + 1];
    const px = x1 + (x2 - x1) * local;
    const py = y1 + (y2 - y1) * local;
    const color = trajectoryColor(xValue, segment, xmin, xmax);

    const particle = svgElement("circle", {
      cx: px,
      cy: py,
      r: 5.4,
      fill: color,
      stroke: "#ffffff",
      "stroke-width": 1.2,
      "stroke-opacity": 0.75,
      "clip-path": "url(#plot-clip)",
    });
    ui.svg.appendChild(particle);
  });
}

function updateProgressUi() {
  ui.progress.value = Math.round(animationProgress * 1000);
  ui.progressValue.textContent = Math.round(animationProgress * 100) + "%";
}

function render() {
  if (!math) return;

  showError("");
  updatePalettePreview();

  const range = parseRange();
  customPoints = parseExtraPoints(ui.extraPoints.value);
  const xs = buildPoints(range.xmin, range.xmax, range.count);

  let compiled;
  try {
    compiled = compileFunctions();
  } catch (error) {
    showError(error.message);
    ui.status.textContent = "Expresión inválida";
    return;
  }

  const stages = buildStages(xs, compiled);
  const labels = stageLabels();
  const stageCount = stages.length;
  const left = 92;
  const right = 918;
  const rowGap = 112;
  const top = 70;
  const height = top + (stageCount - 1) * rowGap + 72;
  const yPositions = Array.from({ length: stageCount }, function (_, index) {
    return top + index * rowGap;
  });

  ui.svg.setAttribute("viewBox", "0 0 960 " + height);
  clearSvg();
  addClipPath(height);

  const inputScale = makeFixedScale(range.xmin, range.xmax, left, right);
  const scales = stages.map(function (values, index) {
    if (index === 0 || ui.lockXlim.checked) {
      return makeFixedScale(range.xmin, range.xmax, left, right);
    }
    return makeAutoScale(values, left, right, range.xmin, range.xmax);
  });

  labels.forEach(function (label, index) {
    const axisColor = index === 0 ? "#3a4966" : STAGE_COLORS[(index - 1) % STAGE_COLORS.length];
    drawAxis(
      yPositions[index],
      label,
      scales[index],
      axisColor,
      index === 0,
      inputScale,
    );
  });

  for (let stageIndex = 0; stageIndex < stageCount - 1; stageIndex += 1) {
    xs.forEach(function (xValue, pointIndex) {
      const startValue = stages[stageIndex][pointIndex];
      const endValue = stages[stageIndex + 1][pointIndex];
      if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return;

      const x1 = scales[stageIndex].project(startValue);
      const x2 = scales[stageIndex + 1].project(endValue);
      const selected = Math.abs(xValue - selectedX) < 1e-9;
      const color = trajectoryColor(xValue, stageIndex, range.xmin, range.xmax);

      drawConnection(
        x1,
        yPositions[stageIndex] + 7,
        x2,
        yPositions[stageIndex + 1] - 7,
        color,
        selected,
      );
    });
  }

  stages.forEach(function (values, stageIndex) {
    xs.forEach(function (xValue, pointIndex) {
      const value = values[pointIndex];
      if (!Number.isFinite(value)) return;

      const px = scales[stageIndex].project(value);
      const selected = Math.abs(xValue - selectedX) < 1e-9;
      const color = stagePointColor(xValue, stageIndex, range.xmin, range.xmax);

      drawPoint(
        px,
        yPositions[stageIndex],
        color,
        xValue,
        selected,
        stageIndex === 0,
      );
    });
  });

  drawAnimatedParticles(xs, stages, scales, yPositions, range.xmin, range.xmax);
  updateProgressUi();

  const finalStage = stages[stages.length - 1];
  const finiteFinal = finalStage.filter(Number.isFinite).length;
  const clipped = ui.lockXlim.checked
    ? finalStage.filter(function (value) {
        return Number.isFinite(value) && (value < range.xmin || value > range.xmax);
      }).length
    : 0;

  ui.title.textContent = labels.join(" → ");
  ui.status.textContent =
    xs.length + " puntos · " +
    finiteFinal + " llegan al final" +
    (clipped ? " · " + clipped + " fuera del xlim final" : "");

  updateMetrics(xs, stages, compiled, labels);
}

function stopAnimation(reset) {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  animationPlaying = false;
  lastAnimationTime = null;
  ui.play.textContent = "▶ Reproducir";

  if (reset) {
    animationProgress = 0;
    updateProgressUi();
  }
}

function animationTick(timestamp) {
  if (!animationPlaying) return;

  if (lastAnimationTime === null) lastAnimationTime = timestamp;
  const dt = timestamp - lastAnimationTime;
  lastAnimationTime = timestamp;

  const speed = Number(ui.speed.value) || 1;
  const segmentCount = Math.max(1, functionsState.length);
  const duration = (1400 * segmentCount) / speed;
  animationProgress += dt / duration;

  if (animationProgress >= 1) {
    animationProgress = 1;
    render();
    stopAnimation(false);
    return;
  }

  render();
  animationFrame = requestAnimationFrame(animationTick);
}

function toggleAnimation() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    animationProgress = 1;
    render();
    return;
  }

  if (animationPlaying) {
    stopAnimation(false);
    return;
  }

  if (animationProgress >= 1) animationProgress = 0;

  animationPlaying = true;
  lastAnimationTime = null;
  ui.play.textContent = "❚❚ Pausa";
  animationFrame = requestAnimationFrame(animationTick);
}

function bindControls() {
  ui.addFunction.addEventListener("click", function () {
    if (functionsState.length >= SYMBOLS.length) return;
    const index = functionsState.length;
    functionsState.push({ symbol: SYMBOLS[index], expression: "x" });
    stopAnimation(true);
    renderFunctionList();
    render();

    const inputs = ui.functionList.querySelectorAll(".function-input");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  [ui.xmin, ui.xmax, ui.count].forEach(function (control) {
    control.addEventListener("input", function () {
      stopAnimation(false);
      render();
    });
  });

  ui.lockXlim.addEventListener("change", render);

  ui.extraPoints.addEventListener("input", function () {
    customPoints = parseExtraPoints(ui.extraPoints.value);
    stopAnimation(false);
    render();
  });

  ui.clearExtra.addEventListener("click", function () {
    customPoints = [];
    ui.extraPoints.value = "";
    render();
  });

  ui.colorMode.addEventListener("change", render);
  ui.palette.addEventListener("change", render);

  ui.progress.addEventListener("input", function () {
    stopAnimation(false);
    animationProgress = Number(ui.progress.value) / 1000;
    render();
  });

  ui.play.addEventListener("click", toggleAnimation);
  ui.speed.addEventListener("change", function () {
    lastAnimationTime = null;
  });
}

async function boot() {
  renderFunctionList();
  bindControls();
  updatePalettePreview();

  try {
    const module = await import("https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm");
    math = module.default || module;
    ui.status.textContent = "Listo";
    render();
  } catch (error) {
    console.error(error);
    showError("No se pudo cargar Math.js. Comprueba tu conexión a internet y recarga la página.");
    ui.status.textContent = "Error al cargar Math.js";
  }
}

boot();
