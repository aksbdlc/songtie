import type { SongtieRepository } from '../../application';
import type { CompletedNote, Note, NoteId, Wall } from '../../domain';
import { InMemorySongtieRepository } from '../../test-support/in-memory-songtie-repository';

const STORAGE_KEY = 'songtie.browser-state.v1';

type StoredState = {
  wall: Wall | null;
  notes: Note[];
  completedNotes: CompletedNote[];
};

function loadStoredState(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { wall: null, notes: [], completedNotes: [] };
    const value = JSON.parse(raw) as StoredState;
    return {
      wall: value.wall ?? null,
      notes: Array.isArray(value.notes) ? value.notes : [],
      completedNotes: Array.isArray(value.completedNotes) ? value.completedNotes : [],
    };
  } catch {
    return { wall: null, notes: [], completedNotes: [] };
  }
}

/** Browser fallback used by component tests and the install-free product preview. */
export class BrowserSongtieRepository implements SongtieRepository {
  private readonly inner: InMemorySongtieRepository;

  constructor() {
    const stored = loadStoredState();
    this.inner = new InMemorySongtieRepository({
      wall: stored.wall ?? undefined,
      notes: stored.notes,
      completedNotes: stored.completedNotes,
    });
  }

  getWall(): Promise<Wall | null> {
    return this.inner.getWall();
  }

  async initializeWall(wall: Wall): Promise<void> {
    await this.inner.initializeWall(wall);
    this.persist();
  }

  async updateWall(wall: Wall, expectedRevision: number): Promise<void> {
    await this.inner.updateWall(wall, expectedRevision);
    this.persist();
  }

  listNotes(): Promise<Note[]> {
    return this.inner.listNotes();
  }

  getNote(id: NoteId): Promise<Note | null> {
    return this.inner.getNote(id);
  }

  async createNote(note: Note): Promise<void> {
    await this.inner.createNote(note);
    this.persist();
  }

  async updateNote(note: Note, expectedRevision: number): Promise<void> {
    await this.inner.updateNote(note, expectedRevision);
    this.persist();
  }

  async completeNote(
    id: NoteId,
    expectedRevision: number,
    completed: CompletedNote,
  ): Promise<void> {
    await this.inner.completeNote(id, expectedRevision, completed);
    this.persist();
  }

  async deleteNote(id: NoteId, expectedRevision: number): Promise<void> {
    await this.inner.deleteNote(id, expectedRevision);
    this.persist();
  }

  listCompletedNotes(): Promise<CompletedNote[]> {
    return this.inner.listCompletedNotes();
  }

  private persist(): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.inner.inspect()));
  }
}
