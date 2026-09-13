import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Award, Feather, X } from 'lucide-react';
import { NOTE_DIMENSIONS, type CompletedNote } from '../../domain';
import { hideCurrentWindow } from '../../adapters/desktop';
import { useSongtie } from '../../app/songtie-context';
import { SceneRenderer } from '../../ui/drawing';

type CompletionWallProps = { onBack: () => void };

function completedLabel(date: string): string {
  return `完成于 ${date.replaceAll('-', '/')}`;
}

function CompletedItem({ note, onOpen }: { note: CompletedNote; onOpen: () => void }) {
  const dimensions = NOTE_DIMENSIONS[note.size];
  const scale = note.size === 'L' ? 0.72 : note.size === 'M' ? 0.82 : 0.94;
  return (
    <button
      type="button"
      className="completed-item"
      style={{ width: dimensions.width * scale }}
      onClick={onOpen}
      aria-label={`${completedLabel(note.completedOn)}，打开查看`}
    >
      <div
        className="completed-item__paper"
        style={{ width: dimensions.width * scale, height: dimensions.height * scale }}
      >
        <SceneRenderer scene={note.scene} width={dimensions.width} height={dimensions.height} />
      </div>
      <span className="completed-item__label">
        <Award size={14} /> {completedLabel(note.completedOn)}
      </span>
    </button>
  );
}

function CompletedInspector({ note, onClose }: { note: CompletedNote; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dimensions = NOTE_DIMENSIONS[note.size];
  const scale = Math.max(
    1.5,
    Math.min(
      1.8,
      (window.innerWidth - 120) / dimensions.width,
      (window.innerHeight - 180) / dimensions.height,
    ),
  );

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
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
      className="completed-inspector"
      role="dialog"
      aria-modal="true"
      aria-label="查看完成便利贴"
      onKeyDown={handleDialogKeyDown}
    >
      <button type="button" className="inspector-dismiss" aria-label="关闭查看" onClick={onClose} />
      <div
        className="completed-inspector__paper"
        style={{ width: dimensions.width * scale, height: dimensions.height * scale }}
      >
        <SceneRenderer scene={note.scene} width={dimensions.width} height={dimensions.height} />
        <span className="completed-inspector__stamp">{completedLabel(note.completedOn)}</span>
      </div>
      <button type="button" className="icon-button icon-button--floating" onClick={onClose}>
        <X size={19} />
        <span className="sr-only">关闭</span>
      </button>
    </div>
  );
}

export function CompletionWall({ onBack }: CompletionWallProps) {
  const { snapshot } = useSongtie();
  const [selected, setSelected] = useState<CompletedNote | null>(null);
  const completed = [...(snapshot?.completedNotes ?? [])].sort(
    (left, right) =>
      right.completedOn.localeCompare(left.completedOn) ||
      right.completedOrder - left.completedOrder,
  );

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || selected) return;
      void hideCurrentWindow();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected]);

  return (
    <main className="completion-wall">
      <header className="completion-header">
        <button type="button" className="toolbar-button" onClick={onBack}>
          <ArrowLeft size={17} /> 回到当前墙
        </button>
        <div className="completion-title">
          <Feather size={19} />
          <div>
            <strong>做过的事，留在这里</strong>
            <span>不统计，也不催促</span>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="收起完成陈列"
          onClick={() => void hideCurrentWindow()}
        >
          <X size={18} />
        </button>
      </header>

      {completed.length === 0 ? (
        <section className="completion-empty">
          <Award size={42} strokeWidth={1.25} />
          <p>这里还很安静。</p>
          <span>以后做成了什么，它会自然地留在这里。</span>
        </section>
      ) : (
        <section className="completion-grid" aria-label="完成的便利贴">
          {completed.map((note) => (
            <CompletedItem key={note.id} note={note} onOpen={() => setSelected(note)} />
          ))}
        </section>
      )}

      {selected && <CompletedInspector note={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
