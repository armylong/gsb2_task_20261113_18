import * as THREE from 'three';
import type { Axis, ClipPlaneState } from './types';
import { buildPlane } from './clipMath';
import { isEffectivelyVisible } from './viewer';

const CAP_COLORS: Record<Axis, number> = { x: 0xd98a8a, y: 0x8fbf7f, z: 0x7fa3d9 };

interface PlaneEntry {
  state: ClipPlaneState;
  plane: THREE.Plane;
  cap: THREE.Mesh;
  capMat: THREE.MeshStandardMaterial;
}

/**
 * 剖切管理:最多 3 个轴向切面,模板缓冲封口。
 * 原理(参考 three.js webgl_clipping_stencil):
 * 每个切面对每个网格渲染背/正面写模板,再在切面位置画一个只显示在
 * 模板非零区域的封口面。封口颜色按轴区分,且被其余切面裁剪,
 * 多零件、多切面互不串色、不露被裁内容。
 */
export class ClippingManager {
  private entries: PlaneEntry[] = [];
  private stencilGroup = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  /** mesh -> 每个切面的背/正面模板网格 */
  private stencilMeshes = new Map<THREE.Mesh, THREE.Mesh[]>();
  private capSize = 300;

  constructor(private scene: THREE.Scene) {
    this.stencilGroup.name = '__clipping_stencil__';
    scene.add(this.stencilGroup);
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const state: ClipPlaneState = { axis, enabled: false, position: 0, flipped: false };
      const capMat = new THREE.MeshStandardMaterial({
        color: CAP_COLORS[axis],
        roughness: 0.4,
        metalness: 0.1,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp,
        stencilZFail: THREE.ReplaceStencilOp,
        stencilZPass: THREE.ReplaceStencilOp,
      });
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMat);
      cap.visible = false;
      // 封口渲染后清空模板缓冲,避免多个切面共用模板互相污染(官方示例做法)
      cap.onAfterRender = (renderer) => renderer.clearStencil();
      this.stencilGroup.add(cap);
      this.entries.push({ state, plane: buildPlane(state), cap, capMat });
    }
  }

  /** 换模型时调用:登记网格并重建模板网格 */
  setModel(root: THREE.Object3D | null): void {
    this.clearStencilMeshes();
    this.meshes = [];
    if (!root) return;
    const box = new THREE.Box3().setFromObject(root);
    const diag = box.isEmpty() ? 300 : box.getSize(new THREE.Vector3()).length();
    this.capSize = Math.max(diag * 1.5, 50);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      this.meshes.push(m);
      this.createStencilMeshesFor(m);
    });
    this.apply();
  }

  private clearStencilMeshes(): void {
    for (const arr of this.stencilMeshes.values()) {
      for (const sm of arr) {
        this.stencilGroup.remove(sm);
        (sm.material as THREE.Material).dispose();
      }
    }
    this.stencilMeshes.clear();
  }

  private createStencilMeshesFor(mesh: THREE.Mesh): void {
    const arr: THREE.Mesh[] = [];
    this.entries.forEach((entry, i) => {
      for (const side of [THREE.BackSide, THREE.FrontSide]) {
        const m = new THREE.MeshStandardMaterial({
          depthWrite: false,
          depthTest: false,
          colorWrite: false,
          stencilWrite: true,
          stencilFunc: THREE.AlwaysStencilFunc,
          side,
        });
        if (side === THREE.BackSide) {
          m.stencilFail = THREE.IncrementWrapStencilOp;
          m.stencilZFail = THREE.IncrementWrapStencilOp;
          m.stencilZPass = THREE.IncrementWrapStencilOp;
        } else {
          m.stencilFail = THREE.DecrementWrapStencilOp;
          m.stencilZFail = THREE.DecrementWrapStencilOp;
          m.stencilZPass = THREE.DecrementWrapStencilOp;
        }
        const sm = new THREE.Mesh(mesh.geometry, m);
        sm.matrixAutoUpdate = false;
        // 模板写入与封口按切面交替:(i+1)*2 与 (i+1)*2+1,
        // 封口绘制时用 Replace 将模板复位,避免多个切面共用模板缓冲互相污染
        sm.renderOrder = (i + 1) * 2;
        sm.visible = false;
        this.stencilGroup.add(sm);
        arr.push(sm);
      }
    });
    this.stencilMeshes.set(mesh, arr);
  }

  getStates(): ClipPlaneState[] {
    return this.entries.map((e) => ({ ...e.state }));
  }

  setState(axis: Axis, patch: Partial<Omit<ClipPlaneState, 'axis'>>): void {
    const entry = this.entries.find((e) => e.state.axis === axis);
    if (!entry) return;
    Object.assign(entry.state, patch);
    this.apply();
  }

  setStates(states: ClipPlaneState[]): void {
    for (const s of states) {
      const entry = this.entries.find((e) => e.state.axis === s.axis);
      if (entry) entry.state = { ...s };
    }
    this.apply();
  }

  /** 当前生效的 THREE.Plane 列表(用于拾取过滤) */
  activePlanes(): THREE.Plane[] {
    return this.entries.filter((e) => e.state.enabled).map((e) => e.plane);
  }

  /** 状态变化后重算平面、材质裁剪与封口 */
  apply(): void {
    // 先重建平面,再收集生效平面 —— 顺序反了会导致模型用到旧平面,
    // 且封口的 otherPlanes 过滤失效(把自己也算进去,造成自我裁剪噪点)
    for (const entry of this.entries) {
      entry.plane = buildPlane(entry.state);
    }
    const active = this.entries.filter((e) => e.state.enabled);
    const activePlanes = active.map((e) => e.plane);

    // 模型材质挂裁剪面
    for (const mesh of this.meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as THREE.Material).clippingPlanes = activePlanes.length ? activePlanes : null;
      }
    }

    // 封口与模板网格
    this.entries.forEach((entry, i) => {
      const on = entry.state.enabled;
      const otherPlanes = activePlanes.filter((p) => p !== entry.plane);
      entry.cap.visible = on;
      entry.cap.scale.set(this.capSize, this.capSize, 1);
      // 封口只显示在其他切面保留的区域内
      entry.capMat.clippingPlanes = otherPlanes.length ? otherPlanes : null;
      if (on) {
        const n = entry.plane.normal;
        entry.cap.position.copy(n).multiplyScalar(-entry.plane.constant);
        entry.cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        entry.cap.renderOrder = (i + 1) * 2 + 1;
      }
    });

    // 模板网格的可见性与裁剪在 updateTransforms 中按帧维护
    this.updateTransforms();
  }

  /** 每帧调用:模板网格跟随模型矩阵与可见性 */
  updateTransforms(): void {
    for (const mesh of this.meshes) {
      const arr = this.stencilMeshes.get(mesh);
      if (!arr) continue;
      mesh.updateWorldMatrix(true, false);
      const vis = isEffectivelyVisible(mesh);
      arr.forEach((sm, idx) => {
        const entry = this.entries[Math.floor(idx / 2)];
        sm.visible = vis && entry.state.enabled;
        if (sm.visible) {
          sm.matrix.copy(mesh.matrixWorld);
          // 模板写入只受自身切面限制
          (sm.material as THREE.Material).clippingPlanes = [entry.plane];
        }
      });
    }
  }

  /** 模型包围盒沿轴的范围,用于滑条 */
  axisRange(axis: Axis): { min: number; max: number } {
    const box = new THREE.Box3();
    let any = false;
    for (const m of this.meshes) {
      if (!isEffectivelyVisible(m)) continue;
      box.expandByObject(m);
      any = true;
    }
    if (!any) return { min: -100, max: 100 };
    return { min: box.min[axis], max: box.max[axis] };
  }

  dispose(): void {
    this.clearStencilMeshes();
    for (const e of this.entries) {
      e.cap.geometry.dispose();
      e.capMat.dispose();
    }
    this.scene.remove(this.stencilGroup);
  }
}
