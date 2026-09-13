import { describe, expect, it } from 'vitest';

import {
  constrainElement,
  constrainScene,
  createEmptyScene,
  sceneFitsBounds,
  type DrawingElement,
} from './drawing';
import { DomainError } from './errors';

describe('有限绘图场景', () => {
  it('使用自有且可版本化的 songtie-svg 包络', () => {
    expect(createEmptyScene('#fff')).toEqual({
      schemaVersion: 1,
      engine: 'songtie-svg',
      backgroundColor: '#fff',
      elements: [],
    });
  });

  it('平移越界元素，并等比缩小超过画布的元素', () => {
    const text = constrainElement(
      {
        id: 'text',
        type: 'text',
        x: -100,
        y: -50,
        width: 780,
        height: 520,
        text: '完整内容',
        fontSize: 40,
        lineHeight: 52,
        color: '#000',
      },
      { width: 390, height: 260 },
    );

    expect(text).toMatchObject({
      x: 0,
      y: 0,
      width: 390,
      height: 260,
      fontSize: 20,
      lineHeight: 26,
    });
  });

  it('限制所有受支持的图形类型', () => {
    const elements: DrawingElement[] = [
      {
        id: 'path',
        type: 'path',
        points: [
          { x: -40, y: -20 },
          { x: 440, y: 320 },
        ],
        color: '#111',
        strokeWidth: 4,
      },
      {
        id: 'line',
        type: 'line',
        start: { x: -10, y: 20 },
        end: { x: 500, y: 20 },
        color: '#111',
        strokeWidth: 4,
      },
      {
        id: 'arrow',
        type: 'arrow',
        start: { x: 10, y: -20 },
        end: { x: 10, y: 500 },
        color: '#111',
        strokeWidth: 4,
      },
      {
        id: 'rectangle',
        type: 'rectangle',
        x: 420,
        y: 300,
        width: -500,
        height: -400,
        strokeColor: '#111',
        fillColor: 'transparent',
        strokeWidth: 4,
      },
      {
        id: 'ellipse',
        type: 'ellipse',
        x: 380,
        y: 250,
        width: 80,
        height: 80,
        strokeColor: '#111',
        fillColor: 'transparent',
        strokeWidth: 4,
      },
    ];
    const scene = constrainScene({ ...createEmptyScene(), elements }, { width: 390, height: 260 });

    for (const element of scene.elements) {
      const box = elementBounds(element);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(260);
    }
  });

  it('拒绝无效场景而不是把 NaN 写入存储', () => {
    expect(() =>
      constrainScene(
        {
          ...createEmptyScene(),
          elements: [
            {
              id: 'bad',
              type: 'line',
              start: { x: Number.NaN, y: 0 },
              end: { x: 1, y: 1 },
              color: '#000',
              strokeWidth: 2,
            },
          ],
        },
        { width: 100, height: 100 },
      ),
    ).toThrowError(DomainError);
  });

  it('只有无需移动或缩小的场景才算完整放入目标纸张', () => {
    const scene = {
      ...createEmptyScene(),
      elements: [
        {
          id: 'text',
          type: 'text' as const,
          x: 18,
          y: 18,
          width: 144,
          height: 72,
          text: '完整可见',
          fontSize: 20,
          lineHeight: 26,
          color: '#111',
        },
      ],
    };

    expect(sceneFitsBounds(scene, { width: 180, height: 108 })).toBe(true);
    expect(sceneFitsBounds(scene, { width: 120, height: 80 })).toBe(false);
  });
});

function elementBounds(element: DrawingElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (element.type) {
    case 'text':
    case 'rectangle':
    case 'ellipse':
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      };
    case 'line':
    case 'arrow': {
      const x = Math.min(element.start.x, element.end.x);
      const y = Math.min(element.start.y, element.end.y);
      return {
        x,
        y,
        width: Math.abs(element.end.x - element.start.x),
        height: Math.abs(element.end.y - element.start.y),
      };
    }
    case 'path': {
      const xs = element.points.map(({ x }) => x);
      const ys = element.points.map(({ y }) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      };
    }
  }
}
