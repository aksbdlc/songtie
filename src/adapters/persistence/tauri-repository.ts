import { invoke } from '@tauri-apps/api/core';
import type { SongtieRepository } from '../../application';
import type { CompletedNote, Note, NoteId, Wall } from '../../domain';

export type TauriStatePayload = {
  wall: Wall | null;
  notes: Note[];
  completedNotes: CompletedNote[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class TauriSongtieRepository implements SongtieRepository {
  private state: TauriStatePayload | null = null;

  async refresh(): Promise<void> {
    this.state = await invoke<TauriStatePayload>('load_state');
  }

  acceptState(state: TauriStatePayload): void {
    this.state = clone(state);
  }

  async getWall(): Promise<Wall | null> {
    await this.ensureLoaded();
    const wall = this.requireState().wall;
    return wall ? clone(wall) : null;
  }

  async initializeWall(wall: Wall): Promise<void> {
    this.state = await invoke<TauriStatePayload>('initialize_wall', {
      input: { wall },
    });
  }

  async updateWall(wall: Wall, expectedRevision: number): Promise<void> {
    this.state = await invoke<TauriStatePayload>('save_wall', {
      input: { wall, expectedRevision },
    });
  }

  async listNotes(): Promise<Note[]> {
    await this.ensureLoaded();
    return clone(this.requireState().notes);
  }

  async getNote(id: NoteId): Promise<Note | null> {
    await this.ensureLoaded();
    const note = this.requireState().notes.find((candidate) => candidate.id === id);
    return note ? clone(note) : null;
  }

  async createNote(note: Note): Promise<void> {
    this.state = await invoke<TauriStatePayload>('create_note', {
      input: { note },
    });
  }

  async updateNote(note: Note, expectedRevision: number): Promise<void> {
    this.state = await invoke<TauriStatePayload>('save_note', {
      input: { note, expectedRevision },
    });
  }

  async completeNote(
    id: NoteId,
    _expectedRevision: number,
    completed: CompletedNote,
  ): Promise<void> {
    this.state = await invoke<TauriStatePayload>('complete_note', {
      input: { id, expectedRevision: _expectedRevision, completed },
    });
  }

  async deleteNote(id: NoteId, _expectedRevision: number): Promise<void> {
    this.state = await invoke<TauriStatePayload>('delete_note', {
      input: { id, expectedRevision: _expectedRevision },
    });
  }

  async listCompletedNotes(): Promise<CompletedNote[]> {
    await this.ensureLoaded();
    return clone(this.requireState().completedNotes);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state === null) await this.refresh();
  }

  private requireState(): TauriStatePayload {
    if (this.state === null) throw new Error('本地数据尚未加载。');
    return this.state;
  }
}
