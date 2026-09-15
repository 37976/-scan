import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDocumentCorners, otsuThreshold } from '../src/image.js';

test('otsu separates a dark desk from white paper', () => {
  assert.ok(otsuThreshold(new Float32Array([20, 22, 24, 225, 230, 235])) < 225);
});

test('detects a photographed trapezoid for perspective correction', () => {
  const width = 100, height = 120; const pixels = new Float32Array(width * height).fill(28);
  const expected = { tl: { x: 18, y: 12 }, tr: { x: 84, y: 22 }, br: { x: 92, y: 108 }, bl: { x: 9, y: 103 } };
  const polygon = [expected.tl, expected.tr, expected.br, expected.bl];
  const inside = (x, y) => { let result = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const a = polygon[i], b = polygon[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result; } return result; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inside(x, y)) pixels[y * width + x] = 232;
  const detected = detectDocumentCorners(pixels, width, height);
  assert.ok(detected);
  for (const key of ['tl', 'tr', 'br', 'bl']) { assert.ok(Math.abs(detected[key].x - expected[key].x) < 4, JSON.stringify(detected)); assert.ok(Math.abs(detected[key].y - expected[key].y) < 4, JSON.stringify(detected)); }
});
