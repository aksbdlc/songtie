import type { CompletedNote, Note, NoteId, Wall } from '../domain';

/**
 * Each method represents one persistence transaction. Implementations keep
 * lifecycle logging internal; the product has no deleted-note read/restore port.
 */
export interface SongtieRepository {
  getWall(): Promise<Wall | null>;
  initializeWall(wall: Wall): Promise<void>;
  updateWall(wall: Wall, expectedRevision: number): Promise<void>;

  listNotes(): Promise<Note[]>;
  getNote(id: NoteId): Promise<Note | null>;
  createNote(note: Note): Promise<void>;
  updateNote(note: Note, expectedRevision: number): Promise<void>;
  completeNote(id: NoteId, expectedRevision: number, completed: CompletedNote): Promise<void>;
  deleteNote(id: NoteId, expectedRevision: number): Promise<void>;

  listCompletedNotes(): Promise<CompletedNote[]>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  nextId(): string;
}
