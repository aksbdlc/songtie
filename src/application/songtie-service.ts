import {
  NOTE_DIMENSIONS,
  DomainError,
  assertWallCanContainNotes,
  clampNotePosition,
  classifyQuickText,
  constrainScene,
  createEmptyScene,
  createQuickTextScene,
  findAutomaticPosition,
  nextZIndex,
  sceneFitsBounds,
  snapNotePosition,
  withPoint,
  type Bounds,
  type CompletedNote,
  type DrawingScene,
  type Note,
  type NoteId,
  type NoteSize,
  type Point,
  type Wall,
} from '../domain';
import type { Clock, IdGenerator, SongtieRepository } from './ports';

const NOTE_BACKGROUND = '#fff2a8';
const WALL_BACKGROUND = '#f5f0e6';

export type SongtieSnapshot = {
  wall: Wall;
  notes: Note[];
  completedNotes: CompletedNote[];
};

export type SaveNoteInput = {
  id: NoteId;
  scene: DrawingScene;
  size?: NoteSize;
  passiveDate?: string | null;
};

export type CreateWallNoteInput = {
  scene?: DrawingScene;
  passiveDate?: string | null;
};

export type MoveNoteOptions = {
  snap?: boolean;
};

export class SongtieService {
  constructor(
    private readonly repository: SongtieRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async initializeWall(bounds: Bounds): Promise<Wall> {
    assertWallCanContainNotes(bounds);
    if ((await this.repository.getWall()) !== null) {
      throw new DomainError('WALL_ALREADY_INITIALIZED', '当前墙已经建立，不能用新的尺寸覆盖。');
    }

    const wall: Wall = {
      id: 'active',
      bounds: { ...bounds },
      scene: createEmptyScene(WALL_BACKGROUND),
      revision: 1,
      updatedAt: this.nowIso(),
    };
    await this.repository.initializeWall(wall);
    return wall;
  }

  async getSnapshot(): Promise<SongtieSnapshot> {
    const [wall, notes, completedNotes] = await Promise.all([
      this.repository.getWall(),
      this.repository.listNotes(),
      this.repository.listCompletedNotes(),
    ]);
    if (wall === null) this.wallMissing();

    return {
      wall,
      notes: notes.sort(
        (left, right) =>
          left.position.z - right.position.z ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      ),
      completedNotes: completedNotes.sort(
        (left, right) =>
          left.completedOrder - right.completedOrder || left.id.localeCompare(right.id),
      ),
    };
  }

  async captureQuickNote(text: string): Promise<Note> {
    const wall = await this.requireWall();
    const { size } = classifyQuickText(text);
    return this.createActiveNote({
      wall,
      size,
      sceneFactory: (id) => createQuickTextScene(text, size, `${id}:text`),
      passiveDate: null,
    });
  }

  /** A note made while looking at the wall starts as a large, blank canvas. */
  async createWallNote(input: CreateWallNoteInput = {}): Promise<Note> {
    const wall = await this.requireWall();
    return this.createActiveNote({
      wall,
      size: 'L',
      sceneFactory: () =>
        constrainScene(input.scene ?? createEmptyScene(NOTE_BACKGROUND), NOTE_DIMENSIONS.L),
      passiveDate: input.passiveDate ?? null,
    });
  }

  async moveNote(id: NoteId, requested: Point, options: MoveNoteOptions = {}): Promise<Note> {
    const [wall, note, notes] = await Promise.all([
      this.requireWall(),
      this.requireNote(id),
      this.repository.listNotes(),
    ]);
    const others = notes.filter((candidate) => candidate.id !== id);
    const point =
      options.snap === false
        ? clampNotePosition(requested, note.size, wall.bounds)
        : snapNotePosition(requested, note.size, others, wall.bounds);
    const updated = this.bumpNote(note, {
      position: { ...point, z: nextZIndex(others) },
    });
    await this.repository.updateNote(updated, note.revision);
    return updated;
  }

  async saveNote(input: SaveNoteInput): Promise<Note> {
    const [wall, note] = await Promise.all([this.requireWall(), this.requireNote(input.id)]);
    const size = input.size ?? note.size;
    if (size !== note.size && !sceneFitsBounds(input.scene, NOTE_DIMENSIONS[size])) {
      throw new DomainError(
        'SCENE_DOES_NOT_FIT',
        '纸片里的内容放不进这个尺寸。请先整理内容，或选择更大的纸片。',
      );
    }
    const position = clampNotePosition(note.position, size, wall.bounds);
    const updated = this.bumpNote(note, {
      size,
      position: withPoint(note.position, position),
      scene: constrainScene(input.scene, NOTE_DIMENSIONS[size]),
      passiveDate: input.passiveDate === undefined ? note.passiveDate : input.passiveDate,
    });
    await this.repository.updateNote(updated, note.revision);
    return updated;
  }

  async saveWallScene(scene: DrawingScene): Promise<Wall> {
    const wall = await this.requireWall();
    const updated: Wall = {
      ...wall,
      scene: constrainScene(scene, wall.bounds),
      revision: wall.revision + 1,
      updatedAt: this.nowIso(),
    };
    await this.repository.updateWall(updated, wall.revision);
    return updated;
  }

  async completeNote(id: NoteId): Promise<CompletedNote> {
    const [note, completedNotes] = await Promise.all([
      this.requireNote(id),
      this.repository.listCompletedNotes(),
    ]);
    const completed: CompletedNote = {
      id: note.id,
      size: note.size,
      scene: note.scene,
      completedOn: formatLocalDate(this.clock.now()),
      completedOrder:
        completedNotes.reduce((largest, item) => Math.max(largest, item.completedOrder), 0) + 1,
    };
    await this.repository.completeNote(id, note.revision, completed);
    return completed;
  }

  async deleteNote(id: NoteId): Promise<void> {
    const note = await this.requireNote(id);
    await this.repository.deleteNote(id, note.revision);
  }

  private async createActiveNote(input: {
    wall: Wall;
    size: NoteSize;
    sceneFactory: (noteId: string) => DrawingScene;
    passiveDate: string | null;
  }): Promise<Note> {
    const notes = await this.repository.listNotes();
    const id = this.ids.nextId();
    if (!id.trim()) {
      throw new DomainError('INVALID_NOTE', 'id 生成器返回了空值。');
    }
    const now = this.nowIso();
    const point = findAutomaticPosition(input.size, notes, input.wall.bounds, id);
    const note: Note = {
      id,
      size: input.size,
      position: { ...point, z: nextZIndex(notes) },
      scene: constrainScene(input.sceneFactory(id), NOTE_DIMENSIONS[input.size]),
      passiveDate: input.passiveDate,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.createNote(note);
    return note;
  }

  private bumpNote(
    note: Note,
    changes: Partial<Pick<Note, 'position' | 'scene' | 'size' | 'passiveDate'>>,
  ): Note {
    return {
      ...note,
      ...changes,
      revision: note.revision + 1,
      updatedAt: this.nowIso(),
    };
  }

  private async requireWall(): Promise<Wall> {
    const wall = await this.repository.getWall();
    if (wall === null) this.wallMissing();
    return wall;
  }

  private wallMissing(): never {
    throw new DomainError('WALL_NOT_INITIALIZED', '当前墙尚未建立，请先使用屏幕尺寸初始化。');
  }

  private async requireNote(id: NoteId): Promise<Note> {
    const note = await this.repository.getNote(id);
    if (note === null) {
      throw new DomainError('NOTE_NOT_FOUND', `找不到便利贴 ${id}。`);
    }
    return note;
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }
}

export function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
