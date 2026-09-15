import { access, readFile } from 'node:fs/promises';

const required = ['index.html', 'public/sw.js', 'public/manifest.webmanifest', 'public/icon.svg', 'src/app.js', 'src/style.css', 'src/image.js', 'src/pdf.js', 'src/storage.js'];
await Promise.all(required.map(file => access(file)));
const html = await readFile('index.html', 'utf8');
const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
if (!html.includes('/src/app.js')) throw new Error('index.html 缺少应用入口');
if (manifest.display !== 'standalone') throw new Error('PWA manifest 配置不完整');
console.log(`PocketScan build verified: ${required.length} assets, zero runtime dependencies.`);
