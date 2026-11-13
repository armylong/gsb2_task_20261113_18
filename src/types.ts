export type Unit = 'mm' | 'cm';
export type Axis = 'x' | 'y' | 'z';
export type ToolMode = 'select' | 'measure';

/** 单个切面的可序列化状态 */
export interface ClipPlaneState {
  axis: Axis;
  enabled: boolean;
  /** 沿轴的位置(模型单位 mm) */
  position: number;
  /** 是否翻转保留方向 */
  flipped: boolean;
}

/** 一条测量记录(点为世界坐标,模型单位) */
export interface Measurement {
  id: number;
  /** 2 个点 = 距离;3 个点 = 距离 + 角度(顶点在第 2 个点) */
  points: [number, number, number][];
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

/** 工程文件(可序列化) */
export interface ProjectFile {
  app: 'model-inspector';
  version: 1;
  modelName: string;
  /** 'demo' 表示内置演示模型,否则为 glb 的 base64 */
  model: { kind: 'demo' } | { kind: 'glb'; dataBase64: string };
  camera: CameraState;
  /** 节点路径(如 "0/2/1") -> 是否隐藏 */
  hidden: Record<string, boolean>;
  clipping: ClipPlaneState[];
  unit: Unit;
  measurements: Measurement[];
}

export interface MeasureResult {
  id: number;
  distance: number | null;
  angleDeg: number | null;
}
