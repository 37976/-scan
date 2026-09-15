export const defaultCorners = (width, height) => ({
  tl: { x: width * 0.035, y: height * 0.035 }, tr: { x: width * 0.965, y: height * 0.035 },
  br: { x: width * 0.965, y: height * 0.965 }, bl: { x: width * 0.035, y: height * 0.965 }
});

export function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

export function otsuThreshold(values) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[Math.max(0, Math.min(255, Math.round(value)))]++;
  const total = values.length;
  let weightedTotal = 0;
  for (let i = 0; i < 256; i++) weightedTotal += i * histogram[i];
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 127;
  for (let i = 0; i < 256; i++) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; threshold = i; }
  }
  return threshold;
}

function polygonArea(corners) {
  const points = [corners.tl, corners.tr, corners.br, corners.bl];
  let area = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; area += a.x * b.y - b.x * a.y; }
  return Math.abs(area) / 2;
}

export function detectDocumentCorners(luminance, width, height) {
  const threshold = otsuThreshold(luminance);
  const patchMean = (cx, cy) => {
    const radius = Math.max(2, Math.round(Math.min(width, height) * .035)); let sum = 0, count = 0;
    for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) { sum += luminance[y * width + x]; count++; }
    return sum / count;
  };
  const centreMean = patchMean(Math.round(width / 2), Math.round(height / 2));
  const cornerMean = [patchMean(1, 1), patchMean(width - 2, 1), patchMean(width - 2, height - 2), patchMean(1, height - 2)].reduce((sum, value) => sum + value, 0) / 4;
  if (Math.abs(centreMean - cornerMean) < 18) return null;
  const paperIsBright = centreMean > cornerMean;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = paperIsBright ? +(luminance[i] > threshold) : +(luminance[i] < threshold);
  // Close small text and table-line gaps without adding a heavyweight vision dependency.
  const closed = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let neighbours = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) neighbours += mask[(y + dy) * width + x + dx];
    if (neighbours >= 5) closed[y * width + x] = 1;
  }
  const visited = new Uint8Array(closed.length); const queue = new Int32Array(closed.length); const components = [];
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start] || visited[start]) continue;
    let head = 0, tail = 0, area = 0; queue[tail++] = start; visited[start] = 1;
    let tl = { x: width, y: height, score: Infinity }, tr = { x: 0, y: height, score: -Infinity }, br = { x: 0, y: 0, score: -Infinity }, bl = { x: width, y: 0, score: Infinity };
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width); area++;
      const sum = x + y, diff = x - y;
      if (sum < tl.score) tl = { x, y, score: sum }; if (diff > tr.score) tr = { x, y, score: diff };
      if (sum > br.score) br = { x, y, score: sum }; if (diff < bl.score) bl = { x, y, score: diff };
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= closed.length || visited[next] || !closed[next]) continue;
        const nx = next % width; if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1; queue[tail++] = next;
      }
    }
    if (area > width * height * .08) components.push({ area, corners: { tl, tr, br, bl } });
  }
  components.sort((a, b) => b.area - a.area);
  for (const component of components) {
    const corners = Object.fromEntries(Object.entries(component.corners).map(([key, point]) => [key, { x: point.x, y: point.y }]));
    const area = polygonArea(corners);
    const centreX = (corners.tl.x + corners.tr.x + corners.br.x + corners.bl.x) / 4;
    const centreY = (corners.tl.y + corners.tr.y + corners.br.y + corners.bl.y) / 4;
    if (area > width * height * .18 && Math.abs(centreX - width / 2) < width * .25 && Math.abs(centreY - height / 2) < height * .25) return corners;
  }
  return null;
}

export async function fileToDataUrl(file, maxSide = 2800) {
  const raw = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
  const image = await loadImage(raw);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.95), width: canvas.width, height: canvas.height };
}

export async function detectionPreview(dataUrl, maxSide = 1100) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (scale === 1) return { dataUrl, width: image.width, height: image.height, sourceWidth: image.width, sourceHeight: image.height };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    width: canvas.width,
    height: canvas.height,
    sourceWidth: image.width,
    sourceHeight: image.height,
  };
}

export async function suggestCorners(dataUrl) {
  const image = await loadImage(dataUrl);
  const size = 240;
  const scale = Math.min(size / image.width, size / image.height);
  const w = Math.max(24, Math.round(image.width * scale)); const h = Math.max(24, Math.round(image.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data; const luminance = new Float32Array(w * h);
  for (let i = 0; i < luminance.length; i++) luminance[i] = pixels[i * 4] * .299 + pixels[i * 4 + 1] * .587 + pixels[i * 4 + 2] * .114;
  const detected = detectDocumentCorners(luminance, w, h);
  if (!detected) return defaultCorners(image.width, image.height);
  return Object.fromEntries(Object.entries(detected).map(([key, point]) => [key, { x: point.x / scale, y: point.y / scale }]));
}

function solve8(matrix, vector) {
  const n = 8; const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    [a[i], a[pivot]] = [a[pivot], a[i]]; const div = a[i][i];
    if (Math.abs(div) < 1e-10) throw new Error('裁剪区域无效');
    for (let c = i; c <= n; c++) a[i][c] /= div;
    for (let r = 0; r < n; r++) if (r !== i) { const factor = a[r][i]; for (let c = i; c <= n; c++) a[r][c] -= factor * a[i][c]; }
  }
  return a.map(row => row[n]);
}

function homography(dst, src) {
  const m = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i]; const { x: u, y: v } = src[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve8(m, b), 1];
}

export async function perspectiveCrop(dataUrl, corners) {
  const image = await loadImage(dataUrl); const c = corners;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.max(80, Math.round(Math.max(distance(c.tl, c.tr), distance(c.bl, c.br))));
  const height = Math.max(80, Math.round(Math.max(distance(c.tl, c.bl), distance(c.tr, c.br))));
  const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true }); sourceCtx.drawImage(image, 0, 0);
  const src = sourceCtx.getImageData(0, 0, source.width, source.height); const output = document.createElement('canvas'); output.width = width; output.height = height;
  const outCtx = output.getContext('2d'); const dst = outCtx.createImageData(width, height);
  const h = homography([{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }], [c.tl, c.tr, c.br, c.bl]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const d = h[6] * x + h[7] * y + 1; const sx = Math.max(0, Math.min(src.width - 1.001, (h[0] * x + h[1] * y + h[2]) / d)); const sy = Math.max(0, Math.min(src.height - 1.001, (h[3] * x + h[4] * y + h[5]) / d));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1); const tx = sx - x0, ty = sy - y0; const di = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) { const top = src.data[(y0 * src.width + x0) * 4 + channel] * (1 - tx) + src.data[(y0 * src.width + x1) * 4 + channel] * tx; const bottom = src.data[(y1 * src.width + x0) * 4 + channel] * (1 - tx) + src.data[(y1 * src.width + x1) * 4 + channel] * tx; dst.data[di + channel] = top * (1 - ty) + bottom * ty; }
    dst.data[di + 3] = 255;
  }
  outCtx.putImageData(dst, 0, 0);
  return { dataUrl: output.toDataURL('image/jpeg', .95), width: output.width, height: output.height };
}

export async function rotateImage(dataUrl) {
  const image = await loadImage(dataUrl); const canvas = document.createElement('canvas'); canvas.width = image.height; canvas.height = image.width;
  const ctx = canvas.getContext('2d'); ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, 0, 0);
  return { dataUrl: canvas.toDataURL('image/jpeg', .9), width: canvas.width, height: canvas.height };
}
