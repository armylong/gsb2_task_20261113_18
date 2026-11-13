import * as THREE from 'three';
import type { Measurement, Unit } from './types';

/** 两点距离(模型单位) */
export function distance(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.distanceTo(b);
}

/**
 * 三点角度,顶点在第二个点 b。
 * 返回角度(度),范围 [0, 180]。
 */
export function angleDeg(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const v1 = new THREE.Vector3().subVectors(a, b);
  const v2 = new THREE.Vector3().subVectors(c, b);
  if (v1.lengthSq() < 1e-12 || v2.lengthSq() < 1e-12) return 0;
  return THREE.MathUtils.radToDeg(v1.angleTo(v2));
}

/** 计算一条测量记录的结果 */
export function measureResult(m: Measurement): { distance: number | null; angleDeg: number | null } {
  const pts = m.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (pts.length < 2) return { distance: null, angleDeg: null };
  const d = distance(pts[0], pts[1]);
  const ang = pts.length >= 3 ? angleDeg(pts[0], pts[1], pts[2]) : null;
  return { distance: d, angleDeg: ang };
}

/** 模型单位固定为 mm;cm 时除以 10 */
export function toUnit(valueMm: number, unit: Unit): number {
  return unit === 'cm' ? valueMm / 10 : valueMm;
}

export function formatLength(valueMm: number, unit: Unit): string {
  return `${toUnit(valueMm, unit).toFixed(2)} ${unit}`;
}

export function formatAngle(deg: number): string {
  return `${deg.toFixed(2)}°`;
}
