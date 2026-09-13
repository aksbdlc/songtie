import { describe, expect, it } from 'vitest';
import type { DrawingElement } from '../../domain/types';
import {
  elementBounds,
  findTopElement,
  hitTestElement,
  moveElement,
  resizeElement,
} from './geometry';

const canvas = { width: 300, height: 200 };

describe('drawing geometry', () => {
  it('moves a whole element but keeps it inside the finite canvas', () => {
    const rectangle: DrawingElement = {
      id: 'rect',
      type: 'rectangle',
      x: 20,
      y: 30,
      width: 80,
      height: 60,
      strokeColor: '#111',
      fillColor: 'transparent',
      strokeWidth: 2,
    };

    expect(moveElement(rectangle, 500, 500, canvas)).toMatchObject({
      x: 220,
      y: 140,
    });
  });

  it('resizes reverse-direction lines without flipping their orientation', () => {
    const line: DrawingElement = {
      id: 'line',
      type: 'line',
      start: { x: 100, y: 100 },
      end: { x: 20, y: 20 },
      color: '#111',
      strokeWidth: 2,
    };
    const resized = resizeElement(line, { x: 180, y: 160 }, canvas);

    expect(resized.type).toBe('line');
    if (resized.type !== 'line') return;
    expect(resized.start.x).toBeGreaterThan(resized.end.x);
    expect(resized.start.y).toBeGreaterThan(resized.end.y);
    expect(elementBounds(resized)).toMatchObject({
      x: 20,
      y: 20,
      width: 160,
      height: 140,
    });
  });

  it('hits strokes and chooses the visually topmost element', () => {
    const bottom: DrawingElement = {
      id: 'bottom',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#111',
      fillColor: 'transparent',
      strokeWidth: 2,
    };
    const top: DrawingElement = {
      id: 'top',
      type: 'path',
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
      color: '#111',
      strokeWidth: 3,
    };

    expect(hitTestElement(top, { x: 50, y: 52 })).toBe(true);
    expect(findTopElement([bottom, top], { x: 50, y: 52 })?.id).toBe('top');
  });

  it('scales text and its font together from the bottom-right handle', () => {
    const text: DrawingElement = {
      id: 'text',
      type: 'text',
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      text: '松贴',
      fontSize: 20,
      lineHeight: 26,
      color: '#111',
    };
    const resized = resizeElement(text, { x: 210, y: 110 }, canvas);

    expect(resized).toMatchObject({
      type: 'text',
      width: 200,
      height: 100,
      fontSize: 40,
      lineHeight: 52,
    });
  });
});
