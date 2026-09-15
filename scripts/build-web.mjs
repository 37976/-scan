import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const output = join(root, 'www');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'public'), output, { recursive: true });
await cp(join(root, 'src/style.css'), join(output, 'style.css'));
await build({
  entryPoints: [join(root, 'src/app.js')],
  outfile: join(output, 'app.js'),
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
});

const html = (await readFile(join(root, 'index.html'), 'utf8'))
  .replace('<link rel="manifest" href="/manifest.webmanifest" />', '')
  .replace(/href="\/src\/style\.css\?v=\d+"/, 'href="style.css"')
  .replace(/<script type="module" src="\/src\/app\.js\?v=\d+"><\/script>/, '<script src="app.js"></script>')
  .replaceAll('href="/', 'href="');
await writeFile(join(output, 'index.html'), html);

console.log('Mobile web assets written to www/.');
