import { describe, expect, it } from 'vitest';

import { clampNotePosition, findAutomaticPosition, snapNotePosition } from './geometry';
import type { Note } from './model';

const wall = { width: 800, height: 600 };

describe('有限墙面几何规则', () => {
  it('把便利贴完整限制在墙内', () => {
    expect(clampNotePosition({ x: -20, y: 900 }, 'L', wall)).toEqual({
      x: 0,
      y: 340,
    });
  });

  it('靠近时轻微吸附到相邻边缘和对齐线', () => {
    const other = positionedNote('other', 'S', 100, 100);
    expect(snapNotePosition({ x: 288, y: 104 }, 'S', [other], wall)).toEqual({ x: 280, y: 100 });
  });

  it('只对真正靠近的便利贴吸附', () => {
    const other = positionedNote('other', 'S', 100, 100);
    expect(snapNotePosition({ x: 288, y: 500 }, 'S', [other], { width: 800, height: 800 })).toEqual(
      { x: 288, y: 500 },
    );
  });

  it('自动落点确定、在界内，并优先选择无重叠空间', () => {
    const occupied = positionedNote('existing', 'L', 18, 18);
    const first = findAutomaticPosition('M', [occupied], wall, 'new-note');
    const second = findAutomaticPosition('M', [occupied], wall, 'new-note');

    expect(second).toEqual(first);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.y).toBeGreaterThanOrEqual(0);
    expect(first.x + 270).toBeLessThanOrEqual(wall.width);
    expect(first.y + 180).toBeLessThanOrEqual(wall.height);
    expect(
      rectanglesOverlap(first, { width: 270, height: 180 }, occupied.position, {
        width: 390,
        height: 260,
      }),
    ).toBe(false);
  });
});

function positionedNote(
  id: string,
  size: Note['size'],
  x: number,
  y: number,
): Pick<Note, 'id' | 'size' | 'position'> {
  return { id, size, position: { x, y, z: 0 } };
}

function rectanglesOverlap(
  left: { x: number; y: number },
  leftSize: { width: number; height: number },
  right: { x: number; y: number },
  rightSize: { width: number; height: number },
): boolean {
  return !(
    left.x + leftSize.width <= right.x ||
    right.x + rightSize.width <= left.x ||
    left.y + leftSize.height <= right.y ||
    right.y + rightSize.height <= left.y
  );
}
