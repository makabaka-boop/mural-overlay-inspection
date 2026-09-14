import { describe, expect, it } from 'vitest';
import {
  advanceRuler,
  formatDistance,
  initialRulerState,
  measurePoints,
  roundDistance,
  rulerBlankNotice,
  toRulerPoint,
  type RulerState,
} from '../src/core/ruler';

/** 连续提交若干「落在图像像素上」的点击，返回最终状态 */
function clickThrough(points: Array<{ x: number; y: number }>): RulerState {
  return points.reduce<RulerState>(
    (state, p) => advanceRuler(state, p).state,
    initialRulerState(),
  );
}

describe('测距生命周期：每次点击推进一个阶段', () => {
  it('初始为等待起点，无端点无测量', () => {
    const s = initialRulerState();
    expect(s.phase).toBe('await-start');
    expect(s.start).toBeNull();
    expect(s.end).toBeNull();
    expect(s.measurement).toBeNull();
    expect(s.notice).toBeNull();
  });

  it('第一次点击确定起点 → 等待终点，kind=start', () => {
    const { state, kind } = advanceRuler(initialRulerState(), { x: 100, y: 50 });
    expect(kind).toBe('start');
    expect(state.phase).toBe('await-end');
    expect(state.start).toEqual({ x: 100, y: 50 });
    expect(state.end).toBeNull();
    expect(state.measurement).toBeNull();
  });

  it('第二次点击确定终点并完成 → done，kind=end，产出整数端点与读数', () => {
    const first = advanceRuler(initialRulerState(), { x: 100, y: 50 }).state;
    const { state, kind } = advanceRuler(first, { x: 400, y: 250 });
    expect(kind).toBe('end');
    expect(state.phase).toBe('done');
    expect(state.start).toEqual({ x: 100, y: 50 });
    expect(state.end).toEqual({ x: 400, y: 250 });
    expect(state.measurement).toEqual({
      start: { x: 100, y: 50 },
      end: { x: 400, y: 250 },
      dx: 300,
      dy: 200,
      horizontal: 300,
      vertical: 200,
      distance: 360.56, // √130000 = 360.5551…
    });
    expect(state.notice).toBeNull();
  });

  it('第三次点击开始新一轮：进入等待终点并以该点为起点，kind=restart', () => {
    const done = clickThrough([
      { x: 100, y: 50 },
      { x: 400, y: 250 },
    ]);
    const { state, kind } = advanceRuler(done, { x: 700, y: 600 });
    expect(kind).toBe('restart');
    expect(state.phase).toBe('await-end');
    expect(state.start).toEqual({ x: 700, y: 600 });
    expect(state.end).toBeNull();
  });

  it('新一轮起点落定后、终点落定前，保留最近一次完成结果', () => {
    const restarted = clickThrough([
      { x: 100, y: 50 },
      { x: 400, y: 250 },
      { x: 700, y: 600 },
    ]);
    expect(restarted.phase).toBe('await-end');
    expect(restarted.measurement).not.toBeNull();
    expect(restarted.measurement!.distance).toBe(360.56);
  });

  it('第四次点击完成新一轮，旧测量被新测量替换', () => {
    const s = clickThrough([
      { x: 100, y: 50 },
      { x: 400, y: 250 },
      { x: 700, y: 600 },
      { x: 730, y: 560 },
    ]);
    expect(s.phase).toBe('done');
    expect(s.measurement).not.toBeNull();
    expect(s.measurement!.start).toEqual({ x: 700, y: 600 });
    expect(s.measurement!.end).toEqual({ x: 730, y: 560 });
    // dx=30, dy=−40 → 水平 30、垂直 40、欧氏 50
    expect(s.measurement!.dx).toBe(30);
    expect(s.measurement!.dy).toBe(-40);
    expect(s.measurement!.horizontal).toBe(30);
    expect(s.measurement!.vertical).toBe(40);
    expect(s.measurement!.distance).toBe(50);
  });

  it('可反复测量：首击定起点，此后 end/restart 随点击交替滚动', () => {
    let s = advanceRuler(initialRulerState(), { x: 0, y: 0 }).state;
    expect(s.phase).toBe('await-end');
    // 之后每次点击：完成（done）↔ 新起点（await-end）交替
    for (let round = 0; round < 3; round++) {
      const base = round * 100;
      // 终点 = 上一轮 restart 起点 (base,base) 加 (3,4) → 长度 5
      s = advanceRuler(s, { x: base + 3, y: base + 4 }).state;
      expect(s.phase).toBe('done');
      expect(s.measurement!.distance).toBe(5);
      // 第三击：新一轮起点 (base+100,base+100)
      s = advanceRuler(s, { x: base + 100, y: base + 100 }).state;
      expect(s.phase).toBe('await-end');
      expect(s.start).toEqual({ x: base + 100, y: base + 100 });
    }
  });
});

describe('measurePoints：整数端点与两位小数距离', () => {
  it('纯函数接收原图坐标，端点四舍五入为整数', () => {
    expect(toRulerPoint({ x: 10.4, y: 20.6 })).toEqual({ x: 10, y: 21 });
    expect(toRulerPoint({ x: -0.4, y: 0.5 })).toEqual({ x: -0, y: 1 });
    const m = measurePoints(toRulerPoint({ x: 10.4, y: 20.6 }), { x: 13, y: 25 });
    expect(m.start).toEqual({ x: 10, y: 21 });
    expect(m.end).toEqual({ x: 13, y: 25 });
    expect(m.horizontal).toBe(3);
    expect(m.vertical).toBe(4);
    expect(m.distance).toBe(5);
  });

  it('水平差、垂直差为带符号差值，另给绝对值', () => {
    const m = measurePoints({ x: 400, y: 300 }, { x: 100, y: 100 });
    expect(m.dx).toBe(-300);
    expect(m.dy).toBe(-200);
    expect(m.horizontal).toBe(300);
    expect(m.vertical).toBe(200);
    expect(m.distance).toBe(360.56);
  });

  it('欧氏长度保留两位小数（四舍五入）', () => {
    // 1×1 对角线 √2 = 1.41421… → 1.41
    expect(measurePoints({ x: 0, y: 0 }, { x: 1, y: 1 }).distance).toBe(1.41);
    // 3×4 = 5（整数也保留为数值 5，展示时补齐 5.00）
    expect(measurePoints({ x: 0, y: 0 }, { x: 3, y: 4 }).distance).toBe(5);
    // 构造向上进位：找 dx²+dy² 使第三位小数 ≥ 5
    // √(12²+17²)=√433=20.80865… → 20.81
    expect(measurePoints({ x: 0, y: 0 }, { x: 12, y: 17 }).distance).toBe(20.81);
    // 零长度
    const zero = measurePoints({ x: 8, y: 9 }, { x: 8, y: 9 });
    expect(zero.distance).toBe(0);
    expect(zero.horizontal).toBe(0);
    expect(zero.vertical).toBe(0);
  });

  it('roundDistance / formatDistance：数值两位、展示固定两位', () => {
    expect(roundDistance(1.41421)).toBe(1.41);
    expect(roundDistance(20.80865)).toBe(20.81);
    expect(formatDistance(5)).toBe('5.00');
    expect(formatDistance(360.56)).toBe('360.56');
    expect(formatDistance(0)).toBe('0.00');
  });

  it('不修改传入的端点对象', () => {
    const start = { x: 1, y: 2 };
    const end = { x: 5, y: 6 };
    const m = measurePoints(start, end);
    expect(m.start).not.toBe(start);
    expect(m.end).not.toBe(end);
    expect(start).toEqual({ x: 1, y: 2 });
    expect(end).toEqual({ x: 5, y: 6 });
  });
});

describe('留白点击：显示无法测距并保持当前阶段', () => {
  it('等待起点时点留白：阶段与端点不变，仅置提示', () => {
    const s0 = initialRulerState();
    const s = rulerBlankNotice(s0);
    expect(s.phase).toBe('await-start');
    expect(s.start).toBeNull();
    expect(s.measurement).toBeNull();
    expect(s.notice).toBe('此处无法测距');
  });

  it('等待终点时点留白：保留起点、不完成测量，阶段保持 await-end', () => {
    const awaiting = clickThrough([{ x: 100, y: 50 }]);
    const s = rulerBlankNotice(awaiting);
    expect(s.phase).toBe('await-end');
    expect(s.start).toEqual({ x: 100, y: 50 });
    expect(s.end).toBeNull();
    expect(s.measurement).toBeNull();
    expect(s.notice).toBe('此处无法测距');
    // 再点有效处仍可正常完成（起点未丢失）
    const done = advanceRuler(s, { x: 130, y: 90 }).state;
    expect(done.phase).toBe('done');
    expect(done.measurement!.start).toEqual({ x: 100, y: 50 });
    expect(done.measurement!.distance).toBe(50); // 30×40
  });

  it('已完成时点留白：保留最近一次完成结果与读数', () => {
    const done = clickThrough([
      { x: 100, y: 50 },
      { x: 400, y: 250 },
    ]);
    const s = rulerBlankNotice(done);
    expect(s.phase).toBe('done');
    expect(s.start).toEqual({ x: 100, y: 50 });
    expect(s.end).toEqual({ x: 400, y: 250 });
    expect(s.measurement!.distance).toBe(360.56);
    expect(s.notice).toBe('此处无法测距');
    // 再点有效处开启新一轮（第三击语义），旧读数仍暂留
    const restarted = advanceRuler(s, { x: 1, y: 1 }).state;
    expect(restarted.phase).toBe('await-end');
    expect(restarted.start).toEqual({ x: 1, y: 1 });
    expect(restarted.measurement!.distance).toBe(360.56);
  });

  it('新一轮等待终点时留白：保留起点且旧测量读数不丢', () => {
    const restarted = clickThrough([
      { x: 100, y: 50 },
      { x: 400, y: 250 },
      { x: 700, y: 600 },
    ]);
    const s = rulerBlankNotice(restarted);
    expect(s.phase).toBe('await-end');
    expect(s.start).toEqual({ x: 700, y: 600 });
    expect(s.measurement!.distance).toBe(360.56);
    expect(s.notice).toBe('此处无法测距');
  });

  it('有效点击推进时清除留白提示', () => {
    const awaiting = clickThrough([{ x: 100, y: 50 }]);
    const warned = rulerBlankNotice(awaiting);
    const done = advanceRuler(warned, { x: 130, y: 90 }).state;
    expect(done.notice).toBeNull();
  });
});
