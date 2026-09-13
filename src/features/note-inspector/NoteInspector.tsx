import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { CalendarClock, Check, Maximize2, Trash2, X } from 'lucide-react';
import {
  NOTE_DIMENSIONS,
  sceneFitsBounds,
  type DrawingScene,
  type Note,
  type NoteSize,
} from '../../domain';
import { isDesktopRuntime } from '../../adapters/persistence';
import { useSongtie } from '../../app/songtie-context';
import { SceneEditor } from '../../ui/drawing';

type OriginRect = { x: number; y: number; width: number; height: number };

export type NoteInspectorProps = {
  note: Note;
  origin: OriginRect;
  onClose: () => void;
  onComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
};

const PAPER_COLORS = ['#fff2a8', '#ffd9c8', '#dcefc8', '#cfe7ee', '#e5dcf2'];
const SIZE_LABELS: Record<NoteSize, string> = { S: '小', M: '中', L: '大' };

export function NoteInspector({ note, origin, onClose, onComplete, onDelete }: NoteInspectorProps) {
  const { saveNote, saving } = useSongtie();
  const [scene, setScene] = useState(note.scene);
  const [date, setDate] = useState(note.passiveDate ?? '');
  const [busyExit, setBusyExit] = useState<'complete' | 'delete' | null>(null);
  const draftRef = useRef({ scene: note.scene, date: note.passiveDate ?? '', size: note.size });
  const draftDirtyRef = useRef(false);
  const saveNoteRef = useRef(saveNote);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dimensions = NOTE_DIMENSIONS[note.size];
  const scale = useMemo(() => {
    const horizontal = (window.innerWidth - 120) / dimensions.width;
    const vertical = (window.innerHeight - 210) / dimensions.height;
    return Math.max(1.5, Math.min(1.8, horizontal, vertical));
  }, [dimensions.height, dimensions.width]);
  const targetWidth = dimensions.width * scale;
  const targetHeight = dimensions.height * scale;
  const fromX = origin.x + origin.width / 2 - window.innerWidth / 2;
  const fromY = origin.y + origin.height / 2 - window.innerHeight / 2;
  const fromScale = Math.min(origin.width / targetWidth, origin.height / targetHeight);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>('button:not([disabled]), input, textarea')
        ?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    saveNoteRef.current = saveNote;
  }, [saveNote]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen('flush-request', () => {
      if (disposed || !draftDirtyRef.current) return;
      const draft = draftRef.current;
      void saveNoteRef
        .current({
          id: note.id,
          scene: draft.scene,
          size: draft.size,
          passiveDate: draft.date || null,
        })
        .catch(() => undefined);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [note.id]);

  const persist = async (nextScene = scene, nextDate = date, size: NoteSize = note.size) => {
    const draft = { scene: nextScene, date: nextDate, size };
    draftRef.current = draft;
    draftDirtyRef.current = true;
    await saveNote({
      id: note.id,
      scene: nextScene,
      size,
      passiveDate: nextDate || null,
    });
    if (draftRef.current === draft) draftDirtyRef.current = false;
  };

  const changeScene = (next: DrawingScene) => {
    draftRef.current = { ...draftRef.current, scene: next };
    draftDirtyRef.current = true;
    setScene(next);
  };

  const changePaperColor = (backgroundColor: string) => {
    const next: DrawingScene = { ...scene, backgroundColor };
    changeScene(next);
    void persist(next).catch(() => undefined);
  };

  const flushDraft = async () => {
    if (!draftDirtyRef.current) return;
    const draft = draftRef.current;
    await persist(draft.scene, draft.date, draft.size);
  };

  const closeInspector = async () => {
    await flushDraft();
    onClose();
  };

  const exit = async (kind: 'complete' | 'delete') => {
    setBusyExit(kind);
    try {
      await flushDraft();
      if (kind === 'complete') await onComplete();
      else await onDelete();
    } finally {
      setBusyExit(null);
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busyExit) {
      event.preventDefault();
      void closeInspector().catch(() => undefined);
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      className="inspector-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="检视便利贴"
      onKeyDown={handleDialogKeyDown}
    >
      <button
        className="inspector-dismiss"
        type="button"
        aria-label="关闭检视"
        onClick={() => void closeInspector().catch(() => undefined)}
      />
      <section
        className={`note-inspector ${busyExit ? `is-${busyExit}` : ''}`}
        style={
          {
            width: targetWidth,
            height: targetHeight,
            '--from-x': `${fromX}px`,
            '--from-y': `${fromY}px`,
            '--from-scale': fromScale,
          } as React.CSSProperties
        }
      >
        <SceneEditor
          className="note-inspector__editor"
          scene={scene}
          width={dimensions.width}
          height={dimensions.height}
          onChange={changeScene}
          onPointerUp={(next) => void persist(next).catch(() => undefined)}
          ariaLabel="便利贴自由编辑"
        />
      </section>

      <div className="inspector-controls">
        <div className="inspector-control-group" aria-label="纸片大小">
          <Maximize2 size={15} />
          {(Object.keys(SIZE_LABELS) as NoteSize[]).map((size) => (
            <button
              type="button"
              key={size}
              className={note.size === size ? 'is-active' : ''}
              disabled={!sceneFitsBounds(scene, NOTE_DIMENSIONS[size])}
              title={
                sceneFitsBounds(scene, NOTE_DIMENSIONS[size])
                  ? `换成${SIZE_LABELS[size]}纸片`
                  : '当前内容放不进这张纸片'
              }
              onClick={() => void persist(scene, date, size).catch(() => undefined)}
            >
              {SIZE_LABELS[size]}
            </button>
          ))}
        </div>
        <div className="inspector-control-group paper-colors" aria-label="纸张颜色">
          {PAPER_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              aria-label={`选择纸张颜色 ${color}`}
              className={scene.backgroundColor === color ? 'is-active' : ''}
              style={{ background: color }}
              onClick={() => changePaperColor(color)}
            />
          ))}
        </div>
        <label className="passive-date-control">
          <CalendarClock size={16} />
          <span>写个时间</span>
          <input
            type="datetime-local"
            value={date}
            onChange={(event) => {
              const nextDate = event.target.value;
              draftRef.current = { ...draftRef.current, date: nextDate };
              draftDirtyRef.current = true;
              setDate(nextDate);
            }}
            onBlur={() => void persist(scene, date).catch(() => undefined)}
          />
        </label>
        <span className="inspector-separator" />
        <button
          type="button"
          className="soft-action soft-action--complete"
          disabled={saving || !!busyExit}
          onClick={() => void exit('complete')}
        >
          <Check size={17} /> 完成
        </button>
        <button
          type="button"
          className="soft-action soft-action--delete"
          disabled={saving || !!busyExit}
          onClick={() => void exit('delete')}
        >
          <Trash2 size={16} /> 丢掉
        </button>
        <button
          type="button"
          className="icon-button icon-button--light"
          onClick={() => void closeInspector().catch(() => undefined)}
        >
          <X size={18} />
          <span className="sr-only">关闭</span>
        </button>
      </div>
    </div>
  );
}
