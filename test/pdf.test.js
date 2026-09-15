import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdf } from '../src/pdf.js';

test('creates a structurally complete single-page PDF', async () => {
  const blob = createPdf([{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 10, height: 20 }]);
  const text = await blob.text();
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Count 1/);
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /%%EOF$/);
});

test('rejects an empty document', () => assert.throws(() => createPdf([]), /至少需要一页/));
