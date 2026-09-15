import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

async function runScanRestore(request, response) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of request) { size += chunk.length; if (size > 40 * 1024 * 1024) throw new Error('图片过大'); chunks.push(chunk); }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const match = String(payload.image || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) throw new Error('无效的图片数据');
    const work = await mkdtemp(join(tmpdir(), 'pocketscan-restore-'));
    const input = join(work, 'input.png'); const output = join(work, 'output.png'); const metadata = join(work, 'output.json');
    try {
      await writeFile(input, Buffer.from(match[1], 'base64'));
      await new Promise((resolve, reject) => {
        const child = spawn('python3', [join(root, 'scripts/scan_restore.py'), input, output, metadata], { cwd: root });
        let error = '';
        child.stderr.on('data', data => { error += data; }); child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(error.trim() || `扫描精修退出码 ${code}`)));
      });
      const [image, details] = await Promise.all([readFile(output), readFile(metadata, 'utf8')]);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ image: `data:image/png;base64,${image.toString('base64')}`, metadata: JSON.parse(details) }));
    } finally { await rm(work, { recursive: true, force: true }); }
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: error.message })); }
}

async function runCornerDetection(request, response) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of request) { size += chunk.length; if (size > 40 * 1024 * 1024) throw new Error('图片过大'); chunks.push(chunk); }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const match = String(payload.image || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) throw new Error('无效的图片数据');
    const work = await mkdtemp(join(tmpdir(), 'pocketscan-corners-')); const input = join(work, 'input.jpg');
    try {
      await writeFile(input, Buffer.from(match[1], 'base64'));
      const output = await new Promise((resolve, reject) => {
        const child = spawn('python3', [join(root, 'scripts/detect_corners.py'), input], { cwd: root });
        let stdout = '', error = '';
        child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { error += data; }); child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(error.trim() || `四角检测退出码 ${code}`)));
      });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(output);
    } finally { await rm(work, { recursive: true, force: true }); }
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: error.message })); }
}

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (request.method === 'POST' && pathname === '/api/detect-corners') { runCornerDetection(request, response); return; }
  if (request.method === 'POST' && pathname === '/api/scan-restore') { runScanRestore(request, response); return; }
  if (pathname.startsWith('/api/')) { response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: '接口不存在' })); return; }
  let file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(root)) { response.writeHead(403).end('Forbidden'); return; }
  if (!existsSync(file) && existsSync(join(root, 'public', pathname))) file = normalize(join(root, 'public', pathname));
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); }
  catch { file = join(root, 'index.html'); }
  response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-cache');
  createReadStream(file).on('error', () => response.writeHead(404).end('Not found')).pipe(response);
}).listen(port, '0.0.0.0', () => console.log(`PocketScan: http://localhost:${port}`));
