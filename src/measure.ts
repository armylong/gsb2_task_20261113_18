import * as THREE from 'three';
import type { Measurement, Unit } from './types';
import { measureResult, formatLength, formatAngle } from './measureMath';

const MAX_POINTS = 3;

/**
 * 测量管理:点标记、连线、HTML 标签。
 * 流程:第 1、2 个点 → 距离;第 3 个点 → 角度(顶点在第 2 点)并自动完成。
 * 2 个点的测量处于"待定"状态,可点"完成当前测量"收尾,否则第 3 点会补角度。
 */
export class MeasureManager {
  private measurements: Measurement[] = [];
  private pending: [number, number, number][] = [];
  private nextId = 1;

  private group = new THREE.Group();
  private labels = new Map<string, HTMLElement>();
  private pointGeo = new THREE.SphereGeometry(1.2, 16, 12);
  private pointMat = new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false });
  private pendingMat = new THREE.MeshBasicMaterial({ color: 0xef476f, depthTest: false });
  private lineMat = new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false });

  onChange: (() => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private labelContainer: HTMLElement,
  ) {
    this.group.name = '__measurements__';
    this.group.renderOrder = 20;
    scene.add(this.group);
  }

  /** 添加一个测量点(世界坐标)。返回是否已构成完整测量 */
  addPoint(p: THREE.Vector3): void {
    this.pending.push([p.x, p.y, p.z]);
    if (this.pending.length === MAX_POINTS) {
      this.commit();
    } else {
      this.rebuild();
      this.emit();
    }
  }

  /** 待定中的点数 */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** 把待定测量(≥2 点)收尾入库 */
  commitPending(): void {
    if (this.pending.length >= 2) this.commit();
    else this.discardPending();
  }

  discardPending(): void {
    this.pending = [];
    this.rebuild();
    this.emit();
  }

  private commit(): void {
    this.measurements.push({ id: this.nextId++, points: this.pending });
    this.pending = [];
    this.rebuild();
    this.emit();
  }

  getAll(): Measurement[] {
    return this.measurements.map((m) => ({ id: m.id, points: m.points.map((p) => [...p] as [number, number, number]) }));
  }

  remove(id: number): void {
    this.measurements = this.measurements.filter((m) => m.id !== id);
    this.rebuild();
    this.emit();
  }

  clearAll(): void {
    this.measurements = [];
    this.pending = [];
    this.rebuild();
    this.emit();
  }

  /** 恢复工程时整体替换 */
  restore(list: Measurement[]): void {
    this.measurements = list.map((m) => ({ id: m.id, points: m.points.map((p) => [...p] as [number, number, number]) }));
    this.nextId = this.measurements.reduce((a, m) => Math.max(a, m.id), 0) + 1;
    this.pending = [];
    this.rebuild();
    this.emit();
  }

  private rebuild(): void {
    // 清理旧图形
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry !== this.pointGeo) mesh.geometry.dispose();
      const line = c as THREE.Line;
      if (line.isLine) line.geometry.dispose();
    }
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();

    const drawPoints = (pts: [number, number, number][], pending: boolean, keyPrefix: string) => {
      const vecs = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      vecs.forEach((v, i) => {
        const m = new THREE.Mesh(this.pointGeo, pending ? this.pendingMat : this.pointMat);
        m.position.copy(v);
        m.renderOrder = 21;
        this.group.add(m);
        this.addLabel(`${keyPrefix}-p${i}`, v, `P${i + 1}`, 'measure-label point-label');
      });
      if (vecs.length >= 2) {
        const geo = new THREE.BufferGeometry().setFromPoints(vecs);
        const line = new THREE.Line(geo, this.lineMat);
        line.renderOrder = 20;
        this.group.add(line);
      }
    };

    for (const m of this.measurements) {
      drawPoints(m.points, false, `m${m.id}`);
      const r = measureResult(m);
      const pts = m.points;
      const mid = new THREE.Vector3(
        (pts[0][0] + pts[1][0]) / 2,
        (pts[0][1] + pts[1][1]) / 2,
        (pts[0][2] + pts[1][2]) / 2,
      );
      this.addLabel(`m${m.id}-dist`, mid, `#${m.id} ${formatLength(r.distance ?? 0, this.unit)}`, 'measure-label');
      if (r.angleDeg !== null) {
        const v = new THREE.Vector3(pts[1][0], pts[1][1], pts[1][2]);
        this.addLabel(`m${m.id}-ang`, v, `∠ ${formatAngle(r.angleDeg)}`, 'measure-label angle-label');
      }
    }
    if (this.pending.length) drawPoints(this.pending, true, 'pending');
  }

  private unit: Unit = 'mm';
  setUnit(u: Unit): void {
    this.unit = u;
    this.rebuild();
  }

  private addLabel(key: string, worldPos: THREE.Vector3, text: string, cls: string): void {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    this.labelContainer.appendChild(el);
    this.labels.set(key, el);
    (el as unknown as { __pos: THREE.Vector3 }).__pos = worldPos.clone();
  }

  /** 每帧调用:把标签投影到屏幕 */
  updateLabels(camera: THREE.Camera, width: number, height: number): void {
    const v = new THREE.Vector3();
    for (const el of this.labels.values()) {
      const pos = (el as unknown as { __pos: THREE.Vector3 }).__pos;
      v.copy(pos).project(camera);
      const behind = v.z > 1;
      el.style.display = behind ? 'none' : 'block';
      if (!behind) {
        el.style.left = `${((v.x + 1) / 2) * width}px`;
        el.style.top = `${((-v.y + 1) / 2) * height}px`;
      }
    }
  }

  private emit(): void {
    this.onChange?.();
  }

  dispose(): void {
    this.clearAll();
    this.scene.remove(this.group);
    this.pointGeo.dispose();
    this.pointMat.dispose();
    this.pendingMat.dispose();
    this.lineMat.dispose();
  }
}
