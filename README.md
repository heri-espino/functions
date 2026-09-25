# Function Mapper

A static web app for visualizing real-valued functions as **maps of the real line** rather than only as Cartesian curves.

The central representation is a chain of transformations:

```text
x  →  f(x)  →  g(f(x))  →  h(g(f(x)))  →  …
```

Each horizontal axis is a copy of the real line at one stage of the composition. The same sampled points are followed from one stage to the next.

## Features

- Desmos-like expression rows for `f(x)`, `g(x)`, `h(x)`, etc.
- Add or remove functions to build a composition chain.
- Set the visible range of the initial real line with `x min` and `x max`.
- Optional **same xlim on every axis** mode.
  - Off: each image axis auto-scales to its own values.
  - On: every stage uses the initial xlim exactly.
- Straight line segments connect every point to its image.
- Uniform point sampling with configurable density.
- Arbitrary extra points:
  - type coordinates such as `-0.75, 0.2, 0.93`;
  - or click directly on the first axis.
- Two coloring modes:
  - stage colors;
  - continuous color by initial `x`.
- Continuous palettes: Viridis, Plasma, Inferno, Magma, Cividis, and Turbo.
- Composition animation:
  - `x → f(x)`;
  - then `f(x) → g(f(x))`;
  - then the next function, and so on.
- Scrubbable animation timeline and playback speed.
- Select an initial point to inspect:
  - its starting value;
  - its final image;
  - the numerical derivative of the total composition;
  - whether local orientation is preserved or reversed.
- Expressions support Math.js syntax and `ln(x)` is accepted as a convenience alias for the natural logarithm.

## Mathematical interpretation

For one function,

```text
x → f(x)
```

a small displacement satisfies

```text
df ≈ f'(x) dx
```

so `|f'(x)|` is the local stretching factor.

For a chain

```text
x → f(x) → g(f(x))
```

the total local stretching is

```text
|(g ∘ f)'(x)| = |g'(f(x))| |f'(x)|
```

and the same interpretation extends to longer compositions.

## Stack

- HTML
- CSS
- vanilla JavaScript
- SVG
- [Math.js](https://mathjs.org/) loaded as an ES module from jsDelivr

There is no framework, backend, build step, package manager, or database.

## Run locally

Serve the repository over HTTP so the ES module can load correctly:

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
