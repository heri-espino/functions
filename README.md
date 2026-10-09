# Function Mapper

A static web app for visualizing functions and linear transformations as **maps of spaces**, not only as conventional Cartesian plots.

The app now has two modes:

```text
Functions R → R
x → f(x) → g(f(x)) → h(g(f(x))) → …

Linear transformations
x → Ax,     A : Rⁿ → Rⁿ,     n ∈ {1,2,3}
```

## 1. Functions R → R

Each horizontal axis is a copy of the real line at one stage of the composition. The same sampled points are followed from one stage to the next.

Features:

- Desmos-like expression rows for `f(x)`, `g(x)`, `h(x)`, etc.
- Add or remove functions to build a composition chain.
- Configurable initial `xlim`.
- Optional **same xlim on every axis** mode.
- Straight segments from each point to its image.
- Uniform sampling plus arbitrary extra points.
- Extra points can be typed or added by clicking the first axis.
- Stage colors or continuous color by the original `x`.
- Viridis, Plasma, Inferno, Magma, Cividis, and Turbo palettes.
- Animated traversal of
  `x → f(x) → g(f(x)) → …`.
- Scrubbable animation and playback speed.
- Numerical derivative of the complete composition.

For small `dx`,

```text
df ≈ f'(x) dx
```

so `|f'(x)|` is the local stretching factor.

## 2. Linear transformations

The second mode visualizes

```text
T(x) = Ax
```

in `R¹`, `R²`, and `R³`.

### Matrix editor

- Choose the dimension `R¹`, `R²`, or `R³`.
- Edit every matrix entry directly.
- Entries accept Math.js expressions such as:
  - `sqrt(2)/2`
  - `cos(pi/4)`
  - `-sin(pi/6)`
- The app reports:
  - determinant;
  - trace;
  - rank;
  - real eigenvalues.

### Preset matrices

Available presets depend on the dimension.

Examples include:

- identity `I`;
- scalar identity `λI`;
- zero matrix;
- reflections;
- projections;
- anisotropic diagonal scalings;
- symmetric matrices;
- shears;
- planar rotations written with sine and cosine;
- multiplication by `i` in `R²`, represented by

```text
[ 0  -1 ]
[ 1   0 ]
```

- rotations around the `x`, `y`, and `z` axes in `R³`;
- a cyclic coordinate permutation in `R³`.

### Visualization

In `R¹`, points on the line are mapped to their images.

In `R²`, the app shows:

- the original coordinate grid;
- the transformed grid;
- the standard basis vectors `e₁, e₂`;
- their images `Ae₁, Ae₂`;
- optional real eigenvector directions.

In `R³`, the app shows:

- the unit cube;
- its transformed parallelepiped;
- `e₁, e₂, e₃`;
- `Ae₁, Ae₂, Ae₃`;
- optional real eigenvector directions in an isometric projection.

For an eigenvector,

```text
Av = λv
```

so the direction is invariant under the transformation. A generic planar rotation correctly reports that it has no real eigenvectors, whereas a three-dimensional rotation shows its real rotation axis when applicable.


## 3. Image / Warp

The third tab lets you load a local image and treat it as a rectangle in the
Cartesian plane. The image stays in the browser; nothing is uploaded to a
server.

### Placement

Provide the mathematical rectangle occupied by the image:

\[
[x_{\min},x_{\max}]\times[y_{\min},y_{\max}].
\]

You can change all four coordinates manually, or drag the image in the
**Before** panel. **Center image** restores its placement, preserving the
image's aspect ratio. **Fit view** shows both the original and transformed
regions at a common scale.

The **Before** and **After** canvases use the same world-coordinate window,
whose limits can also be edited manually.

### Warp types

**Linear:** enter any invertible real \(2\times2\) matrix \(A\).

\[
T(x,y)=A(x,y)^T.
\]

Presets include identity, 30-degree rotation, shear, anisotropic scaling,
and reflection. Matrix expressions such as `cos(pi/6)` are supported.

**Nonlinear, separable by axis:** enter forward functions and their inverses:

\[
x'=\phi(x),\qquad y'=\psi(y),\qquad
x=\phi^{-1}(u),\qquad y=\psi^{-1}(v).
\]

Built-in examples include \(x'=\ln(x)\), \(y'=\exp(y)\), and both together.
The \(\ln(x)\) preset automatically moves the image into \(x>0\) if needed.
Custom functions must be invertible on the image's coordinate rectangle.
The app samples the interval to detect obvious domain or inverse mismatches;
this is a **numerical check**, not a symbolic proof of invertibility.

### Rendering

For each destination pixel \(p'\), the renderer computes \(T^{-1}(p')\),
converts that world coordinate back into the source image, and samples it
with **alpha-aware bilinear interpolation**:

\[
I_{\mathrm{out}}(p')=I_{\mathrm{source}}(T^{-1}(p')).
\]

This avoids empty holes from forward splatting. For separable maps, the
inverse is evaluated once per column and row, reducing formula evaluations
from \(O(WH)\) to \(O(W+H)\), where \(W,H\) are canvas dimensions.

- Source images are downsampled to a maximum side of 2,048 pixels to limit
  browser memory consumption.
- The preview and exported PNG have a fixed \(640\times440\) canvas resolution.
- Files over 25 MB are rejected.
- Singular matrices cannot be rendered by inverse mapping.
- Complex/non-finite values or incompatible inverses are reported as errors.
- The visual PNG export includes the coordinate grid when it is enabled.
- All processing is client-side; no extra framework or backend is required.

### How to try it

1. Open **Imagen / Warp**, upload any PNG/JPEG/WebP image.
2. Choose **Rotación 30°**, **Shear horizontal**, or **x′ = ln(x)**.
3. Drag the image in the **Before** panel or edit its coordinate rectangle.
4. Click **Ajustar vista** to compare the original and transformed image.
5. Edit individual matrix cells or formulas and save the result with **Guardar PNG**.

## Tests

The math core is independent of the browser. With Node.js 22 or later, run:

```bash
node --test tests/warp-core.test.mjs
```

Tests cover matrix inversion, singular matrices, coordinate mapping,
interpolation of opaque and transparent pixels, and viewport aspect ratio.

## Stack

- HTML
- CSS
- vanilla JavaScript
- SVG
- [Math.js](https://mathjs.org/) loaded as an ES module from jsDelivr

There is no framework, backend, build step, package manager, or database.

## Run locally

Serve the repository over HTTP:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

The repository is designed to be served directly from `main`.

In GitHub:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select **main** and **/(root)**.
4. Save.

The site URL is:

```text
https://heri-espino.github.io/functions/
```

## Repository structure

```text
functions/
├── index.html
├── style.css
├── app.js
├── image-warp.js
├── warp-core.js
├── tests/
│   └── warp-core.test.mjs
├── .nojekyll
└── README.md
```
