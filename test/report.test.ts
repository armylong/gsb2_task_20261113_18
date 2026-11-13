import { describe, it, expect } from 'vitest';
import { buildReport } from '../src/report';
import type { ClipPlaneState, Measurement } from '../src/types';

const clipping: ClipPlaneState[] = [
  { axis: 'x', enabled: true, position: 25, flipped: false },
  { axis: 'y', enabled: false, position: 0, flipped: false },
  { axis: 'z', enabled: true, position: -10, flipped: true },
];

const measurements: Measurement[] = [
  { id: 1, points: [[0, 0, 0], [30, 40, 0]] }, // 距离 50
  { id: 2, points: [[10, 0, 0], [0, 0, 0], [0, 10, 0]] }, // 距离 10,角度 90
];

describe('测量报告导出', () => {
  it('包含模型名、单位、时间、剖切设置与测量明细', () => {
    const r = buildReport('演示模型', 'mm', clipping, measurements, new Date('2026-11-13T08:00:00Z'));
    expect(r.model).toBe('演示模型');
    expect(r.unit).toBe('mm');
    expect(r.exportedAt).toBe('2026-11-13T08:00:00.000Z');
    expect(r.clipping).toHaveLength(3);
    expect(r.clipping[0]).toEqual({ axis: 'x', enabled: true, position: 25, flipped: false });
    expect(r.measurements).toHaveLength(2);
  });

  it('测量点坐标、距离与角度数值正确', () => {
    const r = buildReport('m', 'mm', clipping, measurements);
    const m1 = r.measurements[0];
    expect(m1.type).toBe('distance');
    expect(m1.points[1]).toEqual({ x: 30, y: 40, z: 0 });
    expect(m1.distance).toBeCloseTo(50, 3);
    expect(m1.angleDeg).toBeNull();
    const m2 = r.measurements[1];
    expect(m2.type).toBe('distance+angle');
    expect(m2.distance).toBeCloseTo(10, 3);
    expect(m2.angleDeg).toBeCloseTo(90, 3);
  });

  it('cm 单位下距离换算为厘米,角度不变', () => {
    const r = buildReport('m', 'cm', clipping, measurements);
    expect(r.measurements[0].distance).toBeCloseTo(5, 3);
    expect(r.measurements[1].angleDeg).toBeCloseTo(90, 3);
  });

  it('空测量列表也可导出', () => {
    const r = buildReport('m', 'mm', clipping, []);
    expect(r.measurements).toEqual([]);
  });
});
