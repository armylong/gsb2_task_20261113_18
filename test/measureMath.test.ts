import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { distance, angleDeg, measureResult, toUnit, formatLength } from '../src/measureMath';

/**
 * 构造与演示模型一致的嵌套变换:
 * A(平移 40,10,20;绕Y 30°) → B(绕Z 15°;缩放 1,2,1) → M(平移 0,25,0)
 */
function makeNested() {
  const a = new THREE.Group();
  a.position.set(40, 10, 20);
  a.rotation.y = THREE.MathUtils.degToRad(30);
  const b = new THREE.Group();
  b.rotation.z = THREE.MathUtils.degToRad(15);
  b.scale.set(1, 2, 1);
  const m = new THREE.Object3D();
  m.position.set(0, 25, 0);
  a.add(b);
  b.add(m);
  a.updateWorldMatrix(true, true);
  return { a, b, m };
}

function toWorld(node: THREE.Object3D, x: number, y: number, z: number): THREE.Vector3 {
  return node.localToWorld(new THREE.Vector3(x, y, z));
}

describe('嵌套变换下的测量计算', () => {
  it('非等比缩放后轴的长度为 100mm(局部 50 × 缩放 2)', () => {
    const { m } = makeNested();
    const p1 = toWorld(m, 0, -25, 0); // 轴底
    const p2 = toWorld(m, 0, 25, 0); // 轴顶
    expect(distance(p1, p2)).toBeCloseTo(100, 6);
  });

  it('轴底世界坐标等于父组原点 (40,10,20)', () => {
    const { m } = makeNested();
    const p = toWorld(m, 0, -25, 0);
    expect(p.x).toBeCloseTo(40, 6);
    expect(p.y).toBeCloseTo(10, 6);
    expect(p.z).toBeCloseTo(20, 6);
  });

  it('XZ 平面内的直角经旋转/非等比缩放后仍为 90°', () => {
    const { m } = makeNested();
    const a = toWorld(m, 10, -25, 0);
    const b = toWorld(m, 0, -25, 0);
    const c = toWorld(m, 0, -25, 10);
    expect(angleDeg(a, b, c)).toBeCloseTo(90, 6);
  });

  it('45° 角经嵌套变换后仍正确', () => {
    const { m } = makeNested();
    const a = toWorld(m, 10, -25, 0);
    const b = toWorld(m, 0, -25, 0);
    const c = toWorld(m, 10, -25, 10);
    expect(angleDeg(a, b, c)).toBeCloseTo(45, 6);
  });

  it('measureResult:2 点只有距离,3 点带角度(顶点在第 2 点)', () => {
    const two = measureResult({ id: 1, points: [[0, 0, 0], [3, 4, 0]] });
    expect(two.distance).toBeCloseTo(5, 6);
    expect(two.angleDeg).toBeNull();
    const three = measureResult({ id: 2, points: [[10, 0, 0], [0, 0, 0], [0, 10, 0]] });
    expect(three.distance).toBeCloseTo(10, 6);
    expect(three.angleDeg).toBeCloseTo(90, 6);
  });

  it('单位换算:mm → cm', () => {
    expect(toUnit(100, 'mm')).toBe(100);
    expect(toUnit(100, 'cm')).toBe(10);
    expect(formatLength(25, 'cm')).toBe('2.50 cm');
  });
});
