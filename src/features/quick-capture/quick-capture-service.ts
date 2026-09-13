import { invoke } from '@tauri-apps/api/core';
import {
  DomainError,
  HANDWRITTEN_FONT,
  NOTE_DIMENSIONS,
  QUICK_TEXT_STYLE,
  classifyQuickText,
  createEmptyScene,
  createQuickTextScene,
  findAutomaticPosition,
  nextZIndex,
  type Bounds,
  type Note,
  type NotePosition,
  type NoteSize,
  type Wall,
} from '../../domain';
import { isDesktopRuntime } from '../../adapters/persistence';
import { BrowserSongtieRepository } from '../../adapters/persistence/browser-repository';

type QuickNotePlacement = {
  id: string;
  size: NoteSize;
  position: NotePosition;
};

type QuickStatePayload = {
  wallBounds: Bounds | null;
  notes: QuickNotePlacement[];
};

export type QuickCaptureAction = (text: string) => Promise<void>;

export function classifyQuickTextForDisplay(text: string): { size: NoteSize } {
  classifyQuickText(text);
  for (const size of ['S', 'M', 'L'] as const) {
    if (renderedTextFits(text, NOTE_DIMENSIONS[size])) return { size };
  }
  throw new DomainError('QUICK_TEXT_TOO_LONG', '这段文字放不进大号便利贴，请删减后再保存。');
}

function renderedTextFits(text: string, bounds: Bounds): boolean {
  const probe = document.createElement('div');
  Object.assign(probe.style, {
    position: 'fixed',
    top: '0',
    left: '-100000px',
    boxSizing: 'border-box',
    width: `${bounds.width - QUICK_TEXT_STYLE.padding * 2}px`,
    margin: '0',
    padding: '0',
    border: '0',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: HANDWRITTEN_FONT,
    fontSize: `${QUICK_TEXT_STYLE.fontSize}px`,
    fontWeight: '400',
    lineHeight: `${QUICK_TEXT_STYLE.lineHeight}px`,
  });
  probe.textContent = `${text.replace(/\r\n?/g, '\n')}\u200b`;
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height <= bounds.height - QUICK_TEXT_STYLE.padding * 2 + 0.5;
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function currentWallBounds(): Bounds {
  return {
    width: Math.max(window.screen?.width ?? 0, window.innerWidth, 390),
    height: Math.max(window.screen?.height ?? 0, window.innerHeight, 260),
  };
}

function initialWall(bounds: Bounds, now: string): Wall {
  return {
    id: 'active',
    bounds,
    scene: createEmptyScene('#f5f0e6'),
    revision: 1,
    updatedAt: now,
  };
}

function makeQuickNote(
  text: string,
  size: NoteSize,
  bounds: Bounds,
  notes: QuickNotePlacement[],
  now: string,
): Note {
  const id = randomId();
  return {
    id,
    size,
    position: {
      ...findAutomaticPosition(size, notes, bounds, id),
      z: nextZIndex(notes),
    },
    scene: createQuickTextScene(text, size, `${id}:text`),
    passiveDate: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function createNativeQuickCapture(): QuickCaptureAction {
  return async (text) => {
    const { size } = classifyQuickTextForDisplay(text);
    let state = await invoke<QuickStatePayload>('load_quick_state');
    const now = new Date().toISOString();

    if (state.wallBounds === null) {
      const wall = initialWall(currentWallBounds(), now);
      try {
        await invoke('initialize_wall', { input: { wall } });
      } catch {
        // The already-loaded main window may have initialized the one wall in
        // the same instant. Reading the lightweight state resolves that race.
      }
      state = await invoke<QuickStatePayload>('load_quick_state');
    }

    const bounds = state.wallBounds;
    if (bounds === null) throw new Error('当前墙还没有准备好，请再试一次。');
    const note = makeQuickNote(text, size, bounds, state.notes, now);
    await invoke('create_quick_note', { input: { note } });
  };
}

function createBrowserQuickCapture(): QuickCaptureAction {
  const repository = new BrowserSongtieRepository();
  return async (text) => {
    const now = new Date().toISOString();
    let wall = await repository.getWall();
    if (wall === null) {
      wall = initialWall(currentWallBounds(), now);
      await repository.initializeWall(wall);
    }
    const notes = await repository.listNotes();
    const { size } = classifyQuickTextForDisplay(text);
    await repository.createNote(makeQuickNote(text, size, wall.bounds, notes, now));
  };
}

export function createQuickCaptureAction(): QuickCaptureAction {
  return isDesktopRuntime() ? createNativeQuickCapture() : createBrowserQuickCapture();
}
