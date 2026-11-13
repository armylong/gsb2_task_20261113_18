import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Viewer, isEffectivelyVisible, type ViewPreset } from './viewer';
import { ClippingManager } from './clipping';
import { MeasureManager } from './measure';
import { HierarchyPanel, nodePath, nodeByPath } from './hierarchy';
import { buildDemoModel, DEMO_SPECS } from './demoModel';
import { isClipped } from './clipMath';
import { measureResult, formatLength, formatAngle, toUnit } from './measureMath';
import { serializeProject, parseProject, arrayBufferToBase64, base64ToArrayBuffer } from './project';
import { buildReport } from './report';
import type { Axis, ProjectFile, ToolMode, Unit } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class App {
  private viewer: Viewer;
  private clipping: ClippingManager;
  private measure: MeasureManager;
  private hierarchy: HierarchyPanel;

  private modelRoot: THREE.Object3D | null = null;
  private modelName = '';
  private isDemo = false;
  private glbBuffer: ArrayBuffer | null = null;

  private tool: ToolMode = 'select';
  private unit: Unit = 'mm';
  private selected: THREE.Object3D | null = null;
  private highlighted = new Map<THREE.Mesh, THREE.Color>();

  private clipUi = new Map<Axis, { enable: HTMLInputElement; slider: HTMLInputElement; pos: HTMLElement }>();

  constructor() {
    const viewport = $('viewport');
    this.viewer = new Viewer(viewport);
    this.clipping = new ClippingManager(this.viewer.scene);
    this.measure = new MeasureManager(this.viewer.scene, $('labels'));
    this.hierarchy = new HierarchyPanel($('tree'), {
      onSelect: (n) => this.select(n),
      onToggleHide: (n) => {
        n.visible = !n.visible;
        this.hierarchy.refreshVisibility(this.modelRoot!);
        this.refreshInfo();
      },
      onIsolate: (n) => this.isolate(n),
      onShowAll: () => this.showAll(),
    });

    this.measure.onChange = () => this.refreshMeasureList();
    this.viewer.setPickHandler(
      (r) => this.onPick(r.mesh, r.point),
      (hit) => isEffectivelyVisible(hit.object) && !isClipped(hit.point, this.clipping.activePlanes()),
    );
    this.viewer.setFrameCallback(() => {
      this.clipping.updateTransforms();
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      this.measure.updateLabels(this.viewer.camera, w, h);
    });

    this.buildClipPanel();
    this.bindToolbar();
    this.setTool('select');
    this.setUnit('mm');
    this.hierarchy.build(null);
    this.refreshMeasureList();
    this.refreshInfo();
    this.setStatus('就绪,可打开 GLB 或加载演示模型');
    (window as unknown as { __app: App }).__app = this; // 测试/调试钩子
  }

  /** 世界坐标 → 页面坐标(供自动化测试精确定位点击) */
  worldToClient(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.viewer.camera);
    const rect = this.viewer.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((-v.y + 1) / 2) * rect.height,
    };
  }

  // ---------- 模型加载 ----------

  private disposeModel(root: THREE.Object3D): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat?.dispose();
    });
  }

  /** 切换模型:清理旧资源、测量、剖切与选中状态 */
  private setModel(root: THREE.Object3D, name: string, demo: boolean, glb: ArrayBuffer | null): void {
    if (this.modelRoot) {
      this.viewer.modelContainer.remove(this.modelRoot);
      this.disposeModel(this.modelRoot);
    }
    this.select(null);
    this.measure.clearAll();
    this.clipping.setStates([
      { axis: 'x', enabled: false, position: 0, flipped: false },
      { axis: 'y', enabled: false, position: 0, flipped: false },
      { axis: 'z', enabled: false, position: 0, flipped: false },
    ]);

    this.modelRoot = root;
    this.modelName = name;
    this.isDemo = demo;
    this.glbBuffer = glb;
    this.viewer.modelContainer.add(root);
    this.clipping.setModel(root);
    this.hierarchy.build(root);
    this.updateClipRanges();
    this.viewer.fitToVisible();
    this.refreshInfo();
  }

  private async loadGlb(buffer: ArrayBuffer): Promise<THREE.Object3D> {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.parse(buffer, '', (gltf) => resolve(gltf.scene), (e) => reject(e instanceof Error ? e : new Error(String(e))));
    });
  }

  private async openGlbFile(file: File): Promise<void> {
    this.setBusy(true, `正在加载 ${file.name}…`);
    try {
      const buf = await file.arrayBuffer();
      const scene = await this.loadGlb(buf);
      this.setModel(scene, file.name.replace(/\.glb$/i, ''), false, buf);
      this.setStatus(`已加载 ${file.name}`);
    } catch (e) {
      // 加载失败:保留当前模型
      this.setStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}(已保留当前模型)`, true);
    } finally {
      this.setBusy(false);
    }
  }

  private loadDemo(): void {
    this.setBusy(true, '正在生成演示模型…');
    try {
      this.setModel(buildDemoModel(), '演示模型', true, null);
      this.setStatus('已加载演示模型。已知尺寸: ' + DEMO_SPECS[0]);
    } finally {
      this.setBusy(false);
    }
  }

  // ---------- 选择与显隐 ----------

  private select(node: THREE.Object3D | null): void {
    // 还原旧高亮
    for (const [mesh, color] of this.highlighted) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.emissive) m.emissive.copy(color);
    }
    this.highlighted.clear();
    this.selected = node;
    if (node) {
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (mesh.isMesh && m?.emissive) {
          this.highlighted.set(mesh, m.emissive.clone());
          m.emissive.setHex(0x2a5a8a);
        }
      });
    }
    this.hierarchy.setSelected(node);
    this.refreshInfo();
  }

  private isolate(node: THREE.Object3D): void {
    if (!this.modelRoot) return;
    for (const c of this.modelRoot.children) {
      c.visible = c === node || isAncestor(c, node) || isAncestor(node, c);
    }
    node.visible = true;
    this.hierarchy.refreshVisibility(this.modelRoot);
    this.refreshInfo();
  }

  private showAll(): void {
    this.modelRoot?.traverse((n) => (n.visible = true));
    if (this.modelRoot) this.hierarchy.refreshVisibility(this.modelRoot);
    this.refreshInfo();
  }

  private onPick(mesh: THREE.Mesh, point: THREE.Vector3): void {
    if (this.tool === 'select') {
      this.select(mesh);
    } else {
      this.measure.addPoint(point);
      this.updateCommitButton();
      const n = this.measure.pendingCount;
      this.setStatus(
        n === 1 ? '已选第 1 点,再选 1 点测距离' : n === 2 ? '已得距离,可再选 1 点测角度,或点"完成当前测量"' : '测量完成',
      );
    }
  }

  // ---------- 工具 / 单位 ----------

  private setTool(t: ToolMode): void {
    if (this.tool === 'measure' && t !== 'measure') this.measure.commitPending();
    this.tool = t;
    $('tool-select').classList.toggle('active', t === 'select');
    $('tool-measure').classList.toggle('active', t === 'measure');
    this.updateCommitButton();
    this.refreshInfo();
  }

  private updateCommitButton(): void {
    $('btn-commit-measure').classList.toggle('hidden', this.tool !== 'measure');
  }

  private setUnit(u: Unit): void {
    this.unit = u;
    $('unit-mm').classList.toggle('active', u === 'mm');
    $('unit-cm').classList.toggle('active', u === 'cm');
    this.measure.setUnit(u);
    this.refreshMeasureList();
    this.updateClipLabels();
    this.refreshInfo();
  }

  // ---------- 剖切 UI ----------

  private buildClipPanel(): void {
    const panel = $('clip-panel');
    const names: Record<Axis, string> = { x: 'X 轴', y: 'Y 轴', z: 'Z 轴' };
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const row = document.createElement('div');
      row.className = 'clip-row';
      const label = document.createElement('label');
      const enable = document.createElement('input');
      enable.type = 'checkbox';
      label.appendChild(enable);
      label.append(` ${names[axis]}`);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-100';
      slider.max = '100';
      slider.step = '0.5';
      slider.value = '0';
      const pos = document.createElement('span');
      pos.className = 'pos';
      pos.textContent = '0';
      const flip = document.createElement('button');
      flip.className = 'mini';
      flip.textContent = '反向';
      row.append(label, slider, pos, flip);
      panel.appendChild(row);

      enable.onchange = () => {
        this.clipping.setState(axis, { enabled: enable.checked });
        this.refreshInfo();
      };
      slider.oninput = () => {
        this.clipping.setState(axis, { position: Number(slider.value) });
        this.updateClipLabels();
      };
      flip.onclick = () => {
        const cur = this.clipping.getStates().find((s) => s.axis === axis)!;
        this.clipping.setState(axis, { flipped: !cur.flipped });
        this.refreshInfo();
      };
      this.clipUi.set(axis, { enable, slider, pos });
    }
  }

  private updateClipRanges(): void {
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const ui = this.clipUi.get(axis)!;
      const { min, max } = this.clipping.axisRange(axis);
      ui.slider.min = String(Math.floor(min));
      ui.slider.max = String(Math.ceil(max));
      ui.slider.step = String(Math.max((max - min) / 200, 0.1));
      ui.slider.value = String((min + max) / 2);
      this.clipping.setState(axis, { position: (min + max) / 2 });
    }
    this.updateClipLabels();
  }

  private updateClipLabels(): void {
    for (const [axis, ui] of this.clipUi) {
      const st = this.clipping.getStates().find((s) => s.axis === axis)!;
      ui.pos.textContent = toUnit(st.position, this.unit).toFixed(1);
    }
  }

  private syncClipUi(): void {
    for (const [axis, ui] of this.clipUi) {
      const st = this.clipping.getStates().find((s) => s.axis === axis)!;
      ui.enable.checked = st.enabled;
      ui.slider.value = String(st.position);
    }
    this.updateClipLabels();
  }

  // ---------- 测量列表 ----------

  private refreshMeasureList(): void {
    const list = $('measure-list');
    list.innerHTML = '';
    const all = this.measure.getAll();
    if (!all.length) {
      list.innerHTML = '<div class="empty">暂无测量</div>';
      return;
    }
    for (const m of all) {
      const r = measureResult(m);
      const item = document.createElement('div');
      item.className = 'measure-item';
      const val = document.createElement('span');
      val.className = 'val';
      const parts = [`#${m.id} 距离 ${formatLength(r.distance ?? 0, this.unit)}`];
      if (r.angleDeg !== null) parts.push(`角度 ${formatAngle(r.angleDeg)}`);
      val.innerHTML = `${parts.join('<br>')}<br><span class="sub">${m.points.length} 个点</span>`;
      const del = document.createElement('button');
      del.className = 'mini';
      del.textContent = '删除';
      del.onclick = () => this.measure.remove(m.id);
      item.append(val, del);
      list.appendChild(item);
    }
  }

  // ---------- 信息面板 / 状态栏 ----------

  private refreshInfo(): void {
    const clip = this.clipping.getStates()
      .filter((s) => s.enabled)
      .map((s) => `${s.axis.toUpperCase()}=${toUnit(s.position, this.unit).toFixed(1)}${this.unit}${s.flipped ? '(反向)' : ''}`);
    $('info-panel').innerHTML = [
      `<div>模型: <b>${this.modelName || '—'}</b></div>`,
      `<div>工具: <b>${this.tool === 'select' ? '选择' : '测量'}</b></div>`,
      `<div>选中零件: <b>${this.selected?.name || '—'}</b></div>`,
      `<div>剖切: <b>${clip.length ? clip.join(', ') : '关闭'}</b></div>`,
      `<div>单位: <b>${this.unit}</b></div>`,
      `<div>测量数: <b>${this.measure.getAll().length}</b></div>`,
    ].join('');
    $('status-info').textContent = this.isDemo ? DEMO_SPECS.join(' | ') : '';
  }

  private setStatus(text: string, isError = false): void {
    const el = $('status');
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  private setBusy(busy: boolean, text = ''): void {
    $('busy').classList.toggle('hidden', !busy);
    if (text) $('busy-text').textContent = text;
  }

  // ---------- 工程保存 / 恢复 ----------

  private collectHidden(): Record<string, boolean> {
    const hidden: Record<string, boolean> = {};
    if (!this.modelRoot) return hidden;
    this.modelRoot.traverse((n) => {
      if (!n.visible && this.modelRoot) hidden[nodePath(this.modelRoot, n)] = true;
    });
    return hidden;
  }

  private saveProject(): void {
    if (!this.modelRoot) {
      this.setStatus('没有已加载的模型,无法保存工程', true);
      return;
    }
    if (!this.isDemo && !this.glbBuffer) {
      this.setStatus('缺少模型数据,无法保存工程', true);
      return;
    }
    this.measure.commitPending();
    const proj: ProjectFile = {
      app: 'model-inspector',
      version: 1,
      modelName: this.modelName,
      model: this.isDemo ? { kind: 'demo' } : { kind: 'glb', dataBase64: arrayBufferToBase64(this.glbBuffer!) },
      camera: this.viewer.getCameraState(),
      hidden: this.collectHidden(),
      clipping: this.clipping.getStates(),
      unit: this.unit,
      measurements: this.measure.getAll(),
    };
    download(`${this.modelName || 'inspection'}.miproj.json`, serializeProject(proj), 'application/json');
    this.setStatus('工程已保存(包含模型数据、相机、显隐、剖切、单位与测量)');
  }

  private async openProjectFile(file: File): Promise<void> {
    this.setBusy(true, '正在打开工程…');
    try {
      const text = await file.text();
      const proj = parseProject(text); // 校验失败会抛出中文原因,当前现场不受影响

      // 先成功加载模型,再替换现场
      let root: THREE.Object3D;
      let glb: ArrayBuffer | null = null;
      if (proj.model.kind === 'demo') {
        root = buildDemoModel();
      } else {
        glb = base64ToArrayBuffer(proj.model.dataBase64);
        root = await this.loadGlb(glb);
      }
      this.setModel(root, proj.modelName, proj.model.kind === 'demo', glb);

      // 恢复显隐
      this.modelRoot!.traverse((n) => (n.visible = true));
      for (const [path, isHidden] of Object.entries(proj.hidden)) {
        if (!isHidden) continue;
        const node = nodeByPath(this.modelRoot!, path);
        if (node) node.visible = false;
      }
      this.hierarchy.refreshVisibility(this.modelRoot!);

      // 恢复相机 / 剖切 / 单位 / 测量
      this.viewer.setCameraState(proj.camera);
      this.clipping.setStates(proj.clipping);
      this.updateClipRanges();
      this.clipping.setStates(proj.clipping); // updateClipRanges 会重置 position,再覆盖一次
      this.syncClipUi();
      this.setUnit(proj.unit);
      this.measure.restore(proj.measurements);
      this.refreshInfo();
      this.setStatus(`工程已恢复: ${proj.modelName}`);
    } catch (e) {
      this.setStatus(`打开工程失败: ${e instanceof Error ? e.message : String(e)}(当前现场未受影响)`, true);
    } finally {
      this.setBusy(false);
    }
  }

  // ---------- 导出 ----------

  private exportPng(): void {
    if (!this.modelRoot) {
      this.setStatus('没有已加载的模型,无法导出', true);
      return;
    }
    this.setBusy(true, '正在导出 PNG…');
    try {
      this.viewer.renderOnce(); // 保持当前视角与剖切、标记,直接取帧
      this.viewer.canvas.toBlob((blob) => {
        this.setBusy(false);
        if (!blob) {
          this.setStatus('导出 PNG 失败', true);
          return;
        }
        downloadBlob(`${this.modelName || 'inspection'}.png`, blob);
        this.setStatus('已导出 PNG(含当前剖切与测量标记)');
      }, 'image/png');
    } catch (e) {
      this.setBusy(false);
      this.setStatus(`导出 PNG 失败: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  private exportReport(): void {
    if (!this.modelRoot) {
      this.setStatus('没有已加载的模型,无法导出', true);
      return;
    }
    this.measure.commitPending();
    const report = buildReport(this.modelName, this.unit, this.clipping.getStates(), this.measure.getAll());
    download(`${this.modelName || 'inspection'}-report.json`, JSON.stringify(report, null, 2), 'application/json');
    this.setStatus(`已导出测量报告(${report.measurements.length} 条测量)`);
  }

  // ---------- 工具栏 ----------

  private bindToolbar(): void {
    $('btn-open').onclick = () => $('file-glb').click();
    $('btn-demo').onclick = () => this.loadDemo();
    $('file-glb').onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void this.openGlbFile(f);
      (e.target as HTMLInputElement).value = '';
    };
    $('file-project').onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void this.openProjectFile(f);
      (e.target as HTMLInputElement).value = '';
    };
    document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((b) => {
      b.onclick = () => this.viewer.setView(b.dataset.view as ViewPreset);
    });
    $('btn-fit').onclick = () => this.viewer.fitToVisible();
    $('tool-select').onclick = () => this.setTool('select');
    $('tool-measure').onclick = () => this.setTool('measure');
    $('btn-commit-measure').onclick = () => {
      this.measure.commitPending();
      this.setStatus('当前测量已完成');
    };
    $('btn-clear-measure').onclick = () => {
      this.measure.clearAll();
      this.setStatus('已清空全部测量');
    };
    $('unit-mm').onclick = () => this.setUnit('mm');
    $('unit-cm').onclick = () => this.setUnit('cm');
    $('btn-save-project').onclick = () => this.saveProject();
    $('btn-open-project').onclick = () => $('file-project').click();
    $('btn-export-png').onclick = () => this.exportPng();
    $('btn-export-report').onclick = () => this.exportReport();
  }
}

function isAncestor(a: THREE.Object3D, b: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = b.parent;
  while (cur) {
    if (cur === a) return true;
    cur = cur.parent;
  }
  return false;
}

function download(filename: string, content: string, mime: string): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
