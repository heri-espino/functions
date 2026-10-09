import test from "node:test";
import assert from "node:assert/strict";
import {
  identity, multiply, transpose, inverse, isSymmetric, jacobiSymmetric,
  spectralDecomposition, mulVec,
} from "../spectral-core.js";

function close(A, B, tolerance = 1e-7) {
  assert.equal(A.length, B.length);
  for (let i = 0; i < A.length; i++) for (let j = 0; j < A[i].length; j++) {
    assert.ok(Math.abs(A[i][j] - B[i][j]) < tolerance,
      "mismatch at (" + i + "," + j + "): " + A[i][j] + " vs " + B[i][j]);
  }
}

test("symmetric R2 spectral decomposition A = QΛQᵀ", () => {
  const A = [[2, 1], [1, 2]];
  const result = spectralDecomposition(A);
  assert.equal(result.ok, true);
  assert.equal(result.symmetric, true);
  close(multiply(transpose(result.P), result.P), identity(2));
  close(result.stages[3], A);
  assert.ok(result.values.some(x => Math.abs(x - 3) < 1e-8));
  assert.ok(result.values.some(x => Math.abs(x - 1) < 1e-8));
});

test("symmetric R3 eigenvectors form an orthonormal basis", () => {
  const A = [[2, 1, 0], [1, 2, 1], [0, 1, 2]];
  const result = spectralDecomposition(A);
  assert.equal(result.ok, true);
  close(multiply(transpose(result.P), result.P), identity(3));
  close(result.stages[3], A, 1e-6);
  assert.ok(result.residual < 1e-6);
});

test("identity with repeated eigenvalues has complete eigenbasis", () => {
  for (const n of [1, 2, 3]) {
    const A = identity(n);
    const result = spectralDecomposition(A);
    assert.equal(result.ok, true);
    close(result.stages[3], A);
    assert.equal(result.values.length, n);
  }
});

test("real non-symmetric diagonalizable matrix uses PΛP⁻¹", () => {
  const A = [[2, 1], [0, 3]];
  const eigenpairs = [
    { value: 2, vectors: [[1, 0]] },
    { value: 3, vectors: [[1, 1]] },
  ];
  const result = spectralDecomposition(A, eigenpairs);
  assert.equal(result.ok, true);
  assert.equal(result.symmetric, false);
  close(result.stages[3], A);
  close(multiply(result.P, result.Pinv), identity(2));
});

test("planar rotation and defective shear do not have real eigenbases", () => {
  const rotation = spectralDecomposition([[0, -1], [1, 0]], []);
  const shear = spectralDecomposition([[1, 1], [0, 1]], [
    { value: 1, vectors: [[1, 0]] },
  ]);
  assert.equal(rotation.ok, false);
  assert.equal(shear.ok, false);
});

test("incorrect eigenvectors fail reconstruction residual check", () => {
  const A = [[2, 1], [0, 3]];
  const result = spectralDecomposition(A, [
    { value: 2, vectors: [[1, 0]] },
    { value: 3, vectors: [[0, 1]] },
  ]);
  assert.equal(result.ok, false);
});

test("generic matrix inverse and multiplication", () => {
  const A = [[1, 2, 3], [0, 1, 4], [5, 6, 0]];
  const inv = inverse(A);
  assert.ok(inv);
  close(multiply(A, inv), identity(3));
  assert.equal(isSymmetric(A), false);
  assert.deepEqual(mulVec(identity(3), [1, 2, 3]), [1, 2, 3]);
});
