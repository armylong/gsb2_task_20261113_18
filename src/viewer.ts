import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraState } from './types';

export type ViewPreset = 'front' | 'side' | 'top' | 'persp';

export interface PickResult {
  mesh: THREE.Mesh;
  point: THREE.Vector3;
}

/**
 * 渲染器 / 相机 / 控制器封装。
 * 拾取过滤(可见性、剖切)由调用方传入的 filter 完成。
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;

  /** 模型挂载点(测量标记等放在 scene 下,模型放这里) */
  readonly modelContainer = new THREE.Group();

  private raycaster = new THREE.Raycaster();
  private pickFilter: ((hit: THREE.Intersection) => boolean) | null = null;
  private onPick: ((r: PickResult, ev: PointerEvent) => void) | null = null;
  private onFrame: (() => void) | null = null;
  private downPos: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true, // 导出 PNG 需要
      stencil: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1c2128);
    this.scene.add(this.modelContainer);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20000);
    this.camera.position.set(180, 140, 220);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x33404f, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(120, 200, 160);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dir2.position.set(-150, 80, -120);
    this.scene.add(hemi, dir, dir2);

    const grid = new THREE.GridHelper(400, 40, 0x3a4552, 0x2a323d);
    grid.position.y = -0.01;
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(30));

    // 区分点击与拖拽
    this.canvas.addEventListener('pointerdown', (e) => {
      this.downPos = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.downPos) return;
      const dx = e.clientX - this.downPos.x;
      const dy = e.clientY - this.downPos.y;
      this.downPos = null;
      if (dx * dx + dy * dy > 25 || e.button !== 0) return;
      this.handlePick(e);
    });

    // 容器尺寸变化:更新渲染尺寸与相机比例(NDC 由 getBoundingClientRect 计算,天然正确)
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  setPickHandler(
    onPick: ((r: PickResult, ev: PointerEvent) => void) | null,
    filter: ((hit: THREE.Intersection) => boolean) | null,
  ): void {
    this.onPick = onPick;
    this.pickFilter = filter;
  }

  setFrameCallback(cb: (() => void) | null): void {
    this.onFrame = cb;
  }

  private handlePick(e: PointerEvent): void {
    if (!this.onPick) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.modelContainer.children, true);
    for (const hit of hits) {
      if (!(hit.object as THREE.Mesh).isMesh) continue;
      if (this.pickFilter && !this.pickFilter(hit)) continue;
      this.onPick({ mesh: hit.object as THREE.Mesh, point: hit.point.clone() }, e);
      return;
    }
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.controls.update();
    this.onFrame?.();
    this.renderer.render(this.scene, this.camera);
  };

  renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 可见网格的包围盒 */
  visibleBounds(): THREE.Box3 | null {
    const box = new THREE.Box3();
    let any = false;
    this.modelContainer.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !isEffectivelyVisible(m)) return;
      m.updateWorldMatrix(true, false);
      box.expandByObject(m);
      any = true;
    });
    return any ? box : null;
  }

  /** 一键适配可见模型(保持当前视线方向) */
  fitToVisible(): void {
    const box = this.visibleBounds();
    if (!box || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(1, 1, 1);
    dir.normalize();
    const dist = (radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.25;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 1000, 0.01);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
  }

  /** 视角预设:只动相机,不清剖切/测量状态 */
  setView(preset: ViewPreset): void {
    const box = this.visibleBounds();
    const center = box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const radius =
      box && !box.isEmpty() ? Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1) : 100;
    const dist = (radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.25;
    const dirs: Record<ViewPreset, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0, 1),
      side: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0.0001), // 避免万向锁
      persp: new THREE.Vector3(1, 0.8, 1).normalize(),
    };
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dirs[preset], dist);
    this.camera.lookAt(center);
  }

  getCameraState(): CameraState {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
    };
  }

  setCameraState(s: CameraState): void {
    this.camera.position.fromArray(s.position);
    this.controls.target.fromArray(s.target);
    this.controls.update();
  }
}

/** 自身及所有祖先均可见 */
export function isEffectivelyVisible(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}
