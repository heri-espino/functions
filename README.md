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

## 4. Spectral decomposition and images across modes

### Spectral decomposition

Open **Transformaciones lineales** and activate **Mostrar etapas** in the
spectral section. The visualization follows a reference vector and the
coordinate grid through four explicit steps:

1. Original coordinates `x`.
2. Coordinates `z = P⁻¹x` in the eigenvector basis.
3. Componentwise scaling `Λz`.
4. Reconstruction `PΛz = Ax`.

The selected step is highlighted, and the panel displays the real eigenvalues,
a numerical eigenvector basis and the reconstruction residual.

For symmetric matrices, the app uses an orthonormal eigenbasis computed
with a Jacobi symmetric eigensolver:

```text
A = Q Λ Qᵀ,    QᵀQ = I.
```

For non-symmetric matrices that have enough independent real eigenvectors:

```text
A = P Λ P⁻¹.
```

If a real eigenbasis does not exist (e.g. a nontrivial planar rotation with
complex eigenvalues, or a defective shear), the app explicitly says so; it
does not pretend the matrix is diagonalizable over the reals. The eigenvector
overlay in the main linear explorer remains separate.

### Images in all three modes

A single loaded image is shared between **Funciones**, **Transformaciones
lineales**, and **Imagen / Warp**. You can upload it from any tab. Image
placement is edited using the four coordinate bounds in **Imagen / Warp**.

- **Funciones:** the scalar composition `F = g ∘ f` can act on either
  coordinate, `(x,y) → (F(x), y)` or `(x,y) → (x, F(y))`. This uses narrow
  forward-mapped texture strips, so non-injective functions such as `x²`
  can be visualized with overlapping/folded source regions. Rendering is
  approximate around fold points or discontinuities.
- **Transformaciones lineales, R¹:** `x` is scaled by the current
  `1×1` matrix while the image's y coordinate is unchanged.
- **Transformaciones lineales, R²:** the image is transformed by the current
  `2×2` matrix using an affine canvas texture map, including shear,
  reflection and rotation.
- **Transformaciones lineales, R³:** the image lies in the plane `z=0`
  and the full `3×3` matrix transforms that plane in `R³`. Both the
  original and transformed planes are drawn in an isometric 2D projection.

The image remains a visual aid independent of the spectral decomposition:
you can explore eigenvectors and the four spectral stages with no image
uploaded at all.

Mathematical details and known limits:

- A singular linear map can collapse a whole image into a lower-dimensional
  set; the visual affine overlay may become a line or point. The separate
  inverse-warp canvas still rejects singular maps.
- Matrices with complex eigenpairs may have no real spectral diagram of the
  `PΛP⁻¹` type. The interface reports this explicitly.
- For arbitrary scalar compositions the image overlay is a piecewise affine
  approximation, not an exact differentiable inverse texture mapping.
- Coordinate measurements are world-space, independent of the image's
  source pixel dimensions.

### Regression tests

The pure math modules are tested with Node.js 22+:

```bash
node --test tests/*.test.mjs
```

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
├── image-overlays.js
├── spectral.js
├── spectral-core.js
├── warp-core.js
├── tests/
│   ├── warp-core.test.mjs
│   └── spectral-core.test.mjs
├── .nojekyll
└── README.md
```
