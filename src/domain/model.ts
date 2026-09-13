import type { DrawingScene } from './drawing';
import { DomainError } from './errors';

export type NoteId = string;
export type NoteSize = 'S' | 'M' | 'L';

export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  width: number;
  height: number;
};

export type NotePosition = Point & {
  z: number;
};

export const NOTE_DIMENSIONS: Readonly<Record<NoteSize, Bounds>> = {
  S: { width: 180, height: 108 },
  M: { width: 270, height: 180 },
  L: { width: 390, height: 260 },
};

export type Note = {
  id: NoteId;
  size: NoteSize;
  position: NotePosition;
  scene: DrawingScene;
  passiveDate: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type Wall = {
  id: 'active';
  bounds: Bounds;
  scene: DrawingScene;
  revision: number;
  updatedAt: string;
};

export type CompletedNote = {
  id: NoteId;
  size: NoteSize;
  scene: DrawingScene;
  completedOn: string;
  completedOrder: number;
};

export function assertBounds(bounds: Bounds): void {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new DomainError('INVALID_BOUNDS', '画布宽高必须是大于零的有限数值。');
  }
}

export function assertWallCanContainNotes(bounds: Bounds): void {
  assertBounds(bounds);
  const largest = NOTE_DIMENSIONS.L;
  if (bounds.width < largest.width || bounds.height < largest.height) {
    throw new DomainError(
      'INVALID_BOUNDS',
      `墙面至少需要 ${largest.width}×${largest.height}，才能完整容纳大号便利贴。`,
    );
  }
}

export function assertNote(note: Note): void {
  if (!note.id.trim()) {
    throw new DomainError('INVALID_NOTE', '便利贴必须有非空 id。');
  }

  const numbers = [note.position.x, note.position.y, note.position.z, note.revision];
  if (numbers.some((value) => !Number.isFinite(value))) {
    throw new DomainError('INVALID_NOTE', '便利贴位置和版本必须是有限数值。');
  }
  if (note.position.z < 0 || !Number.isInteger(note.position.z)) {
    throw new DomainError('INVALID_NOTE', '便利贴层级必须是非负整数。');
  }
  if (note.revision < 1 || !Number.isInteger(note.revision)) {
    throw new DomainError('INVALID_NOTE', '便利贴版本必须是正整数。');
  }
}
