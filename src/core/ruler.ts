/**
 * 原图像素测距尺核心逻辑（纯函数，不依赖 DOM / Canvas）。
 *
 * 尺以「原图坐标」为唯一坐标模型，与视口/倍率无关：
 * - 两端为原图整数坐标，缩放/平移只移动其屏幕位置；
 * - 读数 = 水平差 |dx|、垂直差 |dy| 与欧氏长度 √(dx²+dy²)（保留两位小数）；
 * - 生命周期三阶段：等待起点 → 等待终点 → 已完成；
 *   第一次左键定起点、第二次定终点并完成、第三次点击开始新一轮。
 *
 * 点击是否落在小图居中留白由调用方复用 sample.resolveSamplePoint 判定，
 * 留白点击不推进阶段（保持当前阶段）。
 */
import type { Point } from './viewport';

/** 测距尺生命周期阶段 */
export type RulerPhase = 'await-start' | 'await-end' | 'done';

/** 一次点击相对当前阶段的归属 */
export type RulerClickKind = 'start' | 'end' | 'restart';

/** 测距端点（原图整数坐标） */
export interface RulerPoint {
  x: number;
  y: number;
}

/** 一次完成的测量：整数端点 + 差值 + 保留两位小数的欧氏长度 */
export interface RulerMeasurement {
  start: RulerPoint;
  end: RulerPoint;
  /** 水平差 = end.x − start.x（带符号整数） */
  dx: number;
  /** 垂直差 = end.y − start.y（带符号整数） */
  dy: number;
  /** 水平差绝对值（像素） */
  horizontal: number;
  /** 垂直差绝对值（像素） */
  vertical: number;
  /** 欧氏长度，保留两位小数 */
  distance: number;
}

/** 测距尺完整状态（由 App 持有） */
export interface RulerState {
  phase: RulerPhase;
  /** 已确定的起点：await-end / done 阶段存在 */
  start: RulerPoint | null;
  /** 已确定的终点：仅 done 阶段存在；旧测量在新一轮起点落定前保留 */
  end: RulerPoint | null;
  measurement: RulerMeasurement | null;
  /** 留白等非阻断反馈文案 */
  notice: string | null;
}

/** 一次有效点击（已确认落在图像像素上）对状态的推进结果 */
export interface RulerAdvance {
  state: RulerState;
  /** 本次点击完成的阶段归属；空白点击不推进时为 null */
  kind: RulerClickKind | null;
}

/** 开启测距 / 新一轮前的初始状态 */
export function initialRulerState(): RulerState {
  return { phase: 'await-start', start: null, end: null, measurement: null, notice: null };
}

/** 任意浮点原图坐标取整为整数端点（四舍五入） */
export function toRulerPoint(p: Point): RulerPoint {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** 欧氏长度保留两位小数（先按数值四舍五入，展示时用 formatDistance 补齐两位） */
export function roundDistance(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 距离展示：固定两位小数字符串 */
export function formatDistance(value: number): string {
  return value.toFixed(2);
}

/** 由两个整数端点组装测量：水平差、垂直差与欧氏长度 */
export function measurePoints(start: RulerPoint, end: RulerPoint): RulerMeasurement {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    start: { ...start },
    end: { ...end },
    dx,
    dy,
    horizontal: Math.abs(dx),
    vertical: Math.abs(dy),
    distance: roundDistance(Math.hypot(dx, dy)),
  };
}

/** 生成留白反馈：阶段与测量均不变（点击未推进生命周期） */
export function rulerBlankNotice(state: RulerState): RulerState {
  return { ...state, notice: '此处无法测距' };
}

/**
 * 提交一次已确认落在图像像素上的点击（原图浮点坐标），推进生命周期：
 * - await-start：落定起点 → await-end（kind 'start'）；
 * - await-end ：落定终点并完成测量 → done（kind 'end'）；
 * - done      ：以该点为新一轮起点，保留旧测量读数 → await-end（kind 'restart'）。
 */
export function advanceRuler(state: RulerState, point: Point): RulerAdvance {
  const p = toRulerPoint(point);
  if (state.phase === 'await-end' && state.start) {
    const measurement = measurePoints(state.start, p);
    return {
      kind: 'end',
      state: {
        phase: 'done',
        start: state.start,
        end: p,
        measurement,
        notice: null,
      },
    };
  }
  // await-start：首次测量；done：第三次点击开始新一轮（旧测量暂留读数）
  return {
    kind: state.phase === 'done' ? 'restart' : 'start',
    state: {
      phase: 'await-end',
      start: p,
      end: null,
      // 新一轮起点落定前保留最近一次完成结果
      measurement: state.measurement,
      notice: null,
    },
  };
}
