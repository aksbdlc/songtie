import {
  DomainError,
  assertDrawingScene,
  assertNote,
  type CompletedNote,
  type Note,
  type NoteId,
  type Wall,
} from '../domain';
import type { SongtieRepository } from '../application/ports';

type RepositorySeed = {
  wall?: Wall;
  notes?: Note[];
  completedNotes?: CompletedNote[];
};

export type RepositoryState = {
  wall: Wall | null;
  notes: Note[];
  completedNotes: CompletedNote[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemorySongtieRepository implements SongtieRepository {
  private wall: Wall | null;
  private readonly notes = new Map<NoteId, Note>();
  private readonly completedNotes = new Map<NoteId, CompletedNote>();

  constructor(seed: RepositorySeed = {}) {
    this.wall = seed.wall ? clone(seed.wall) : null;
    for (const note of seed.notes ?? []) this.notes.set(note.id, clone(note));
    for (const note of seed.completedNotes ?? []) {
      this.completedNotes.set(note.id, clone(note));
    }
  }

  async getWall(): Promise<Wall | null> {
    await Promise.resolve();
    return this.wall ? clone(this.wall) : null;
  }

  async initializeWall(wall: Wall): Promise<void> {
    await Promise.resolve();
    if (this.wall !== null) {
      throw new DomainError('WALL_ALREADY_INITIALIZED', '当前墙已经初始化。');
    }
    assertDrawingScene(wall.scene);
    this.wall = clone(wall);
  }

  async updateWall(wall: Wall, expectedRevision: number): Promise<void> {
    await Promise.resolve();
    if (this.wall === null) {
      throw new DomainError('WALL_NOT_INITIALIZED', '当前墙尚未初始化。');
    }
    if (this.wall.revision !== expectedRevision || wall.revision !== expectedRevision + 1) {
      this.revisionConflict('墙面', expectedRevision, this.wall.revision);
    }
    assertDrawingScene(wall.scene);
    this.wall = clone(wall);
  }

  async listNotes(): Promise<Note[]> {
    await Promise.resolve();
    return [...this.notes.values()].map(clone);
  }

  async getNote(id: NoteId): Promise<Note | null> {
    await Promise.resolve();
    const note = this.notes.get(id);
    return note ? clone(note) : null;
  }

  async createNote(note: Note): Promise<void> {
    await Promise.resolve();
    if (this.notes.has(note.id) || this.completedNotes.has(note.id)) {
      throw new DomainError('DUPLICATE_NOTE', `便利贴 ${note.id} 已经存在。`);
    }
    assertNote(note);
    assertDrawingScene(note.scene);
    this.notes.set(note.id, clone(note));
  }

  async updateNote(note: Note, expectedRevision: number): Promise<void> {
    await Promise.resolve();
    const current = this.notes.get(note.id);
    if (!current) this.noteMissing(note.id);
    if (current.revision !== expectedRevision || note.revision !== expectedRevision + 1) {
      this.revisionConflict(`便利贴 ${note.id}`, expectedRevision, current.revision);
    }
    assertNote(note);
    assertDrawingScene(note.scene);
    this.notes.set(note.id, clone(note));
  }

  async completeNote(
    id: NoteId,
    expectedRevision: number,
    completed: CompletedNote,
  ): Promise<void> {
    await Promise.resolve();
    const current = this.notes.get(id);
    if (!current) this.noteMissing(id);
    if (current.revision !== expectedRevision) {
      this.revisionConflict(`便利贴 ${id}`, expectedRevision, current.revision);
    }
    if (completed.id !== id || this.completedNotes.has(id)) {
      throw new DomainError('DUPLICATE_NOTE', `完成陈列中已经存在便利贴 ${id}。`);
    }
    this.notes.delete(id);
    this.completedNotes.set(id, clone(completed));
  }

  async deleteNote(id: NoteId, expectedRevision: number): Promise<void> {
    await Promise.resolve();
    const current = this.notes.get(id);
    if (!current) this.noteMissing(id);
    if (current.revision !== expectedRevision) {
      this.revisionConflict(`便利贴 ${id}`, expectedRevision, current.revision);
    }
    this.notes.delete(id);
  }

  async listCompletedNotes(): Promise<CompletedNote[]> {
    await Promise.resolve();
    return [...this.completedNotes.values()].map(clone);
  }

  inspect(): RepositoryState {
    return {
      wall: this.wall ? clone(this.wall) : null,
      notes: [...this.notes.values()].map(clone),
      completedNotes: [...this.completedNotes.values()].map(clone),
    };
  }

  private noteMissing(id: NoteId): never {
    throw new DomainError('NOTE_NOT_FOUND', `找不到便利贴 ${id}。`);
  }

  private revisionConflict(subject: string, expected: number, actual: number): never {
    throw new DomainError(
      'REVISION_CONFLICT',
      `${subject}版本冲突：预期 ${expected}，实际 ${actual}。`,
    );
  }
}
