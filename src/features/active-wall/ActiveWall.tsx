import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Archive,
  Brush,
  Check,
  Feather,
  MousePointer2,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  NOTE_DIMENSIONS,
  clampNotePosition,
  type Bounds,
  type DrawingScene,
  type Note,
  type Point,
} from '../../domain';
import { hideCurrentWindow, showQuickCapture } from '../../adapters/desktop';
import { isDesktopRuntime } from '../../adapters/persistence';
import { useSongtie } from '../../app/songtie-context';
import { SceneEditor, SceneRenderer } from '../../ui/drawing';
import { NoteInspector } from '../note-inspector/NoteInspector';
import { NoteCard } from './NoteCard';

type ActiveWallProps = { onOpenCompleted: () => void };
type WallMode = 'arrange' | 'draw';
type Rect = { x: number; y: number; width: number; height: number };
type DragState = {
  note: Note;
  offset: Point;
  current: Point;
  startClient: Point;
  moved: boolean;
};
type ExitGhost = { note: Note; position: Point; kind: 'complete' | 'delete' };
type SuppressedClick = { noteId: string };

const WALL_BACKGROUNDS = ['#f5f0e6', '#e8e1d1', '#e7eee3', '#dfe8e8', '#303734'];
const EXIT_INSET = 24;
const EXIT_WIDTH = 132;
const EXIT_HEIGHT = 104;
const EXIT_BOTTOM = 22;

function logicalPoint(event: ReactPointerEvent, element: HTMLElement, bounds: Bounds): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * bounds.width,
    y: ((event.clientY - rect.top) / rect.height) * bounds.height,
  };
}

function isInExit(event: ReactPointerEvent, wall: HTMLElement): 'complete' | 'delete' | null {
  const rect = wall.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const targetTop = rect.height - EXIT_BOTTOM - EXIT_HEIGHT;
  const targetBottom = rect.height - EXIT_BOTTOM;
  if (y < targetTop || y > targetBottom) return null;
  if (x >= EXIT_INSET && x <= EXIT_INSET + EXIT_WIDTH) return 'delete';
  if (x >= rect.width - EXIT_INSET - EXIT_WIDTH && x <= rect.width - EXIT_INSET) {
    return 'complete';
  }
  return null;
}

export function ActiveWall({ onOpenCompleted }: ActiveWallProps) {
  const {
    snapshot,
    error,
    clearError,
    createWallNote,
    moveNote,
    saveWall,
    completeNote,
    deleteNote,
  } = useSongtie();
  const wallRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<WallMode>('arrange');
  const [wallScene, setWallScene] = useState<DrawingScene | null>(snapshot?.wall.scene ?? null);
  const wallSceneRef = useRef<DrawingScene | null>(wallScene);
  const wallDirtyRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressedClickRef = useRef<SuppressedClick | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverExit, setHoverExit] = useState<'complete' | 'delete' | null>(null);
  const [inspector, setInspector] = useState<{ id: string; origin: Rect } | null>(null);
  const [exitGhost, setExitGhost] = useState<ExitGhost | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inspector) void hideCurrentWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspector]);

  useEffect(() => {
    wallSceneRef.current = wallScene;
  }, [wallScene]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen('flush-request', () => {
      const draft = wallSceneRef.current;
      if (!disposed && wallDirtyRef.current && draft) {
        void saveWall(draft).catch(() => undefined);
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [saveWall]);

  const bounds = snapshot?.wall.bounds ?? null;

  const suppressNextPointerClick = useCallback((noteId: string) => {
    const marker = { noteId };
    suppressedClickRef.current = marker;
    window.setTimeout(() => {
      if (suppressedClickRef.current === marker) suppressedClickRef.current = null;
    }, 0);
  }, []);

  const openNote = useCallback((event: ReactMouseEvent<HTMLButtonElement>, note: Note) => {
    const suppressed = suppressedClickRef.current;
    if (event.detail > 0 && suppressed?.noteId === note.id) {
      suppressedClickRef.current = null;
      event.preventDefault();
      return;
    }
    if (event.detail === 0) suppressedClickRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    setInspector({
      id: note.id,
      origin: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }, []);

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => {
      if (mode !== 'arrange' || !wallRef.current || !bounds) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const pointer = logicalPoint(event, wallRef.current, bounds);
      const next: DragState = {
        note,
        offset: { x: pointer.x - note.position.x, y: pointer.y - note.position.y },
        current: { x: note.position.x, y: note.position.y },
        startClient: { x: event.clientX, y: event.clientY },
        moved: false,
      };
      dragRef.current = next;
      setDrag(next);
    },
    [bounds, mode],
  );

  const continueDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => {
      const active = dragRef.current;
      if (!active || active.note.id !== note.id || !wallRef.current || !bounds) return;
      const pointer = logicalPoint(event, wallRef.current, bounds);
      const nextPosition = clampNotePosition(
        { x: pointer.x - active.offset.x, y: pointer.y - active.offset.y },
        note.size,
        bounds,
      );
      const distance = Math.hypot(
        event.clientX - active.startClient.x,
        event.clientY - active.startClient.y,
      );
      const next: DragState = {
        ...active,
        current: nextPosition,
        moved: active.moved || distance > 5,
      };
      dragRef.current = next;
      setDrag(next);
      setHoverExit(isInExit(event, wallRef.current));
    },
    [bounds],
  );

  const runExit = useCallback(
    async (note: Note, position: Point, kind: 'complete' | 'delete') => {
      if (kind === 'complete') await completeNote(note.id);
      else await deleteNote(note.id);
      setInspector(null);
      setExitGhost({ note, position, kind });
      window.setTimeout(() => setExitGhost(null), kind === 'complete' ? 1050 : 760);
    },
    [completeNote, deleteNote],
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => {
      const finished = dragRef.current;
      if (!finished || finished.note.id !== note.id) return;
      dragRef.current = null;
      setDrag(null);
      setHoverExit(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (!finished.moved) return;
      suppressNextPointerClick(note.id);
      const exit = wallRef.current ? isInExit(event, wallRef.current) : null;
      if (exit) {
        void runExit(note, finished.current, exit).catch(() => undefined);
        return;
      }
      void moveNote(note.id, finished.current).catch(() => undefined);
    },
    [moveNote, runExit, suppressNextPointerClick],
  );

  const cancelDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => {
      const active = dragRef.current;
      if (!active || active.note.id !== note.id) return;
      dragRef.current = null;
      setDrag(null);
      setHoverExit(null);
      suppressNextPointerClick(note.id);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [suppressNextPointerClick],
  );

  if (!snapshot || !wallScene || !bounds) return null;
  const selected = inspector
    ? (snapshot.notes.find((note) => note.id === inspector.id) ?? null)
    : null;

  const addNote = async () => {
    const note = await createWallNote();
    const dimensions = NOTE_DIMENSIONS[note.size];
    setInspector({
      id: note.id,
      origin: {
        x: note.position.x,
        y: note.position.y,
        width: dimensions.width,
        height: dimensions.height,
      },
    });
  };

  const updateWallBackground = (backgroundColor: string) => {
    const next = { ...wallScene, backgroundColor };
    wallSceneRef.current = next;
    wallDirtyRef.current = true;
    setWallScene(next);
    void saveWall(next)
      .then(() => {
        if (wallSceneRef.current === next) wallDirtyRef.current = false;
      })
      .catch(() => undefined);
  };

  const changeWallScene = (next: DrawingScene) => {
    wallSceneRef.current = next;
    wallDirtyRef.current = true;
    setWallScene(next);
  };

  const persistWallScene = (next: DrawingScene) => {
    wallSceneRef.current = next;
    void saveWall(next)
      .then(() => {
        if (wallSceneRef.current === next) wallDirtyRef.current = false;
      })
      .catch(() => undefined);
  };

  return (
    <main className={`active-wall active-wall--${mode}`} ref={wallRef}>
      <div className="wall-coordinate-layer" style={{ width: bounds.width, height: bounds.height }}>
        {mode === 'draw' ? (
          <SceneEditor
            className="wall-drawing"
            scene={wallScene}
            width={bounds.width}
            height={bounds.height}
            onChange={changeWallScene}
            onPointerUp={persistWallScene}
            ariaLabel="墙面涂鸦"
            initialTool="pen"
          />
        ) : (
          <SceneRenderer
            className="wall-drawing"
            scene={wallScene}
            width={bounds.width}
            height={bounds.height}
            ariaLabel="墙面涂鸦"
          />
        )}

        {snapshot.notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            inert={mode === 'draw'}
            dragging={drag?.note.id === note.id}
            position={drag?.note.id === note.id ? drag.current : note.position}
            onClick={openNote}
            onPointerDown={beginDrag}
            onPointerMove={continueDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
          />
        ))}

        {exitGhost && (
          <div
            className={`exit-ghost exit-ghost--${exitGhost.kind}`}
            style={{
              left: exitGhost.position.x,
              top: exitGhost.position.y,
              width: NOTE_DIMENSIONS[exitGhost.note.size].width,
              height: NOTE_DIMENSIONS[exitGhost.note.size].height,
            }}
            aria-hidden="true"
          >
            <SceneRenderer
              scene={exitGhost.note.scene}
              width={NOTE_DIMENSIONS[exitGhost.note.size].width}
              height={NOTE_DIMENSIONS[exitGhost.note.size].height}
            />
            {exitGhost.kind === 'complete' && <span className="completion-stamp">完成！</span>}
          </div>
        )}
      </div>

      <header className="wall-toolbar">
        <div className="wall-brand" title="把想法贴下，让脑子松开">
          <Feather size={18} />
          <strong>松贴</strong>
        </div>
        <div className="mode-switch" aria-label="墙面模式">
          <button
            type="button"
            className={mode === 'arrange' ? 'is-active' : ''}
            onClick={() => setMode('arrange')}
          >
            <MousePointer2 size={16} /> 摆放
          </button>
          <button
            type="button"
            className={mode === 'draw' ? 'is-active' : ''}
            onClick={() => setMode('draw')}
          >
            <Brush size={16} /> 涂写
          </button>
        </div>
        {mode === 'draw' && (
          <div className="wall-backgrounds" aria-label="墙面背景">
            {WALL_BACKGROUNDS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`选择墙面颜色 ${color}`}
                className={wallScene.backgroundColor === color ? 'is-active' : ''}
                style={{ background: color }}
                onClick={() => updateWallBackground(color)}
              />
            ))}
          </div>
        )}
        <span className="toolbar-spacer" />
        <button type="button" className="toolbar-button" onClick={() => void showQuickCapture()}>
          <StickyNote size={16} /> 随手贴
        </button>
        <button type="button" className="toolbar-button" onClick={() => void addNote()}>
          <Plus size={17} /> 新纸片
        </button>
        <button type="button" className="toolbar-button" onClick={onOpenCompleted}>
          <Archive size={16} /> 完成陈列
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="收起墙面"
          onClick={() => void hideCurrentWindow()}
        >
          <X size={18} />
        </button>
      </header>

      {drag && (
        <div className="note-exits" aria-hidden="true">
          <div
            className={`note-exit note-exit--delete ${hoverExit === 'delete' ? 'is-hovered' : ''}`}
          >
            <Trash2 size={30} />
            <span>丢掉</span>
          </div>
          <div
            className={`note-exit note-exit--complete ${hoverExit === 'complete' ? 'is-hovered' : ''}`}
          >
            <Check size={32} />
            <span>完成</span>
          </div>
        </div>
      )}

      {selected && inspector && (
        <NoteInspector
          key={`${selected.id}:${selected.size}`}
          note={selected}
          origin={inspector.origin}
          onClose={() => setInspector(null)}
          onComplete={() => runExit(selected, selected.position, 'complete')}
          onDelete={() => runExit(selected, selected.position, 'delete')}
        />
      )}

      {error && (
        <button type="button" className="save-error" role="alert" onClick={clearError}>
          {error}
          <X size={15} />
        </button>
      )}
    </main>
  );
}
