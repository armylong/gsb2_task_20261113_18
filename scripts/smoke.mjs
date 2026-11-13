// 冒烟测试:启动 preview 服务器,用系统 Chrome 走一遍核心流程
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 4519;
const PAGE_URL = `http://localhost:${PORT}/`;
const DL = new URL('./downloads/', import.meta.url).pathname;
mkdirSync(DL, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'pipe',
});
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes('Local') && res());
  server.stderr.on('data', (d) => process.stderr.write(d));
  setTimeout(() => rej(new Error('server start timeout')), 15000);
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

try {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  await page.goto(PAGE_URL, { waitUntil: 'networkidle0' });
  check('页面加载', await page.$('#viewport canvas') !== null);

  // 1. 加载演示模型
  await page.click('#btn-demo');
  await page.waitForFunction(() => document.querySelectorAll('#tree .tree-row').length >= 5, { timeout: 5000 });
  const rowCount = (await page.$$('#tree .tree-row')).length;
  check('演示模型加载,层级树展示', rowCount >= 5, `${rowCount} 个节点`);

  // 2. 层级选择同步
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tree .tree-row')];
    rows.find((r) => r.textContent.includes('Shaft')).click();
  });
  await new Promise((r) => setTimeout(r, 200));
  const selText = await page.$eval('#info-panel', (el) => el.textContent);
  check('层级选择同步高亮', selText.includes('Shaft'));

  // 3. 隐藏/单独/恢复
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tree .tree-row')];
    const row = rows.find((r) => r.textContent.includes('CoverBlock'));
    row.querySelector('button').click(); // 隐藏
  });
  let hiddenRow = await page.$eval('#tree', (el) => el.querySelector('.hidden-node') !== null);
  check('隐藏零件', hiddenRow);
  await page.evaluate(() => [...document.querySelectorAll('#tree button')].find((b) => b.textContent === '全部显示').click());
  hiddenRow = await page.$eval('#tree', (el) => el.querySelector('.hidden-node') !== null);
  check('恢复全部显示', !hiddenRow);

  // 4. 视角切换不清状态 + 剖切
  await page.click('button[data-view="top"]');
  await page.click('button[data-view="persp"]');
  await page.evaluate(() => {
    const row = document.querySelectorAll('#clip-panel .clip-row')[1]; // Y 轴
    row.querySelector('input[type=checkbox]').click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const infoAfterClip = await page.$eval('#info-panel', (el) => el.textContent);
  check('开启 Y 剖切并在视角切换后保留', infoAfterClip.includes('Y='));

  // 5. 测量:在底板顶面已知点上点选(-50,10,-30)→(50,10,-30) 距离 100mm,
  //    第三点 (50,10,30) 与前一线段成 90°
  await page.click('#tool-measure');
  const clickWorld = async (x, y, z) => {
    const p = await page.evaluate(([a, b, c]) => window.__app.worldToClient(a, b, c), [x, y, z]);
    await page.mouse.click(p.x, p.y);
    await new Promise((r) => setTimeout(r, 200));
  };
  await clickWorld(-50, 10, -30);
  await clickWorld(50, 10, -30);
  await clickWorld(50, 10, 30);
  await new Promise((r) => setTimeout(r, 300));
  const measureText = await page.$eval('#measure-list', (el) => el.textContent);
  check(
    '两点测距 100mm + 第三点测角 90°(已知尺寸核对)',
    measureText.includes('100.00 mm') && measureText.includes('90.00'),
    measureText.replace(/\s+/g, ' ').slice(0, 80),
  );

  // 5b. 被剖掉的表面不能作为测量点(Y 剖切保留 y≤~49,轴顶 y≈106 已被裁掉)
  await clickWorld(17.6, 106.6, 32.9);
  const pickState = await page.evaluate(() => ({
    pending: window.__app.measure.pendingCount,
    total: window.__app.measure.getAll().length,
  }));
  check('被剖掉的点不可选为测量点', pickState.pending === 0 && pickState.total === 1);

  // 6. 单位切换
  await page.click('#unit-cm');
  const cmText = await page.$eval('#measure-list', (el) => el.textContent);
  check('单位切换 cm', cmText.includes('cm'));
  await page.click('#unit-mm');

  // 7. 保存工程
  await page.click('#btn-save-project');
  await new Promise((r) => setTimeout(r, 800));
  const projFile = `${DL}/演示模型.miproj.json`;
  check('保存工程文件', existsSync(projFile));
  const proj = JSON.parse(readFileSync(projFile, 'utf8'));
  check(
    '工程包含模型/相机/剖切/单位/测量',
    proj.model?.kind === 'demo' && Array.isArray(proj.camera?.position) && proj.clipping?.length === 3 && proj.unit === 'mm' && proj.measurements?.length === 1,
  );

  // 8. 导出报告
  await page.click('#btn-export-report');
  await new Promise((r) => setTimeout(r, 800));
  const reportFile = `${DL}/演示模型-report.json`;
  check('导出测量报告', existsSync(reportFile));
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  check(
    '报告字段完整',
    report.model === '演示模型' && report.unit === 'mm' && report.measurements[0]?.points?.length === 3 &&
      typeof report.measurements[0]?.distance === 'number' && typeof report.measurements[0]?.angleDeg === 'number' &&
      Array.isArray(report.clipping),
  );

  // 9. 导出 PNG
  await page.click('#btn-export-png');
  await new Promise((r) => setTimeout(r, 1000));
  check('导出 PNG', existsSync(`${DL}/演示模型.png`));

  // 10. 重新打开工程恢复现场
  await page.evaluate(() => document.querySelector('#btn-clear-measure').click());
  const [chooser] = await Promise.all([
    page.waitForFileChooser(),
    page.click('#btn-open-project'),
  ]);
  await chooser.accept([projFile]);
  await page.waitForFunction(() => document.querySelector('#measure-list').textContent.includes('距离'), { timeout: 5000 });
  const restoredInfo = await page.$eval('#info-panel', (el) => el.textContent);
  check('工程恢复(测量+剖切)', restoredInfo.includes('Y='));

  // 11. 坏工程文件不破坏现场
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${DL}/bad.json`, '{"broken": true}');
  const [chooser2] = await Promise.all([
    page.waitForFileChooser(),
    page.click('#btn-open-project'),
  ]);
  await chooser2.accept([`${DL}/bad.json`]);
  await new Promise((r) => setTimeout(r, 500));
  const errStatus = await page.$eval('#status', (el) => el.textContent);
  const stillThere = await page.$eval('#measure-list', (el) => el.textContent.includes('距离'));
  check('坏工程提示原因且保留现场', errStatus.includes('失败') && stillThere, errStatus.slice(0, 40));

  // 12. 重新加载演示模型后测量被清理
  await page.click('#btn-demo');
  await new Promise((r) => setTimeout(r, 500));
  const cleared = await page.$eval('#measure-list', (el) => el.textContent.includes('暂无测量'));
  check('切换模型后旧测量被清理', cleared);

  // 13. 真实 GLB 流程:加载预生成的 GLB 固定文件(由演示模型导出)
  const glbPath = new URL('./fixtures/demo.glb', import.meta.url).pathname;
  const { existsSync: existsGlb, writeFileSync: wf } = await import('node:fs');
  if (!existsGlb(glbPath)) {
    check('真实 GLB 流程', false, '缺少 scripts/fixtures/demo.glb, 先运行 node scripts/make-fixture.mjs');
  } else {
    const [glbChooser] = await Promise.all([
      page.waitForFileChooser(),
      page.click('#btn-open'),
    ]);
    await glbChooser.accept([glbPath]);
    // 等待 GLB 真正加载完成(上一步的状态文本也含"已加载",必须按文件名等)
    await page.waitForFunction(
      () => document.querySelector('#status').textContent.includes('已加载 demo.glb'),
      { timeout: 8000 },
    );
    const glbInfo = await page.$eval('#info-panel', (el) => el.textContent);
    check('打开本地 GLB 模型', glbInfo.includes('demo'));
    // GLB 上做一次测量,验证 GLTF 往返后世界坐标与嵌套变换正确
    await page.click('#tool-measure');
    const clickWorld2 = async (x, y, z) => {
      const p = await page.evaluate(([a, b, c]) => window.__app.worldToClient(a, b, c), [x, y, z]);
      await page.mouse.click(p.x, p.y);
      await new Promise((r) => setTimeout(r, 200));
    };
    await clickWorld2(-50, 10, -30);
    await clickWorld2(50, 10, -30);
    await page.click('#btn-commit-measure'); // 两点测量需收尾入库
    await new Promise((r) => setTimeout(r, 300));
    const glbMeasure = await page.$eval('#measure-list', (el) => el.textContent);
    check('GLB 模型测距 100mm', glbMeasure.includes('100.00 mm'), glbMeasure.replace(/\s+/g, ' ').slice(0, 60));
    // 14. 损坏的 GLB:提示并保留当前模型
    wf(`${DL}/broken.glb`, Buffer.from('这不是glb文件'));
    const [brokenChooser] = await Promise.all([
      page.waitForFileChooser(),
      page.click('#btn-open'),
    ]);
    await brokenChooser.accept([`${DL}/broken.glb`]);
    await new Promise((r) => setTimeout(r, 800));
    const brokenStatus = await page.$eval('#status', (el) => el.textContent);
    const modelKept = await page.$eval('#info-panel', (el) => el.textContent.includes('demo'));
    check('损坏 GLB 提示并保留当前模型', brokenStatus.includes('加载失败') && modelKept, brokenStatus.slice(0, 30));
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  server.kill();
}
