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
├── .nojekyll
└── README.md
```
