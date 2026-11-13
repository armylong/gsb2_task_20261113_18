import type { ClipPlaneState, Measurement, Unit } from './types';
import { measureResult, toUnit } from './measureMath';

export interface MeasureReportItem {
  id: number;
  type: 'distance' | 'distance+angle';
  points: { x: number; y: number; z: number }[];
  distance: number | null;
  angleDeg: number | null;
}

export interface InspectionReport {
  model: string;
  unit: Unit;
  exportedAt: string;
  clipping: ClipPlaneState[];
  measurements: MeasureReportItem[];
}

/** 生成测量报告对象(数值已换算为当前单位) */
export function buildReport(
  modelName: string,
  unit: Unit,
  clipping: ClipPlaneState[],
  measurements: Measurement[],
  now: Date = new Date(),
): InspectionReport {
  return {
    model: modelName,
    unit,
    exportedAt: now.toISOString(),
    clipping: clipping.map((c) => ({ ...c })),
    measurements: measurements.map((m) => {
      const r = measureResult(m);
      return {
        id: m.id,
        type: m.points.length >= 3 ? 'distance+angle' : 'distance',
        points: m.points.map((p) => ({ x: p[0], y: p[1], z: p[2] })),
        distance: r.distance === null ? null : round3(toUnit(r.distance, unit)),
        angleDeg: r.angleDeg === null ? null : round3(r.angleDeg),
      };
    }),
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
