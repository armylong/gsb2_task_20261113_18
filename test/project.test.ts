import { describe, it, expect } from 'vitest';
import { serializeProject, parseProject, arrayBufferToBase64, base64ToArrayBuffer } from '../src/project';
import type { ProjectFile } from '../src/types';

function sampleProject(): ProjectFile {
  return {
    app: 'model-inspector',
    version: 1,
    modelName: '测试模型',
    model: { kind: 'glb', dataBase64: arrayBufferToBase64(new Uint8Array([1, 2, 3, 250]).buffer) },
    camera: { position: [1, 2, 3], target: [0, 0, 0] },
    hidden: { '0/2': true, '1': true },
    clipping: [
      { axis: 'x', enabled: true, position: 12.5, flipped: true },
      { axis: 'y', enabled: false, position: 0, flipped: false },
      { axis: 'z', enabled: true, position: -3, flipped: false },
    ],
    unit: 'cm',
    measurements: [
      { id: 1, points: [[0, 0, 0], [10, 0, 0]] },
      { id: 2, points: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] },
    ],
  };
}

describe('工程保存与恢复', () => {
  it('序列化 → 解析后完整还原所有字段', () => {
    const p = sampleProject();
    const restored = parseProject(serializeProject(p));
    expect(restored).toEqual(p);
  });

  it('模型数据 base64 往返无损', () => {
    const src = new Uint8Array([0, 1, 127, 128, 255, 66]);
    const buf = base64ToArrayBuffer(arrayBufferToBase64(src.buffer));
    expect([...new Uint8Array(buf)]).toEqual([...src]);
  });

  it('非 JSON 文件:报损坏原因', () => {
    expect(() => parseProject('这不是json{')).toThrow(/JSON/);
  });

  it('缺少应用标识:提示不是本应用工程', () => {
    expect(() => parseProject(JSON.stringify({ hello: 1 }))).toThrow(/不是本应用/);
  });

  it('不支持的版本', () => {
    const p = sampleProject() as unknown as Record<string, unknown>;
    p.version = 99;
    expect(() => parseProject(JSON.stringify(p))).toThrow(/版本/);
  });

  it('glb 工程缺少模型数据', () => {
    const p = sampleProject();
    (p.model as { dataBase64: string }).dataBase64 = '';
    expect(() => parseProject(JSON.stringify(p))).toThrow(/模型数据/);
  });

  it('测量记录损坏(点数非法)', () => {
    const p = sampleProject();
    p.measurements.push({ id: 3, points: [[0, 0, 0]] });
    expect(() => parseProject(JSON.stringify(p))).toThrow(/测量记录/);
  });

  it('测量坐标含非法值', () => {
    const p = sampleProject();
    p.measurements[0].points[0] = [0, Number.NaN, 0];
    expect(() => parseProject(JSON.stringify(p))).toThrow(/测量记录/);
  });

  it('demo 工程不需要模型数据', () => {
    const p = sampleProject();
    p.model = { kind: 'demo' };
    expect(parseProject(serializeProject(p)).model.kind).toBe('demo');
  });
});
