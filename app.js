const root = document;

const ui = {
  f: root.getElementById("function-f"),
  g: root.getElementById("function-g"),
  gControl: root.getElementById("g-control"),
  xmin: root.getElementById("x-min"),
  xmax: root.getElementById("x-max"),
  count: root.getElementById("point-count"),
  compose: root.getElementById("compose"),
  morph: root.getElementById("morph"),
  morphValue: root.getElementById("morph-value"),
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
const COLORS = {
  text: "#f4f7fb",
  muted: "#99a6bc",
  axis: "#3a4966",
  f: "#7ba2ff",
  g: "#8de0c2",
  composed: "#f0c674",
  selected: "#ffffff",
};

let math = null;
let selectedIndex = null;

function svgElement(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
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

function showError(message = "") {
  ui.error.textContent = message;
  ui.error.classList.toggle("hidden", !message);
}

function evaluate(compiled, x) {
  try {
    const raw = compiled.evaluate({ x });
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : NaN;
  } catch {
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

function makeScale(values, left, right) {
  const finite = values.filter(Number.isFinite);
  let min = finite.length ? Math.min(...finite) : -1;
  let max = finite.length ? Math.max(...finite) : 1;

  if (min === max) {
    const delta = Math.max(1, Math.abs(min) * 0.2);
    min -= delta;
    max += delta;
  }

  const padding = (max - min) * 0.08;
  min -= padding;
  max += padding;

  return {
    min,
    max,
    project(value) {
      return left + ((value - min) / (max - min)) * (right - left);
    },
  };
}

function representativeTicks(values, count = 5) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];

  const sorted = [...finite].sort((a, b) => a - b);
  const result = [];

  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (sorted.length - 1)) / (count - 1));
    const value = sorted[index];
    if (!result.some((existing) => Math.abs(existing - value) < 1e-10)) {
      result.push(value);
    }
  }
  return result;
}

function drawAxis(y, label, scale, tickValues, color = COLORS.axis) {
  const { svg } = ui;
  const left = 85;
  const right = 855;

  svg.appendChild(
    svgElement("line", {
      x1: left,
      y1: y,
      x2: right,
      y2: y,
      stroke: color,
      "stroke-width": 1.6,
    }),
  );

  const labelNode = svgElement("text", {
    x: 22,
    y: y + 5,
    fill: COLORS.muted,
    "font-size": 14,
    "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
  });
  labelNode.textContent = label;
  svg.appendChild(labelNode);

  for (const value of tickValues) {
    const x = scale.project(value);
    if (!Number.isFinite(x)) continue;

    svg.appendChild(
      svgElement("line", {
        x1: x,
        y1: y - 5,
        x2: x,
        y2: y + 5,
        stroke: COLORS.muted,
        "stroke-width": 1,
        "stroke-opacity": 0.7,
      }),
    );

    const text = svgElement("text", {
      x,
      y: y + 22,
      fill: COLORS.muted,
      "font-size": 11,
      "text-anchor": "middle",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
    });
    text.textContent = formatNumber(value);
    svg.appendChild(text);
  }
}

function drawPath(x1, y1, x2, y2, color, selected = false) {
  const controlOffset = Math.max(28, Math.abs(y2 - y1) * 0.33);
  const path = svgElement("path", {
    d: `M ${x1} ${y1} C ${x1} ${y1 + controlOffset}, ${x2} ${y2 - controlOffset}, ${x2} ${y2}`,
    fill: "none",
    stroke: selected ? COLORS.selected : color,
    "stroke-width": selected ? 3 : 1.35,
    "stroke-opacity": selected ? 0.98 : 0.42,
    "stroke-linecap": "round",
  });
  ui.svg.appendChild(path);
}

function drawPoint(x, y, color, index, selected = false, selectable = false, label = "") {
  const circle = svgElement("circle", {
    cx: x,
    cy: y,
    r: selected ? 6.5 : 4.3,
    fill: selected ? COLORS.selected : color,
    stroke: selected ? color : "none",
    "stroke-width": selected ? 2.4 : 0,
  });

  if (selectable) {
    circle.setAttribute("tabindex", "0");
    circle.setAttribute("role", "button");
    circle.setAttribute("aria-label", label);
    circle.style.cursor = "pointer";

    const choose = () => {
      selectedIndex = index;
      render();
    };

    circle.addEventListener("click", choose);
    circle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });
  }

  ui.svg.appendChild(circle);
}

function parseInputs() {
  let xmin = Number(ui.xmin.value);
  let xmax = Number(ui.xmax.value);
  let count = Math.round(Number(ui.count.value));

  if (!Number.isFinite(xmin)) xmin = -3;
  if (!Number.isFinite(xmax)) xmax = 3;
  if (xmax <= xmin) xmax = xmin + 1;
  if (!Number.isFinite(count)) count = 15;

  count = clamp(count, 3, 61);

  ui.xmin.value = xmin;
  ui.xmax.value = xmax;
  ui.count.value = count;

  return { xmin, xmax, count };
}

function updateMetrics(xs, fx, compiledF, gx = null, fg = null, compiledG = null) {
  if (selectedIndex === null || selectedIndex >= xs.length) {
    selectedIndex = Math.floor(xs.length / 2);
  }

  const x = xs[selectedIndex];
  ui.metricX.textContent = `x = ${formatNumber(x)}`;

  let y;
  let derivative;
  let derivativeLabel;

  if (ui.compose.checked && compiledG && gx && fg) {
    y = fg[selectedIndex];
    const composed = (z) => {
      const gz = evaluate(compiledG, z);
      return Number.isFinite(gz) ? evaluate(compiledF, gz) : NaN;
    };
    derivative = numericDerivative(composed, x);
    derivativeLabel = "|(f∘g)′(x)|";
    ui.metricY.textContent = `f(g(x)) = ${formatNumber(y)}`;
  } else {
    y = fx[selectedIndex];
    derivative = numericDerivative((z) => evaluate(compiledF, z), x);
    derivativeLabel = "|f′(x)|";
    ui.metricY.textContent = `f(x) = ${formatNumber(y)}`;
  }

  ui.metricD.textContent = `${derivativeLabel} ≈ ${formatNumber(Math.abs(derivative))}`;

  if (!Number.isFinite(derivative)) {
    ui.metricOrientation.textContent = "derivada no disponible aquí";
  } else if (Math.abs(derivative) < 1e-8) {
    ui.metricOrientation.textContent = "aplanamiento local";
  } else if (derivative < 0) {
    ui.metricOrientation.textContent = "orientación local invertida";
  } else {
    ui.metricOrientation.textContent = "orientación local preservada";
  }
}

function render() {
  if (!math) return;

  showError();

  const { xmin, xmax, count } = parseInputs();
  const morphT = Number(ui.morph.value) / 100;
  ui.morphValue.textContent = `${Math.round(morphT * 100)}%`;
  ui.gControl.classList.toggle("hidden", !ui.compose.checked);
  ui.title.textContent = ui.compose.checked ? "x ↦ g(x) ↦ f(g(x))" : "x ↦ f(x)";

  let compiledF;
  let compiledG = null;

  try {
    compiledF = math.compile(ui.f.value);
  } catch (error) {
    showError("No pude interpretar f(x). Revisa paréntesis, operadores y nombres de funciones.");
    ui.status.textContent = "Expresión inválida";
    return;
  }

  if (ui.compose.checked) {
    try {
      compiledG = math.compile(ui.g.value);
    } catch (error) {
      showError("No pude interpretar g(x). Revisa paréntesis, operadores y nombres de funciones.");
      ui.status.textContent = "Expresión inválida";
      return;
    }
  }

  const xs = Array.from(
    { length: count },
    (_, index) => xmin + ((xmax - xmin) * index) / (count - 1),
  );

  const fx = xs.map((x) => evaluate(compiledF, x));
  const gx = compiledG ? xs.map((x) => evaluate(compiledG, x)) : null;
  const fg = compiledG
    ? gx.map((value) => (Number.isFinite(value) ? evaluate(compiledF, value) : NaN))
    : null;

  const finalValues = fg ?? fx;
  const finiteCount = finalValues.filter(Number.isFinite).length;

  if (!finiteCount) {
    showError("No hay imágenes finitas para esta función dentro del intervalo elegido.");
    ui.status.textContent = "Sin puntos finitos";
    return;
  }

  while (ui.svg.firstChild) ui.svg.removeChild(ui.svg.firstChild);

  const left = 85;
  const right = 855;
  const yTop = 72;
  const yMiddle = ui.compose.checked ? 215 : 335;
  const yBottom = ui.compose.checked ? 358 : null;

  const inputScale = makeScale(xs, left, right);

  if (!ui.compose.checked) {
    const displayValues = fx.map((value, i) => {
      if (!Number.isFinite(value)) return NaN;
      return xs[i] + morphT * (value - xs[i]);
    });
    const outputScale = makeScale([...xs, ...displayValues], left, right);

    drawAxis(yTop, "x", inputScale, representativeTicks(xs));
    drawAxis(yMiddle, "f(x)", outputScale, representativeTicks(displayValues), COLORS.f);

    xs.forEach((x, index) => {
      const raw = fx[index];
      if (!Number.isFinite(raw)) return;

      const output = x + morphT * (raw - x);
      const x1 = inputScale.project(x);
      const x2 = outputScale.project(output);
      const selected = index === selectedIndex;

      drawPath(x1, yTop + 7, x2, yMiddle - 7, COLORS.f, selected);
      drawPoint(
        x1,
        yTop,
        COLORS.text,
        index,
        selected,
        true,
        `Seleccionar x = ${formatNumber(x)}`,
      );
      drawPoint(x2, yMiddle, COLORS.f, index, selected);
    });
  } else {
    const displayG = gx.map((value, i) => {
      if (!Number.isFinite(value)) return NaN;
      return xs[i] + morphT * (value - xs[i]);
    });

    const displayFG = fg.map((value, i) => {
      if (!Number.isFinite(value) || !Number.isFinite(gx[i])) return NaN;
      return gx[i] + morphT * (value - gx[i]);
    });

    const middleScale = makeScale([...xs, ...displayG], left, right);
    const bottomScale = makeScale(
      [...displayG.filter(Number.isFinite), ...displayFG.filter(Number.isFinite)],
      left,
      right,
    );

    drawAxis(yTop, "x", inputScale, representativeTicks(xs));
    drawAxis(yMiddle, "g(x)", middleScale, representativeTicks(displayG), COLORS.g);
    drawAxis(
      yBottom,
      "f(g(x))",
      bottomScale,
      representativeTicks(displayFG),
      COLORS.composed,
    );

    xs.forEach((x, index) => {
      if (!Number.isFinite(gx[index])) return;

      const middleValue = displayG[index];
      const x1 = inputScale.project(x);
      const x2 = middleScale.project(middleValue);
      const selected = index === selectedIndex;

      drawPath(x1, yTop + 7, x2, yMiddle - 7, COLORS.g, selected);
      drawPoint(
        x1,
        yTop,
        COLORS.text,
        index,
        selected,
        true,
        `Seleccionar x = ${formatNumber(x)}`,
      );
      drawPoint(x2, yMiddle, COLORS.g, index, selected);

      if (!Number.isFinite(fg[index])) return;

      const bottomValue = displayFG[index];
      const x3 = bottomScale.project(bottomValue);

      drawPath(x2, yMiddle + 7, x3, yBottom - 7, COLORS.composed, selected);
      drawPoint(x3, yBottom, COLORS.composed, index, selected);
    });
  }

  ui.status.textContent = `${finiteCount} / ${count} imágenes finitas`;
  updateMetrics(xs, fx, compiledF, gx, fg, compiledG);
}

function bindControls() {
  const liveControls = [
    ui.f,
    ui.g,
    ui.xmin,
    ui.xmax,
    ui.count,
    ui.morph,
  ];

  liveControls.forEach((control) => {
    control.addEventListener("input", render);
  });

  ui.compose.addEventListener("change", () => {
    selectedIndex = null;
    render();
  });

  root.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => {
      ui.f.value = button.dataset.expression;
      selectedIndex = null;
      render();
      ui.f.focus();
    });
  });
}

async function boot() {
  bindControls();

  try {
    const module = await import("https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm");
    math = module.default ?? module;
    ui.status.textContent = "Listo";
    render();
  } catch (error) {
    console.error(error);
    showError(
      "No se pudo cargar Math.js. Comprueba tu conexión a internet y recarga la página.",
    );
    ui.status.textContent = "Error al cargar Math.js";
  }
}

boot();
