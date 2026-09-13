import { DomainError } from './errors';
import {
  NOTE_DIMENSIONS,
  assertBounds,
  type Bounds,
  type Note,
  type NotePosition,
  type NoteSize,
  type Point,
} from './model';

export const NOTE_SNAP_THRESHOLD = 10;
const AUTO_PLACEMENT_MARGIN = 18;
const AUTO_PLACEMENT_STEP = 24;
const AUTO_PLACEMENT_GAP = 12;

type PlaceableNote = Pick<Note, 'id' | 'size' | 'position'>;

type Rect = Point & Bounds;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function assertPoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new DomainError('INVALID_NOTE', '便利贴坐标必须是有限数值。');
  }
}

export function clampNotePosition(point: Point, size: NoteSize, wallBounds: Bounds): Point {
  assertPoint(point);
  assertBounds(wallBounds);
  const noteBounds = NOTE_DIMENSIONS[size];
  return {
    x: clamp(point.x, 0, Math.max(0, wallBounds.width - noteBounds.width)),
    y: clamp(point.y, 0, Math.max(0, wallBounds.height - noteBounds.height)),
  };
}

function intervalGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): number {
  if (firstEnd < secondStart) return secondStart - firstEnd;
  if (secondEnd < firstStart) return firstStart - secondEnd;
  return 0;
}

type SnapCandidate = {
  coordinate: number;
  distance: number;
  noteId: string;
};

function chooseSnap(original: number, candidates: SnapCandidate[], maximum: number): number {
  const valid = candidates
    .filter(
      ({ coordinate, distance }) =>
        coordinate >= 0 && coordinate <= maximum && distance <= NOTE_SNAP_THRESHOLD,
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.coordinate - right.coordinate ||
        left.noteId.localeCompare(right.noteId),
    );
  return valid[0]?.coordinate ?? original;
}

/** Snaps only when the two notes are also nearby on the perpendicular axis. */
export function snapNotePosition(
  requested: Point,
  size: NoteSize,
  otherNotes: PlaceableNote[],
  wallBounds: Bounds,
): Point {
  const position = clampNotePosition(requested, size, wallBounds);
  const own = NOTE_DIMENSIONS[size];
  const maxX = Math.max(0, wallBounds.width - own.width);
  const maxY = Math.max(0, wallBounds.height - own.height);
  const xCandidates: SnapCandidate[] = [];
  const yCandidates: SnapCandidate[] = [];

  for (const other of otherNotes) {
    const dimensions = NOTE_DIMENSIONS[other.size];
    const otherPoint = clampNotePosition(other.position, other.size, wallBounds);
    const verticalGap = intervalGap(
      position.y,
      position.y + own.height,
      otherPoint.y,
      otherPoint.y + dimensions.height,
    );
    if (verticalGap <= NOTE_SNAP_THRESHOLD * 2) {
      for (const coordinate of [
        otherPoint.x,
        otherPoint.x + dimensions.width - own.width,
        otherPoint.x + dimensions.width,
        otherPoint.x - own.width,
      ]) {
        xCandidates.push({
          coordinate,
          distance: Math.abs(position.x - coordinate),
          noteId: other.id,
        });
      }
    }

    const horizontalGap = intervalGap(
      position.x,
      position.x + own.width,
      otherPoint.x,
      otherPoint.x + dimensions.width,
    );
    if (horizontalGap <= NOTE_SNAP_THRESHOLD * 2) {
      for (const coordinate of [
        otherPoint.y,
        otherPoint.y + dimensions.height - own.height,
        otherPoint.y + dimensions.height,
        otherPoint.y - own.height,
      ]) {
        yCandidates.push({
          coordinate,
          distance: Math.abs(position.y - coordinate),
          noteId: other.id,
        });
      }
    }
  }

  return {
    x: chooseSnap(position.x, xCandidates, maxX),
    y: chooseSnap(position.y, yCandidates, maxY),
  };
}

function axisCandidates(maximum: number): number[] {
  if (maximum <= 0) return [0];
  const first = Math.min(AUTO_PLACEMENT_MARGIN, maximum);
  const values = new Set<number>([first, maximum]);
  for (let value = first; value <= maximum; value += AUTO_PLACEMENT_STEP) {
    values.add(value);
  }
  return [...values].sort((left, right) => left - right);
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function overlapArea(left: Rect, right: Rect): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
}

/**
 * Finds the least-overlapping finite position and uses the id as a stable
 * visual scatter seed. When space exists, an overlap-free position always wins.
 */
export function findAutomaticPosition(
  size: NoteSize,
  existingNotes: PlaceableNote[],
  wallBounds: Bounds,
  seed: string,
): Point {
  assertBounds(wallBounds);
  const dimensions = NOTE_DIMENSIONS[size];
  const maxX = Math.max(0, wallBounds.width - dimensions.width);
  const maxY = Math.max(0, wallBounds.height - dimensions.height);
  const hash = hashSeed(seed);
  const target = {
    x: maxX * ((hash & 0xffff) / 0xffff),
    y: maxY * (((hash >>> 16) & 0xffff) / 0xffff),
  };
  const occupied = existingNotes.map((note) => {
    const point = clampNotePosition(note.position, note.size, wallBounds);
    const bounds = NOTE_DIMENSIONS[note.size];
    return {
      x: point.x - AUTO_PLACEMENT_GAP,
      y: point.y - AUTO_PLACEMENT_GAP,
      width: bounds.width + AUTO_PLACEMENT_GAP * 2,
      height: bounds.height + AUTO_PLACEMENT_GAP * 2,
    };
  });

  let best: { point: Point; overlap: number; distance: number } | undefined;
  for (const y of axisCandidates(maxY)) {
    for (const x of axisCandidates(maxX)) {
      const rect = { x, y, ...dimensions };
      const overlap = occupied.reduce((total, other) => total + overlapArea(rect, other), 0);
      const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
      if (
        best === undefined ||
        overlap < best.overlap ||
        (overlap === best.overlap && distance < best.distance) ||
        (overlap === best.overlap &&
          distance === best.distance &&
          (y < best.point.y || (y === best.point.y && x < best.point.x)))
      ) {
        best = { point: { x, y }, overlap, distance };
      }
    }
  }

  return best?.point ?? { x: 0, y: 0 };
}

export function nextZIndex(notes: PlaceableNote[]): number {
  return notes.reduce((largest, note) => Math.max(largest, note.position.z), -1) + 1;
}

export function withPoint(position: NotePosition, point: Point): NotePosition {
  return { ...point, z: position.z };
}
