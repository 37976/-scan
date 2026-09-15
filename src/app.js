import { fileToDataUrl, detectionPreview, suggestCorners, perspectiveCrop, rotateImage, defaultCorners } from './image.js?v=23';
import { createPdf, dataUrlToBytes } from './pdf.js?v=22';
import { loadDocument, saveDocument, clearDocument } from './storage.js?v=22';
import { nativeScanner, sharePdfNatively } from './native.js?v=2';

const state = { id: 'current', name: '我的扫描文档', createdAt: Date.now(), updatedAt: Date.now(), pages: [], editing: null, preview: null, previewOriginal: false, exportOpen: false, busy: '', toast: '' };
const app = document.querySelector('#app');
let saveTimer; let drag = null;

function icon(name) { return ({ camera: '◉', gallery: '▧', pdf: '⇩', rotate: '↻', up: '←', down: '→', delete: '×' })[name] || name; }

function render() {
  app.innerHTML = `<main class="app-shell">
    <header class="topbar"><div class="brand"><div class="brand-mark">⌑</div><div><h1>掌上扫描</h1><div class="subtitle">PRIVATE · OFFLINE · YOURS</div></div></div><button class="icon-button" data-action="new" aria-label="新建文档">＋</button></header>
    <section class="hero"><div class="hero-kicker">POCKET SCANNER</div><h2>${state.pages.length ? '文档已就绪，可以继续添加或导出' : '把纸张，变成整洁的数字文档'}</h2><p>图像仅在本设备处理，不会发送到第三方。</p><div class="stats"><div class="stat"><strong>${state.pages.length}</strong><span>当前页数</span></div><div class="stat"><strong>${state.pages.length ? '已保存' : '待扫描'}</strong><span>本地状态</span></div></div></section>
    <section class="section"><div class="section-title"><h3>${escapeHtml(state.name)}</h3><span>${state.pages.length ? `${state.pages.length} 页` : '新文档'}</span></div>
      ${state.pages.length ? `<div class="pages">${state.pages.map((page, index) => `<article class="page-card"><span class="page-number">${index + 1}</span><span class="rebuild-badge">${page.processedDataUrl ? (page.restoration?.ghostCorrection ? '最新精修 · 已自动去鬼影' : '最新精修 · 保留原迹') : '待生成扫描件'}</span><button class="page-preview" data-action="preview" data-index="${index}" aria-label="查看扫描页 ${index + 1}"><img src="${page.processedDataUrl || page.originalDataUrl}" alt="扫描页 ${index + 1}"><span>点击查看扫描效果</span></button><div class="page-actions"><button data-action="up" data-index="${index}" aria-label="向前移动">${icon('up')}</button><button data-action="rotate" data-index="${index}">${icon('rotate')}</button><button data-action="edit" data-index="${index}">重新精修</button><button class="danger" data-action="delete" data-index="${index}">${icon('delete')}</button><button data-action="down" data-index="${index}" aria-label="向后移动">${icon('down')}</button></div></article>`).join('')}</div>` : `<div class="empty"><div class="empty-symbol"></div><strong>还没有扫描页</strong><div style="font-size:13px;margin-top:7px">使用下方按钮拍摄文档或从相册导入</div></div>`}
    </section>
    <nav class="bottom-actions"><button class="action" data-action="camera">${icon('camera')} 拍摄<span>调用手机相机</span></button><button class="action" data-action="gallery">${icon('gallery')} 导入<span>支持多选图片</span></button><button class="action primary" data-action="pdf" ${state.pages.length ? '' : 'disabled'}>${icon('pdf')} 导出 PDF<span>本地即时生成</span></button></nav>
    <input id="cameraInput" type="file" accept="image/*" capture="environment" hidden><input id="galleryInput" type="file" accept="image/*" multiple hidden>
    ${state.editing ? editorTemplate() : ''}${state.preview !== null ? previewTemplate() : ''}${state.exportOpen ? exportTemplate() : ''}${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}${state.busy ? `<div class="busy"><div><div class="spinner"></div>${escapeHtml(state.busy)}</div></div>` : ''}
  </main>`;
  bindEditor();
}

function editorTemplate() {
  const e = state.editing; const p = e.page; const originalWidth = p.originalWidth || p.width; const originalHeight = p.originalHeight || p.height; const points = ['tl', 'tr', 'br', 'bl'].map(k => `${e.corners[k].x},${e.corners[k].y}`).join(' ');
  const cornerStatus = e.cornerConfidence
    ? `✓ 已自动框选文档四角 · 置信度 ${Math.round(e.cornerConfidence * 100)}%，可拖动圆点微调`
    : '未识别到清晰纸张边缘，已使用安全边距，可拖动圆点微调';
  return `<div class="modal"><div class="modal-head"><button data-action="close-editor">取消</button><h3>文档校正</h3><div><button data-action="full-page">全页</button><button data-action="reset-corners">自动框选</button></div></div><div class="crop-stage" id="cropStage"><div class="crop-wrap" id="cropWrap" style="aspect-ratio:${originalWidth}/${originalHeight}"><img src="${p.originalDataUrl}"><svg class="crop-svg" viewBox="0 0 ${originalWidth} ${originalHeight}" preserveAspectRatio="none"><polygon class="crop-polygon" points="${points}"/>${Object.entries(e.corners).map(([key, c]) => `<circle class="crop-handle" data-corner="${key}" cx="${c.x}" cy="${c.y}" r="11"/>`).join('')}</svg></div></div><div class="modal-tools"><div class="corner-status">${cornerStatus}</div><div class="auto-note">使用最新精修扫描：四角透视校正、残余倾斜修正、去阴影和褶皱，同时保留连续表格线、原始字迹与印章</div><div class="filter-note">无需选择处理方法，约 3–8 秒自动完成</div><button class="confirm" data-action="apply-crop">校正并生成扫描文档</button></div></div>`;
}

function exportTemplate() { return `<div class="export-sheet"><div class="sheet"><h3>导出 PDF</h3><div class="field"><label>文件名</label><input id="pdfName" value="${escapeHtml(state.name)}"></div><div class="field"><label>页面尺寸</label><select id="pageSize"><option value="a4">A4（自动横竖）</option><option value="original">跟随图片尺寸</option></select></div><div class="field"><label>页边距</label><select id="margin"><option value="24">标准</option><option value="0">无边距</option><option value="48">宽边距</option></select></div><div class="sheet-actions"><button class="cancel" data-action="close-export">取消</button><button class="export" data-action="download-pdf">生成并保存 · ${state.pages.length} 页</button></div></div></div>`; }
function previewTemplate() { const page = state.pages[state.preview]; const original = state.previewOriginal || !page.processedDataUrl; return `<div class="preview-modal"><header><button data-action="close-preview">关闭</button><strong>${original ? '拍摄原图' : '精修扫描件'} · 第 ${state.preview + 1} 页</strong><button data-action="toggle-preview">${original ? '看处理结果' : '核对原图'}</button></header><div class="preview-canvas"><img src="${original ? page.originalDataUrl : page.processedDataUrl}" alt="扫描效果预览"></div></div>`; }

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]); }
function notify(message) { state.toast = message; render(); setTimeout(() => { state.toast = ''; render(); }, 2200); }
function persist() { clearTimeout(saveTimer); state.updatedAt = Date.now(); saveTimer = setTimeout(() => saveDocument({ id: state.id, name: state.name, createdAt: state.createdAt, updatedAt: state.updatedAt, pages: state.pages }).catch(() => notify('本地保存失败')), 250); }
function newId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

async function importFiles(files) {
  if (!files.length) return; state.busy = `正在处理 1 / ${files.length}`; render();
  try {
    for (let i = 0; i < files.length; i++) {
      state.busy = `正在处理 ${i + 1} / ${files.length}`; render();
      const img = await fileToDataUrl(files[i]); state.busy = `正在自动框选 ${i + 1} / ${files.length}`; render();
      const detected = await autoDetectCorners(img.dataUrl);
      state.pages.push({ id: newId(), originalDataUrl: img.dataUrl, processedDataUrl: '', originalWidth: img.width, originalHeight: img.height, width: img.width, height: img.height, corners: detected.corners, cornerConfidence: detected.confidence });
    }
    persist(); state.busy = ''; render(); openEditor(state.pages.length - files.length);
  } catch (error) { state.busy = ''; notify(`图片读取失败：${error.message}`); }
}

function openEditor(index) { const page = state.pages[index]; state.editing = { index, page, corners: structuredClone(page.corners), cornerConfidence: page.cornerConfidence || 0 }; render(); }
function movePage(index, change) { const target = index + change; if (target < 0 || target >= state.pages.length) return; [state.pages[index], state.pages[target]] = [state.pages[target], state.pages[index]]; persist(); render(); }

async function handleAction(action, index) {
  if (action === 'camera') document.querySelector('#cameraInput').click();
  if (action === 'gallery') document.querySelector('#galleryInput').click();
  if (action === 'pdf') { state.exportOpen = true; render(); }
  if (action === 'close-export') { state.exportOpen = false; render(); }
  if (action === 'edit') openEditor(index);
  if (action === 'preview') { state.preview = index; state.previewOriginal = false; render(); }
  if (action === 'close-preview') { state.preview = null; render(); }
  if (action === 'toggle-preview') { state.previewOriginal = !state.previewOriginal; render(); }
  if (action === 'up') movePage(index, -1);
  if (action === 'down') movePage(index, 1);
  if (action === 'delete') { state.pages.splice(index, 1); persist(); render(); }
  if (action === 'rotate') {
    state.busy = '正在旋转页面'; render(); const page = state.pages[index];
    const original = await rotateImage(page.originalDataUrl); const processed = page.processedDataUrl ? await rotateImage(page.processedDataUrl) : null;
    const oldHeight = page.originalHeight || page.height; const oldCorners = page.corners;
    page.originalDataUrl = original.dataUrl; page.processedDataUrl = processed?.dataUrl || '';
    page.originalWidth = original.width; page.originalHeight = original.height;
    page.width = processed?.width || original.width; page.height = processed?.height || original.height;
    page.corners = { tl: { x: oldHeight - oldCorners.bl.y, y: oldCorners.bl.x }, tr: { x: oldHeight - oldCorners.tl.y, y: oldCorners.tl.x }, br: { x: oldHeight - oldCorners.tr.y, y: oldCorners.tr.x }, bl: { x: oldHeight - oldCorners.br.y, y: oldCorners.br.x } };
    persist(); state.busy = ''; render();
  }
  if (action === 'close-editor') { state.editing = null; render(); }
  if (action === 'reset-corners') { state.busy = '正在重新识别文档四角'; render(); const detected = await autoDetectCorners(state.editing.page.originalDataUrl); state.editing.corners = detected.corners; state.editing.cornerConfidence = detected.confidence; state.busy = ''; render(); }
  if (action === 'full-page') { const page = state.editing.page; state.editing.corners = defaultCorners(page.originalWidth || page.width, page.originalHeight || page.height); state.editing.cornerConfidence = 0; render(); }
  if (action === 'apply-crop') await applyCrop();
  if (action === 'download-pdf') await downloadPdf();
  if (action === 'new') { if (state.pages.length && !confirm('新建文档会清除当前本地文档，是否继续？')) return; state.pages = []; state.name = '我的扫描文档'; state.createdAt = Date.now(); await clearDocument(); render(); }
}

async function autoDetectCorners(dataUrl) {
  try {
    const scanner = await nativeScanner();
    if (scanner) {
      const preview = await detectionPreview(dataUrl);
      const detected = await withTimeout(scanner.detectCorners({ image: preview.dataUrl }), 8000, '自动框选超时');
      const scaleX = preview.sourceWidth / preview.width;
      const scaleY = preview.sourceHeight / preview.height;
      detected.corners = Object.fromEntries(Object.entries(detected.corners).map(([key, point]) => [key, { x: point.x * scaleX, y: point.y * scaleY }]));
      return detected;
    }
    const response = await fetch('/api/detect-corners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl }) });
    if (!response.ok) throw new Error('服务不可用');
    return await response.json();
  } catch {
    return { corners: await suggestCorners(dataUrl), confidence: 0, method: 'browser-fallback' };
  }
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
  ]);
}

async function applyCrop() {
  const editing = state.editing; state.busy = '正在矫正和增强'; render();
  try {
    state.busy = '正在按四角校正并保护表格原迹'; render();
    const restored = await restoreScan(editing.page.originalDataUrl, editing.corners);
    Object.assign(state.pages[editing.index], { processedDataUrl: restored.image, width: restored.metadata.width, height: restored.metadata.height, corners: editing.corners, cornerConfidence: editing.cornerConfidence, restoration: restored.metadata });
    state.editing = null; persist(); state.busy = ''; render(); notify(restored.metadata.ghostCorrection ? '检测到模糊鬼影，已自动校正' : '最新精修扫描件已生成');
  }
  catch (error) { state.busy = ''; notify(error.message); }
}

async function postImage(endpoint, image) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
  if (!response.ok) { const problem = await response.json().catch(() => ({})); throw new Error(problem.error || '本地 AI 服务不可用'); }
  return response;
}

async function cropForRestoration(originalDataUrl, corners) {
  if (!corners) return originalDataUrl;
  return (await perspectiveCrop(originalDataUrl, corners)).dataUrl;
}

async function restoreScan(originalDataUrl, corners) {
  const cropped = await cropForRestoration(originalDataUrl, corners);
  const scanner = await nativeScanner();
  if (scanner) return scanner.restore({ image: cropped });
  return postImage('/api/scan-restore', cropped).then(response => response.json());
}

async function downloadPdf() {
  const name = document.querySelector('#pdfName').value.trim() || '扫描文档'; const pageSize = document.querySelector('#pageSize').value; const margin = Number(document.querySelector('#margin').value);
  state.busy = '正在生成 PDF'; state.exportOpen = false; render();
  try {
    const pages = [];
    for (const page of state.pages) { let dataUrl = page.processedDataUrl; let width = page.width, height = page.height; if (!dataUrl) { const restored = await restoreScan(page.originalDataUrl, page.corners); dataUrl = restored.image; width = restored.metadata.width; height = restored.metadata.height; page.restoration = restored.metadata; } pages.push({ bytes: dataUrlToBytes(dataUrl), width, height }); }
    const blob = createPdf(pages, { pageSize, margin }); state.name = name; persist(); const fileName = `${name.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
    if (await sharePdfNatively(blob, fileName, name)) { /* Native share sheet opened. */ }
    else if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: 'application/pdf' })] })) await navigator.share({ files: [new File([blob], fileName, { type: 'application/pdf' })], title: name });
    else { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
    state.busy = ''; render(); notify('PDF 已生成');
  } catch (error) { state.busy = ''; notify(`导出失败：${error.message}`); }
}

function bindEditor() {
  const stage = document.querySelector('#cropStage'); const wrap = document.querySelector('#cropWrap'); if (!stage || !wrap) return;
  const fit = () => { const p = state.editing.page; const width = p.originalWidth || p.width; const height = p.originalHeight || p.height; const maxW = stage.clientWidth - 28, maxH = stage.clientHeight - 20; const scale = Math.min(maxW / width, maxH / height); wrap.style.width = `${width * scale}px`; wrap.style.height = `${height * scale}px`; };
  requestAnimationFrame(fit);
}

document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) handleAction(button.dataset.action, Number(button.dataset.index)); });
document.addEventListener('change', event => { if (event.target.matches('#cameraInput, #galleryInput')) { importFiles([...event.target.files]); event.target.value = ''; } });
document.addEventListener('pointerdown', event => { const handle = event.target.closest('[data-corner]'); if (!handle || !state.editing) return; handle.setPointerCapture(event.pointerId); drag = { key: handle.dataset.corner, svg: handle.ownerSVGElement }; });
document.addEventListener('pointermove', event => { if (!drag || !state.editing) return; const rect = drag.svg.getBoundingClientRect(); const p = state.editing.page; const width = p.originalWidth || p.width; const height = p.originalHeight || p.height; state.editing.corners[drag.key] = { x: Math.max(0, Math.min(width, (event.clientX - rect.left) / rect.width * width)), y: Math.max(0, Math.min(height, (event.clientY - rect.top) / rect.height * height)) }; const c = state.editing.corners; drag.svg.querySelector(`[data-corner="${drag.key}"]`).setAttribute('cx', c[drag.key].x); drag.svg.querySelector(`[data-corner="${drag.key}"]`).setAttribute('cy', c[drag.key].y); drag.svg.querySelector('polygon').setAttribute('points', ['tl','tr','br','bl'].map(k => `${c[k].x},${c[k].y}`).join(' ')); });
document.addEventListener('pointerup', () => { drag = null; });

async function start() {
  render();
  try {
    const saved = await loadDocument();
    if (saved) {
      Object.assign(state, saved);
      let invalidated = false;
      for (const page of state.pages) {
        if ('filter' in page || 'ocr' in page) {
          delete page.filter; delete page.ocr; invalidated = true;
        }
        if (page.restoration?.algorithmVersion !== 8) {
          page.processedDataUrl = ''; page.restoration = null; invalidated = true;
        }
      }
      if (invalidated) persist();
    }
  } catch { /* IndexedDB may be blocked in private mode. */ }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
start();
