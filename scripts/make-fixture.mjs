// 一次性生成冒烟测试用的 GLB 固定文件(经 vite dev 服务,在页面内用 GLTFExporter 导出演示模型)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 4551;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'pipe',
});
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes('Local') && res());
  setTimeout(() => rej(new Error('dev server start timeout')), 20000);
});

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
await page.click('#btn-demo');
await new Promise((r) => setTimeout(r, 800));

const base64 = await page.evaluate(async () => {
  const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
  const app = window.__app;
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(app.modelRoot, res, rej, { binary: true }));
  const bytes = new Uint8Array(glb);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});

const dir = new URL('./fixtures/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/demo.glb`, Buffer.from(base64, 'base64'));
console.log('written scripts/fixtures/demo.glb');

await browser.close();
server.kill();
