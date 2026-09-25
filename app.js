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
    if (linearUi && !linearUi.mode.classList.contains("hidden")) renderLinear();
  } catch (error) {
    console.error(error);
    showError("No se pudo cargar Math.js. Comprueba tu conexión a internet y recarga la página.");
    ui.status.textContent = "Error al cargar Math.js";
  }
}

boot();


/* ========================================================================== */
/* Linear transformations explorer                                            */
/* ========================================================================== */

const linearUi = {
  mode: document.getElementById("linear-mode"),
  functionsMode: document.getElementById("functions-mode"),
  tabFunctions: document.getElementById("tab-functions"),
  tabLinear: document.getElementById("tab-linear"),
  dimension: document.getElementById("linear-dimension"),
  preset: document.getElementById("linear-preset"),
  matrix: document.getElementById("linear-matrix"),
  reset: document.getElementById("linear-reset"),
  parameterRow: document.getElementById("linear-parameter-row"),
  parameterLabel: document.getElementById("linear-parameter-label"),
  parameter: document.getElementById("linear-parameter"),
  showGrid: document.getElementById("linear-show-grid"),
  showBasis: document.getElementById("linear-show-basis"),
  showEigen: document.getElementById("linear-show-eigen"),
  eigenInfo: document.getElementById("linear-eigen-info"),
  error: document.getElementById("linear-error-box"),
  svg: document.getElementById("linear-svg"),
  title: document.getElementById("linear-title"),
  status: document.getElementById("linear-status"),
  det: document.getElementById("linear-det"),
  trace: document.getElementById("linear-trace"),
  rank: document.getElementById("linear-rank"),
  eigenvalues: document.getElementById("linear-eigenvalues"),
};

const LINEAR_PRESETS = {
  1: [
    { id: "identity", label: "Identidad I", matrix: function () { return [["1"]]; } },
    {
      id: "scalar",
      label: "Escalar λI",
      parameter: { label: "λ", value: 2, step: 0.1 },
      matrix: function (p) { return [[String(p)]]; },
    },
    { id: "reflection", label: "Reflexión x ↦ −x", matrix: function () { return [["-1"]]; } },
    { id: "zero", label: "Matriz cero", matrix: function () { return [["0"]]; } },
  ],
  2: [
    { id: "identity", label: "Identidad I", matrix: function () { return [["1", "0"], ["0", "1"]]; } },
    {
      id: "scalar",
      label: "Escalar λI",
      parameter: { label: "λ", value: 2, step: 0.1 },
      matrix: function (p) { return [[String(p), "0"], ["0", String(p)]]; },
    },
    {
      id: "rotation",
      label: "Rotación R(θ)",
      parameter: { label: "θ (grados)", value: 45, step: 1 },
      matrix: function (p) {
        const a = String(p) + "*pi/180";
        return [["cos(" + a + ")", "-sin(" + a + ")"], ["sin(" + a + ")", "cos(" + a + ")"]];
      },
    },
    {
      id: "complex_i",
      label: "Multiplicación por i (90°)",
      matrix: function () { return [["0", "-1"], ["1", "0"]]; },
    },
    {
      id: "shear_x",
      label: "Shear horizontal",
      parameter: { label: "k", value: 1, step: 0.1 },
      matrix: function (p) { return [["1", String(p)], ["0", "1"]]; },
    },
    {
      id: "shear_y",
      label: "Shear vertical",
      parameter: { label: "k", value: 1, step: 0.1 },
      matrix: function (p) { return [["1", "0"], [String(p), "1"]]; },
    },
    { id: "symmetric", label: "Simétrica", matrix: function () { return [["2", "1"], ["1", "2"]]; } },
    { id: "diagonal", label: "Escalamiento anisotrópico", matrix: function () { return [["2", "0"], ["0", "0.5"]]; } },
    { id: "reflection_x", label: "Reflexión respecto al eje x", matrix: function () { return [["1", "0"], ["0", "-1"]]; } },
    { id: "projection_x", label: "Proyección sobre el eje x", matrix: function () { return [["1", "0"], ["0", "0"]]; } },
  ],
  3: [
    { id: "identity", label: "Identidad I", matrix: function () { return [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "1"]]; } },
    {
      id: "scalar",
      label: "Escalar λI",
      parameter: { label: "λ", value: 2, step: 0.1 },
      matrix: function (p) {
        return [[String(p), "0", "0"], ["0", String(p), "0"], ["0", "0", String(p)]];
      },
    },
    {
      id: "rotation_x",
      label: "Rotación alrededor de x",
      parameter: { label: "θ (grados)", value: 45, step: 1 },
      matrix: function (p) {
        const a = String(p) + "*pi/180";
        return [
          ["1", "0", "0"],
          ["0", "cos(" + a + ")", "-sin(" + a + ")"],
          ["0", "sin(" + a + ")", "cos(" + a + ")"],
        ];
      },
    },
    {
      id: "rotation_y",
      label: "Rotación alrededor de y",
      parameter: { label: "θ (grados)", value: 45, step: 1 },
      matrix: function (p) {
        const a = String(p) + "*pi/180";
        return [
          ["cos(" + a + ")", "0", "sin(" + a + ")"],
          ["0", "1", "0"],
          ["-sin(" + a + ")", "0", "cos(" + a + ")"],
        ];
      },
    },
    {
      id: "rotation_z",
      label: "Rotación alrededor de z",
      parameter: { label: "θ (grados)", value: 45, step: 1 },
      matrix: function (p) {
        const a = String(p) + "*pi/180";
        return [
          ["cos(" + a + ")", "-sin(" + a + ")", "0"],
          ["sin(" + a + ")", "cos(" + a + ")", "0"],
          ["0", "0", "1"],
        ];
      },
    },
    {
      id: "shear_xy",
      label: "Shear x ← x + ky",
      parameter: { label: "k", value: 1, step: 0.1 },
      matrix: function (p) {
        return [["1", String(p), "0"], ["0", "1", "0"], ["0", "0", "1"]];
      },
    },
    {
      id: "symmetric",
      label: "Simétrica",
      matrix: function () { return [["2", "1", "0"], ["1", "2", "1"], ["0", "1", "2"]]; },
    },
    {
      id: "diagonal",
      label: "Escalamiento anisotrópico",
      matrix: function () { return [["2", "0", "0"], ["0", "1", "0"], ["0", "0", "0.5"]]; },
    },
    {
      id: "reflection_z",
      label: "Reflexión respecto al plano xy",
      matrix: function () { return [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "-1"]]; },
    },
    {
      id: "projection_xy",
      label: "Proyección sobre el plano xy",
      matrix: function () { return [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "0"]]; },
    },
    {
      id: "cycle",
      label: "Permutación cíclica",
      matrix: function () { return [["0", "0", "1"], ["1", "0", "0"], ["0", "1", "0"]]; },
    },
  ],
};

const LINEAR_DEFAULT_PRESET = { 1: "scalar", 2: "rotation", 3: "rotation_z" };
let linearMatrixExpressions = LINEAR_PRESETS[2].find(function (item) { return item.id === "rotation"; }).matrix(45);

function linearShowError(message) {
  const text = message || "";
  linearUi.error.textContent = text;
  linearUi.error.classList.toggle("hidden", !text);
}

function selectedLinearPreset() {
  const dim = Number(linearUi.dimension.value);
  return (LINEAR_PRESETS[dim] || []).find(function (item) {
    return item.id === linearUi.preset.value;
  }) || null;
}

function populateLinearPresets(preferredId) {
  const dim = Number(linearUi.dimension.value);
  const presets = LINEAR_PRESETS[dim] || [];
  linearUi.preset.innerHTML = "";

  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Personalizada";
  linearUi.preset.appendChild(custom);

  presets.forEach(function (preset) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    linearUi.preset.appendChild(option);
  });

  const target = presets.some(function (preset) { return preset.id === preferredId; })
    ? preferredId
    : LINEAR_DEFAULT_PRESET[dim];

  linearUi.preset.value = target;
  applyLinearPreset();
}

function applyLinearPreset() {
  const preset = selectedLinearPreset();
  if (!preset) {
    updateLinearParameterUi(null);
    return;
  }

  const parameter = preset.parameter ? preset.parameter.value : null;
  if (preset.parameter) {
    linearUi.parameter.value = parameter;
  }
  updateLinearParameterUi(preset);

  linearMatrixExpressions = preset.matrix(parameter);
  renderMatrixEditor();
  renderLinear();
}

function updateLinearParameterUi(preset) {
  const hasParameter = Boolean(preset && preset.parameter);
  linearUi.parameterRow.classList.toggle("hidden", !hasParameter);

  if (hasParameter) {
    linearUi.parameterLabel.textContent = preset.parameter.label;
    linearUi.parameter.step = String(preset.parameter.step || 0.1);
  }
}

function renderMatrixEditor() {
  const dim = Number(linearUi.dimension.value);
  linearUi.matrix.innerHTML = "";
  linearUi.matrix.style.gridTemplateColumns = "repeat(" + dim + ", 76px)";

  for (let row = 0; row < dim; row += 1) {
    for (let col = 0; col < dim; col += 1) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "matrix-cell";
      input.value = linearMatrixExpressions[row][col];
      input.setAttribute("aria-label", "a " + (row + 1) + " " + (col + 1));

      input.addEventListener("input", function () {
        linearMatrixExpressions[row][col] = input.value;
        linearUi.preset.value = "custom";
        updateLinearParameterUi(null);
        renderLinear();
      });

      linearUi.matrix.appendChild(input);
    }
  }
}

function evaluateMatrix() {
  if (!math) throw new Error("El evaluador matemático todavía está cargando.");

  return linearMatrixExpressions.map(function (row) {
    return row.map(function (expression) {
      let value;
      try {
        value = math.evaluate(normalizeExpression(expression));
      } catch (error) {
        throw new Error("Hay una entrada de la matriz que no puedo interpretar.");
      }

      const numeric = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error("Todas las entradas de A deben evaluar a números reales finitos.");
      }
      return numeric;
    });
  });
}

function matrixVectorMultiply(A, v) {
  return A.map(function (row) {
    return row.reduce(function (sum, value, index) {
      return sum + value * v[index];
    }, 0);
  });
}

function matrixMultiply(A, B) {
  const rows = A.length;
  const cols = B[0].length;
  const middle = B.length;
  return Array.from({ length: rows }, function (_, i) {
    return Array.from({ length: cols }, function (_, j) {
      let sum = 0;
      for (let k = 0; k < middle; k += 1) sum += A[i][k] * B[k][j];
      return sum;
    });
  });
}

function matrixTrace(A) {
  return A.reduce(function (sum, row, index) { return sum + row[index]; }, 0);
}

function matrixDeterminant(A) {
  const n = A.length;
  if (n === 1) return A[0][0];
  if (n === 2) return A[0][0] * A[1][1] - A[0][1] * A[1][0];
  return (
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  );
}

function matrixRank(A) {
  const M = A.map(function (row) { return row.slice(); });
  const rows = M.length;
  const cols = M[0].length;
  const scale = Math.max(1, ...M.flat().map(Math.abs));
  const eps = 1e-9 * scale;
  let pivotRow = 0;

  for (let col = 0; col < cols && pivotRow < rows; col += 1) {
    let best = pivotRow;
    for (let row = pivotRow + 1; row < rows; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[best][col])) best = row;
    }
    if (Math.abs(M[best][col]) <= eps) continue;

    const tmp = M[pivotRow];
    M[pivotRow] = M[best];
    M[best] = tmp;

    const pivot = M[pivotRow][col];
    for (let j = col; j < cols; j += 1) M[pivotRow][j] /= pivot;

    for (let row = 0; row < rows; row += 1) {
      if (row === pivotRow) continue;
      const factor = M[row][col];
      for (let j = col; j < cols; j += 1) M[row][j] -= factor * M[pivotRow][j];
    }

    pivotRow += 1;
  }

  return pivotRow;
}

function vectorNorm(v) {
  return Math.sqrt(v.reduce(function (sum, value) { return sum + value * value; }, 0));
}

function normalizeVector(v) {
  const norm = vectorNorm(v);
  if (norm < 1e-12) return v.slice();
  return v.map(function (value) { return value / norm; });
}

function nullspaceBasis(M) {
  const A = M.map(function (row) { return row.slice(); });
  const rows = A.length;
  const cols = A[0].length;
  const scale = Math.max(1, ...A.flat().map(Math.abs));
  const eps = 2e-6 * scale;
  const pivotCols = [];
  let pivotRow = 0;

  for (let col = 0; col < cols && pivotRow < rows; col += 1) {
    let best = pivotRow;
    for (let row = pivotRow + 1; row < rows; row += 1) {
      if (Math.abs(A[row][col]) > Math.abs(A[best][col])) best = row;
    }
    if (Math.abs(A[best][col]) <= eps) continue;

    const temp = A[pivotRow];
    A[pivotRow] = A[best];
    A[best] = temp;

    const pivot = A[pivotRow][col];
    for (let j = 0; j < cols; j += 1) A[pivotRow][j] /= pivot;

    for (let row = 0; row < rows; row += 1) {
      if (row === pivotRow) continue;
      const factor = A[row][col];
      for (let j = 0; j < cols; j += 1) A[row][j] -= factor * A[pivotRow][j];
    }

    pivotCols.push(col);
    pivotRow += 1;
  }

  const freeCols = [];
  for (let col = 0; col < cols; col += 1) {
    if (!pivotCols.includes(col)) freeCols.push(col);
  }

  return freeCols.map(function (freeCol) {
    const v = Array(cols).fill(0);
    v[freeCol] = 1;

    for (let row = pivotCols.length - 1; row >= 0; row -= 1) {
      const pivotCol = pivotCols[row];
      let sum = 0;
      for (let col = 0; col < cols; col += 1) {
        if (col !== pivotCol) sum += A[row][col] * v[col];
      }
      v[pivotCol] = -sum;
    }

    return normalizeVector(v);
  });
}

function uniqueNumbers(values, tolerance) {
  const result = [];
  values.forEach(function (value) {
    if (!result.some(function (existing) { return Math.abs(existing - value) <= tolerance; })) {
      result.push(value);
    }
  });
  return result;
}

function cubicRealRoots(a, b, c) {
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;
  const discriminant = (q * q) / 4 + (p * p * p) / 27;
  const eps = 1e-12 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));

  if (discriminant > eps) {
    const sqrtD = Math.sqrt(discriminant);
    const u = Math.cbrt(-q / 2 + sqrtD);
    const v = Math.cbrt(-q / 2 - sqrtD);
    return [u + v - a / 3];
  }

  if (Math.abs(discriminant) <= eps) {
    const u = Math.cbrt(-q / 2);
    return uniqueNumbers([2 * u - a / 3, -u - a / 3], 1e-7);
  }

  const radius = 2 * Math.sqrt(-p / 3);
  const arg = clamp((3 * q / (2 * p)) * Math.sqrt(-3 / p), -1, 1);
  const phi = Math.acos(arg) / 3;

  return [0, 1, 2].map(function (k) {
    return radius * Math.cos(phi - (2 * Math.PI * k) / 3) - a / 3;
  });
}

function realEigenpairs(A) {
  const n = A.length;
  let eigenvalues = [];

  if (n === 1) {
    eigenvalues = [A[0][0]];
  } else if (n === 2) {
    const tr = matrixTrace(A);
    const det = matrixDeterminant(A);
    const disc = tr * tr - 4 * det;
    const eps = 1e-10 * Math.max(1, tr * tr, Math.abs(det));

    if (disc >= -eps) {
      const root = Math.sqrt(Math.max(0, disc));
      eigenvalues = uniqueNumbers([(tr + root) / 2, (tr - root) / 2], 1e-7);
    }
  } else {
    const tr = matrixTrace(A);
    const A2 = matrixMultiply(A, A);
    const c2 = 0.5 * (tr * tr - matrixTrace(A2));
    const det = matrixDeterminant(A);
    eigenvalues = cubicRealRoots(-tr, c2, -det);
    eigenvalues = uniqueNumbers(eigenvalues, 1e-6);
  }

  eigenvalues.sort(function (x, y) { return y - x; });

  return eigenvalues.map(function (lambda) {
    const shifted = A.map(function (row, i) {
      return row.map(function (value, j) {
        return value - (i === j ? lambda : 0);
      });
    });

    let basis = nullspaceBasis(shifted);

    if (!basis.length && n === 1) basis = [[1]];

    return {
      value: Math.abs(lambda) < 1e-10 ? 0 : lambda,
      vectors: basis,
    };
  }).filter(function (pair) {
    return pair.vectors.length > 0;
  });
}

function linearClearSvg() {
  while (linearUi.svg.firstChild) linearUi.svg.removeChild(linearUi.svg.firstChild);
}

function linearLine(x1, y1, x2, y2, attrs) {
  const line = svgElement("line", Object.assign({
    x1: x1, y1: y1, x2: x2, y2: y2,
    stroke: "#506078",
    "stroke-width": 1,
  }, attrs || {}));
  linearUi.svg.appendChild(line);
  return line;
}

function linearText(x, y, text, attrs) {
  const node = svgElement("text", Object.assign({
    x: x,
    y: y,
    fill: "#99a6bc",
    "font-size": 12,
    "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
  }, attrs || {}));
  node.textContent = text;
  linearUi.svg.appendChild(node);
  return node;
}

function drawArrow2D(x1, y1, x2, y2, color, label, dashed) {
  linearLine(x1, y1, x2, y2, {
    stroke: color,
    "stroke-width": 2.5,
    "stroke-dasharray": dashed ? "7 5" : "none",
    "stroke-linecap": "round",
  });

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 9;
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  const points = [
    [x2, y2],
    [x2 + size * Math.cos(a1), y2 + size * Math.sin(a1)],
    [x2 + size * Math.cos(a2), y2 + size * Math.sin(a2)],
  ].map(function (p) { return p[0] + "," + p[1]; }).join(" ");

  linearUi.svg.appendChild(svgElement("polygon", {
    points: points,
    fill: color,
  }));

  if (label) {
    linearText(x2 + 8, y2 - 8, label, {
      fill: color,
      "font-size": 13,
      "font-family": "STIX Two Math, Cambria Math, Times New Roman, serif",
    });
  }
}

function drawEigenLine2D(cx, cy, vx, vy, scale, color, label) {
  const norm = Math.hypot(vx, vy);
  if (norm < 1e-12) return;
  const ux = vx / norm;
  const uy = vy / norm;
  const length = 2.15 * scale;

  linearLine(cx - ux * length, cy + uy * length, cx + ux * length, cy - uy * length, {
    stroke: color,
    "stroke-width": 2,
    "stroke-dasharray": "7 6",
    "stroke-opacity": 0.95,
  });
  linearText(cx + ux * length + 5, cy - uy * length - 5, label, {
    fill: color,
    "font-size": 12,
    "font-family": "STIX Two Math, Cambria Math, Times New Roman, serif",
  });
}

function panelTitle(x, text) {
  linearText(x, 36, text, {
    fill: "#dfe7f6",
    "font-size": 13,
    "font-weight": 700,
    "text-anchor": "middle",
  });
}

function drawLinearR1(A, eigenpairs) {
  linearUi.svg.setAttribute("viewBox", "0 0 1000 430");
  const a = A[0][0];
  const values = [-2, -1, 0, 1, 2];
  const transformed = values.map(function (x) { return a * x; });
  const extent = Math.max(2.5, ...transformed.map(Math.abs)) * 1.12;
  const left = 110;
  const right = 900;
  const y1 = 135;
  const y2 = 305;
  const scale = function (x) { return left + ((x + extent) / (2 * extent)) * (right - left); };

  panelTitle(500, "R¹: x ↦ Ax");

  linearLine(left, y1, right, y1, { stroke: "#65738b", "stroke-width": 1.5 });
  linearLine(left, y2, right, y2, { stroke: "#7ba2ff", "stroke-width": 1.5 });
  linearText(45, y1 + 5, "x", { fill: "#dfe7f6", "font-size": 16, "font-style": "italic" });
  linearText(35, y2 + 5, "Ax", { fill: "#dfe7f6", "font-size": 16 });

  values.forEach(function (x, index) {
    const x1 = scale(x);
    const x2 = scale(transformed[index]);
    linearLine(x1, y1 + 7, x2, y2 - 7, {
      stroke: "#7ba2ff",
      "stroke-width": 1.4,
      "stroke-opacity": 0.45,
    });
    linearUi.svg.appendChild(svgElement("circle", { cx: x1, cy: y1, r: 4.5, fill: "#f4f7fb" }));
    linearUi.svg.appendChild(svgElement("circle", { cx: x2, cy: y2, r: 4.5, fill: "#7ba2ff" }));
    linearText(x1, y1 + 24, formatNumber(x), { "text-anchor": "middle", "font-size": 11 });
    linearText(x2, y2 + 24, formatNumber(transformed[index]), { "text-anchor": "middle", "font-size": 11 });
  });

  if (linearUi.showEigen.checked && eigenpairs.length) {
    const pair = eigenpairs[0];
    linearText(500, 385, "Toda dirección no nula es eigenvector; λ = " + formatNumber(pair.value), {
      fill: "#f0c674",
      "font-size": 14,
      "text-anchor": "middle",
      "font-family": "STIX Two Math, Cambria Math, Times New Roman, serif",
    });
  }
}

function drawPlaneAxes(cx, cy, scale) {
  linearLine(cx - 2.35 * scale, cy, cx + 2.35 * scale, cy, {
    stroke: "#65738b",
    "stroke-width": 1.2,
  });
  linearLine(cx, cy + 2.35 * scale, cx, cy - 2.35 * scale, {
    stroke: "#65738b",
    "stroke-width": 1.2,
  });
}

function drawLinearR2(A, eigenpairs) {
  linearUi.svg.setAttribute("viewBox", "0 0 1000 560");
  const leftCenter = [265, 300];
  const rightCenter = [735, 300];
  const leftScale = 78;
  const gridExtent = 2;
  const corners = [
    [-gridExtent, -gridExtent], [-gridExtent, gridExtent],
    [gridExtent, -gridExtent], [gridExtent, gridExtent],
  ].map(function (v) { return matrixVectorMultiply(A, v); });

  const maxRight = Math.max(1.25, ...corners.flat().map(Math.abs));
  const rightScale = Math.min(86, 175 / maxRight);

  panelTitle(leftCenter[0], "Antes");
  panelTitle(rightCenter[0], "Después de A");

  drawPlaneAxes(leftCenter[0], leftCenter[1], leftScale);
  drawPlaneAxes(rightCenter[0], rightCenter[1], rightScale);

  if (linearUi.showGrid.checked) {
    for (let k = -gridExtent; k <= gridExtent; k += 1) {
      linearLine(
        leftCenter[0] + k * leftScale,
        leftCenter[1] + gridExtent * leftScale,
        leftCenter[0] + k * leftScale,
        leftCenter[1] - gridExtent * leftScale,
        { stroke: "#344158", "stroke-width": k === 0 ? 0 : 1, "stroke-opacity": 0.75 },
      );
      linearLine(
        leftCenter[0] - gridExtent * leftScale,
        leftCenter[1] - k * leftScale,
        leftCenter[0] + gridExtent * leftScale,
        leftCenter[1] - k * leftScale,
        { stroke: "#344158", "stroke-width": k === 0 ? 0 : 1, "stroke-opacity": 0.75 },
      );

      const verticalStart = matrixVectorMultiply(A, [k, -gridExtent]);
      const verticalEnd = matrixVectorMultiply(A, [k, gridExtent]);
      const horizontalStart = matrixVectorMultiply(A, [-gridExtent, k]);
      const horizontalEnd = matrixVectorMultiply(A, [gridExtent, k]);

      linearLine(
        rightCenter[0] + verticalStart[0] * rightScale,
        rightCenter[1] - verticalStart[1] * rightScale,
        rightCenter[0] + verticalEnd[0] * rightScale,
        rightCenter[1] - verticalEnd[1] * rightScale,
        { stroke: "#7ba2ff", "stroke-width": 1.15, "stroke-opacity": 0.62 },
      );
      linearLine(
        rightCenter[0] + horizontalStart[0] * rightScale,
        rightCenter[1] - horizontalStart[1] * rightScale,
        rightCenter[0] + horizontalEnd[0] * rightScale,
        rightCenter[1] - horizontalEnd[1] * rightScale,
        { stroke: "#7ba2ff", "stroke-width": 1.15, "stroke-opacity": 0.62 },
      );
    }
  }

  if (linearUi.showBasis.checked) {
    const basis = [[1, 0], [0, 1]];
    const labels = ["e₁", "e₂"];
    const colors = ["#d75452", "#8de0c2"];

    basis.forEach(function (v, index) {
      const Av = matrixVectorMultiply(A, v);
      drawArrow2D(
        leftCenter[0], leftCenter[1],
        leftCenter[0] + v[0] * leftScale,
        leftCenter[1] - v[1] * leftScale,
        colors[index], labels[index], false,
      );
      drawArrow2D(
        rightCenter[0], rightCenter[1],
        rightCenter[0] + Av[0] * rightScale,
        rightCenter[1] - Av[1] * rightScale,
        colors[index], "A" + labels[index], false,
      );
    });
  }

  if (linearUi.showEigen.checked) {
    const eigenColors = ["#f0c674", "#d98bd7", "#f29e6d"];
    let counter = 0;

    eigenpairs.forEach(function (pair) {
      pair.vectors.forEach(function (v) {
        const color = eigenColors[counter % eigenColors.length];
        const label = "v" + (counter + 1) + ", λ=" + formatNumber(pair.value);
        drawEigenLine2D(leftCenter[0], leftCenter[1], v[0], v[1], leftScale, color, label);
        drawEigenLine2D(rightCenter[0], rightCenter[1], v[0], v[1], rightScale, color, label);
        counter += 1;
      });
    });
  }

  linearText(500, 522, "Las columnas de A son Ae₁ y Ae₂.", {
    fill: "#99a6bc",
    "font-size": 13,
    "text-anchor": "middle",
  });
}

function isoProject(v, cx, cy, scale) {
  const c = 0.8660254037844386;
  return [
    cx + scale * c * (v[0] - v[2]),
    cy - scale * (0.5 * v[0] + v[1] + 0.5 * v[2]),
  ];
}

function cubeVertices(extent) {
  const vertices = [];
  [-extent, extent].forEach(function (x) {
    [-extent, extent].forEach(function (y) {
      [-extent, extent].forEach(function (z) {
        vertices.push([x, y, z]);
      });
    });
  });
  return vertices;
}

function cubeEdges(vertices) {
  const edges = [];
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      let differences = 0;
      for (let k = 0; k < 3; k += 1) {
        if (vertices[i][k] !== vertices[j][k]) differences += 1;
      }
      if (differences === 1) edges.push([i, j]);
    }
  }
  return edges;
}

function drawIsoVector(cx, cy, vector, scale, color, label, dashed) {
  const origin = isoProject([0, 0, 0], cx, cy, scale);
  const endpoint = isoProject(vector, cx, cy, scale);
  drawArrow2D(origin[0], origin[1], endpoint[0], endpoint[1], color, label, dashed);
}

function drawIsoEigenLine(cx, cy, vector, scale, color, label) {
  const v = normalizeVector(vector);
  const start = isoProject(v.map(function (x) { return -1.8 * x; }), cx, cy, scale);
  const end = isoProject(v.map(function (x) { return 1.8 * x; }), cx, cy, scale);
  linearLine(start[0], start[1], end[0], end[1], {
    stroke: color,
    "stroke-width": 2,
    "stroke-dasharray": "7 6",
  });
  linearText(end[0] + 5, end[1] - 5, label, {
    fill: color,
    "font-size": 12,
    "font-family": "STIX Two Math, Cambria Math, Times New Roman, serif",
  });
}

function drawLinearR3(A, eigenpairs) {
  linearUi.svg.setAttribute("viewBox", "0 0 1000 590");
  const leftCenter = [270, 315];
  const rightCenter = [745, 315];
  const vertices = cubeVertices(1);
  const edges = cubeEdges(vertices);
  const transformedVertices = vertices.map(function (v) { return matrixVectorMultiply(A, v); });

  const projectedRaw = transformedVertices.map(function (v) { return isoProject(v, 0, 0, 1); });
  const maxProjected = Math.max(1, ...projectedRaw.flat().map(Math.abs));
  const leftScale = 92;
  const rightScale = Math.min(96, 175 / maxProjected);

  panelTitle(leftCenter[0], "Antes");
  panelTitle(rightCenter[0], "Después de A");

  const axes = [
    { v: [1.65, 0, 0], label: "x", color: "#d75452" },
    { v: [0, 1.65, 0], label: "y", color: "#8de0c2" },
    { v: [0, 0, 1.65], label: "z", color: "#7ba2ff" },
  ];

  axes.forEach(function (axis) {
    drawIsoVector(leftCenter[0], leftCenter[1], axis.v, leftScale, axis.color, axis.label, false);
  });

  const rightAxes = [
    { v: [1.65, 0, 0], label: "x", color: "#506078" },
    { v: [0, 1.65, 0], label: "y", color: "#506078" },
    { v: [0, 0, 1.65], label: "z", color: "#506078" },
  ];
  rightAxes.forEach(function (axis) {
    drawIsoVector(rightCenter[0], rightCenter[1], axis.v, rightScale, axis.color, axis.label, false);
  });

  if (linearUi.showGrid.checked) {
    edges.forEach(function (edge) {
      const a = isoProject(vertices[edge[0]], leftCenter[0], leftCenter[1], leftScale);
      const b = isoProject(vertices[edge[1]], leftCenter[0], leftCenter[1], leftScale);
      linearLine(a[0], a[1], b[0], b[1], {
        stroke: "#506078",
        "stroke-width": 1.2,
        "stroke-opacity": 0.72,
      });

      const ta = isoProject(transformedVertices[edge[0]], rightCenter[0], rightCenter[1], rightScale);
      const tb = isoProject(transformedVertices[edge[1]], rightCenter[0], rightCenter[1], rightScale);
      linearLine(ta[0], ta[1], tb[0], tb[1], {
        stroke: "#7ba2ff",
        "stroke-width": 1.35,
        "stroke-opacity": 0.78,
      });
    });
  }

  if (linearUi.showBasis.checked) {
    const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const colors = ["#d75452", "#8de0c2", "#7ba2ff"];
    const labels = ["e₁", "e₂", "e₃"];

    basis.forEach(function (v, index) {
      drawIsoVector(leftCenter[0], leftCenter[1], v, leftScale, colors[index], labels[index], false);
      drawIsoVector(
        rightCenter[0], rightCenter[1],
        matrixVectorMultiply(A, v),
        rightScale,
        colors[index],
        "A" + labels[index],
        false,
      );
    });
  }

  if (linearUi.showEigen.checked) {
    const eigenColors = ["#f0c674", "#d98bd7", "#f29e6d", "#c7ef73"];
    let counter = 0;

    eigenpairs.forEach(function (pair) {
      pair.vectors.forEach(function (v) {
        const color = eigenColors[counter % eigenColors.length];
        const label = "v" + (counter + 1) + ", λ=" + formatNumber(pair.value);
        drawIsoEigenLine(leftCenter[0], leftCenter[1], v, leftScale, color, label);
        drawIsoEigenLine(rightCenter[0], rightCenter[1], v, rightScale, color, label);
        counter += 1;
      });
    });
  }

  linearText(500, 554, "El cubo unidad se transforma en el paralelepípedo generado por las columnas de A.", {
    fill: "#99a6bc",
    "font-size": 13,
    "text-anchor": "middle",
  });
}

function updateLinearEigenInfo(eigenpairs, dim) {
  const realValues = eigenpairs.map(function (pair) { return pair.value; });

  linearUi.eigenvalues.textContent = realValues.length
    ? "λ = " + realValues.map(formatNumber).join(", ")
    : "sin λ reales";

  if (!linearUi.showEigen.checked) {
    linearUi.eigenInfo.textContent = "Activa los eigenvectores para ver direcciones invariantes.";
    return;
  }

  if (!eigenpairs.length) {
    linearUi.eigenInfo.textContent =
      "Esta matriz no tiene eigenvectores reales en R" + dim + ". Esto ocurre, por ejemplo, en una rotación plana genérica.";
    return;
  }

  const pieces = [];
  eigenpairs.forEach(function (pair) {
    if (pair.vectors.length === dim && eigenpairs.length === 1) {
      pieces.push("λ=" + formatNumber(pair.value) + ": todo R" + dim + " es eigenspace");
      return;
    }

    pair.vectors.forEach(function (v) {
      pieces.push(
        "λ=" + formatNumber(pair.value) +
        ", v≈(" + v.map(function (x) { return formatNumber(x); }).join(", ") + ")",
      );
    });
  });

  linearUi.eigenInfo.textContent = pieces.join(" · ");
}

function renderLinear() {
  if (!linearUi || !linearUi.svg) return;
  if (!math) {
    linearUi.status.textContent = "Cargando evaluador…";
    return;
  }

  linearShowError("");

  let A;
  try {
    A = evaluateMatrix();
  } catch (error) {
    linearShowError(error.message);
    linearUi.status.textContent = "Matriz inválida";
    return;
  }

  const dim = A.length;
  const det = matrixDeterminant(A);
  const tr = matrixTrace(A);
  const rank = matrixRank(A);
  const eigenpairs = realEigenpairs(A);

  linearUi.title.textContent = "A : R" + dim + " → R" + dim;
  linearUi.det.textContent = "det(A) = " + formatNumber(det);
  linearUi.trace.textContent = "tr(A) = " + formatNumber(tr);
  linearUi.rank.textContent = "rank(A) = " + rank;
  linearUi.status.textContent =
    (Math.abs(det) < 1e-9 ? "singular" : "invertible") +
    " · " + eigenpairs.length + " eigenvalor" + (eigenpairs.length === 1 ? "" : "es") + " real" + (eigenpairs.length === 1 ? "" : "es");

  updateLinearEigenInfo(eigenpairs, dim);
  linearClearSvg();

  if (dim === 1) drawLinearR1(A, eigenpairs);
  if (dim === 2) drawLinearR2(A, eigenpairs);
  if (dim === 3) drawLinearR3(A, eigenpairs);
}

function switchMode(mode) {
  const linearActive = mode === "linear";
  linearUi.mode.classList.toggle("hidden", !linearActive);
  linearUi.functionsMode.classList.toggle("hidden", linearActive);
  linearUi.tabLinear.classList.toggle("active", linearActive);
  linearUi.tabFunctions.classList.toggle("active", !linearActive);
  linearUi.tabLinear.setAttribute("aria-selected", linearActive ? "true" : "false");
  linearUi.tabFunctions.setAttribute("aria-selected", linearActive ? "false" : "true");

  if (linearActive) {
    stopAnimation(false);
    renderLinear();
  } else if (math) {
    render();
  }
}

function setupLinearExplorer() {
  if (!linearUi.mode) return;

  linearUi.tabFunctions.addEventListener("click", function () { switchMode("functions"); });
  linearUi.tabLinear.addEventListener("click", function () { switchMode("linear"); });

  linearUi.dimension.addEventListener("change", function () {
    const dim = Number(linearUi.dimension.value);
    populateLinearPresets(LINEAR_DEFAULT_PRESET[dim]);
  });

  linearUi.preset.addEventListener("change", function () {
    if (linearUi.preset.value === "custom") {
      updateLinearParameterUi(null);
      return;
    }
    applyLinearPreset();
  });

  linearUi.parameter.addEventListener("input", function () {
    const preset = selectedLinearPreset();
    if (!preset || !preset.parameter) return;
    const value = Number(linearUi.parameter.value);
    if (!Number.isFinite(value)) return;
    linearMatrixExpressions = preset.matrix(value);
    renderMatrixEditor();
    renderLinear();
  });

  linearUi.reset.addEventListener("click", function () {
    const dim = Number(linearUi.dimension.value);
    const preferred = linearUi.preset.value === "custom"
      ? LINEAR_DEFAULT_PRESET[dim]
      : linearUi.preset.value;
    populateLinearPresets(preferred);
  });

  [linearUi.showGrid, linearUi.showBasis, linearUi.showEigen].forEach(function (control) {
    control.addEventListener("change", renderLinear);
  });

  populateLinearPresets("rotation");
}

setupLinearExplorer();
