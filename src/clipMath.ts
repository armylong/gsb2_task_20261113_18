import * as THREE from 'three';
import type { ClipPlaneState } from './types';

const AXIS_NORMALS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

/**
 * 由切面状态构造 THREE.Plane。
 * three.js 裁剪保留 distanceToPoint > 0 的一侧,丢弃负侧。
 * 约定:flipped = false 时裁掉轴正方向一侧(保留负侧),
 * 因此法线取轴的负方向,平面过点 axis*position。
 */
export function buildPlane(s: ClipPlaneState): THREE.Plane {
  const n = AXIS_NORMALS[s.axis].clone();
  if (!s.flipped) n.negate();
  // 平面过点 axis*position:constant = -dot(n, p0)
  const constant = s.flipped ? -s.position : s.position;
  return new THREE.Plane(n, constant);
}

/** 点是否被任一切面裁掉(被裁掉的点不可选中/不可作为测量点) */
export function isClipped(point: THREE.Vector3, planes: THREE.Plane[], epsilon = 1e-6): boolean {
  for (const p of planes) {
    if (p.distanceToPoint(point) < -epsilon) return true;
  }
  return false;
}

export interface HitLike {
  point: THREE.Vector3;
  object: { visible: boolean };
}

/**
 * 过滤射线命中:去掉被裁掉的点。
 * (可见性过滤在调用处结合祖先链完成)
 */
export function filterClippedHits<T extends HitLike>(hits: T[], planes: THREE.Plane[]): T[] {
  if (planes.length === 0) return hits;
  return hits.filter((h) => !isClipped(h.point, planes));
}
