import type { ProjectFile } from './types';

export const PROJECT_APP = 'model-inspector';
export const PROJECT_VERSION = 1;

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 2);
}

/** 解析并校验工程文件;不合法时抛出带中文原因的 Error */
export function parseProject(text: string): ProjectFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON,可能已损坏');
  }
  const p = obj as Partial<ProjectFile>;
  if (p == null || typeof p !== 'object') throw new Error('文件内容不是工程数据');
  if (p.app !== PROJECT_APP) throw new Error('不是本应用保存的检查工程(缺少应用标识)');
  if (p.version !== PROJECT_VERSION) throw new Error(`不支持的工程版本: ${String(p.version)}`);
  if (!p.model || (p.model.kind !== 'demo' && p.model.kind !== 'glb'))
    throw new Error('工程缺少模型数据');
  if (p.model.kind === 'glb') {
    const d = (p.model as { dataBase64?: unknown }).dataBase64;
    if (typeof d !== 'string' || d.length === 0) throw new Error('工程中的模型数据为空或损坏');
  }
  if (typeof p.modelName !== 'string') throw new Error('工程缺少模型名称');
  if (!p.camera || !Array.isArray(p.camera.position) || !Array.isArray(p.camera.target))
    throw new Error('工程缺少相机数据');
  if (!Array.isArray(p.clipping)) throw new Error('工程缺少剖切设置');
  for (const c of p.clipping) {
    if (!c || !['x', 'y', 'z'].includes(c.axis)) throw new Error('剖切设置损坏(轴向非法)');
  }
  if (p.unit !== 'mm' && p.unit !== 'cm') throw new Error('工程缺少单位设置');
  if (!Array.isArray(p.measurements)) throw new Error('工程缺少测量记录');
  for (const m of p.measurements) {
    if (!Array.isArray(m.points) || m.points.length < 2 || m.points.length > 3)
      throw new Error('测量记录损坏(点数非法)');
    for (const pt of m.points) {
      if (!Array.isArray(pt) || pt.length !== 3 || pt.some((v) => typeof v !== 'number' || !isFinite(v)))
        throw new Error('测量记录损坏(坐标非法)');
    }
  }
  return {
    app: PROJECT_APP,
    version: PROJECT_VERSION,
    modelName: p.modelName,
    model: p.model,
    camera: p.camera as ProjectFile['camera'],
    hidden: p.hidden && typeof p.hidden === 'object' ? p.hidden : {},
    clipping: p.clipping,
    unit: p.unit,
    measurements: p.measurements,
  };
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new Error('模型数据 base64 解码失败,文件可能损坏');
  }
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
