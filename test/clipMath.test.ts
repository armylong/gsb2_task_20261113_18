import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPlane, isClipped, filterClippedHits } from '../src/clipMath';
import type { ClipPlaneState } from '../src/types';

const st = (patch: Partial<ClipPlaneState>): ClipPlaneState => ({
  axis: 'x',
  enabled: true,
  position: 0,
  flipped: false,
  ...patch,
});

describe('剖切平面与选点限制', () => {
  it('默认裁掉轴正方向一侧', () => {
    const p = buildPlane(st({ axis: 'x', position: 10 }));
    expect(isClipped(new THREE.Vector3(20, 0, 0), [p])).toBe(true); // 外侧被裁
    expect(isClipped(new THREE.Vector3(5, 0, 0), [p])).toBe(false); // 内侧保留
    expect(isClipped(new THREE.Vector3(10, 0, 0), [p])).toBe(false); // 切面上保留
  });

  it('翻转后裁掉轴负方向一侧', () => {
    const p = buildPlane(st({ axis: 'y', position: 10, flipped: true }));
    expect(isClipped(new THREE.Vector3(0, -20, 0), [p])).toBe(true);
    expect(isClipped(new THREE.Vector3(0, 50, 0), [p])).toBe(false);
  });

  it('平面过点 position(任意轴向)', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const p = buildPlane(st({ axis, position: 33 }));
      const onPlane = new THREE.Vector3(0, 0, 0).setComponent(axis === 'x' ? 0 : axis === 'y' ? 1 : 2, 33);
      expect(p.distanceToPoint(onPlane)).toBeCloseTo(0, 6);
    }
  });

  it('多个切面同时生效:任一面裁掉即不可选', () => {
    const planes = [buildPlane(st({ axis: 'x', position: 0 })), buildPlane(st({ axis: 'z', position: 5 }))];
    expect(isClipped(new THREE.Vector3(10, 0, -10), planes)).toBe(true); // 被 x 裁
    expect(isClipped(new THREE.Vector3(-10, 0, 10), planes)).toBe(true); // 被 z 裁
    expect(isClipped(new THREE.Vector3(-10, 0, -10), planes)).toBe(false);
  });

  it('filterClippedHits: 被裁命中被剔除,保留命中顺序', () => {
    const planes = [buildPlane(st({ axis: 'x', position: 0 }))];
    const hits = [
      { point: new THREE.Vector3(5, 0, 0), object: { visible: true } }, // 被裁
      { point: new THREE.Vector3(-5, 0, 0), object: { visible: true } }, // 保留
      { point: new THREE.Vector3(-15, 0, 0), object: { visible: true } }, // 保留
    ];
    const kept = filterClippedHits(hits, planes);
    expect(kept).toHaveLength(2);
    expect(kept[0].point.x).toBe(-5);
    expect(filterClippedHits(hits, [])).toHaveLength(3); // 无切面不过滤
  });
});
