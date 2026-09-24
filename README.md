# Function Mapper

A small static web app for visualizing real-valued functions as **maps of the real line** rather than only as Cartesian curves.

Instead of starting from

```text
y = f(x)
```

the app emphasizes

```text
x  →  f(x)
```

and, for composition,

```text
x  →  g(x)  →  f(g(x))
```

## Why

This representation makes several ideas visually explicit:

- stretching and contraction of the real line;
- orientation reversal when the derivative is negative;
- local stretching through `|f'(x)|`;
- composition as successive transformations;
- the chain rule as multiplication of local scale factors.

For small `dx`,

```text
df ≈ f'(x) dx
```

so `|f'(x)|` can be interpreted as a local stretching factor.

For a composition,

```text
|(f ∘ g)'(x)| = |f'(g(x))| |g'(x)|
```

## Features

- Enter expressions such as `x^2`, `sin(x)`, `exp(x)`, `abs(x)`, or `1/x`.
- Choose the input interval and number of sampled points.
- Click an input point to inspect its image and local derivative.
- Morph continuously from the identity map `x → x` to the selected function.
- Enable composition to visualize `x → g(x) → f(g(x))`.
- Handles non-finite points without breaking the diagram.
- Responsive, dependency-light, and fully static.

## Stack

- HTML
- CSS
- vanilla JavaScript
- SVG
- [Math.js](https://mathjs.org/) loaded as an ES module from jsDelivr

There is no framework, backend, build step, package manager, or database.

## Run locally

Because Math.js is loaded as an ES module, serve the directory with a small local HTTP server rather than opening `index.html` directly.

With Python:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

This repository is ready to be served directly from `main`.

In GitHub:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select **main** and **/(root)**.
4. Save.

The site will then be available at:

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

## Possible next steps

Natural extensions include a conventional Cartesian graph mode, draggable input points, animation of point flow, color-coding by derivative magnitude, inverse-function visualization, and two-dimensional maps where the derivative becomes a Jacobian matrix.
