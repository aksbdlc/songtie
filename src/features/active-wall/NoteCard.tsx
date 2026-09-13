import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CalendarDays } from 'lucide-react';
import { NOTE_DIMENSIONS, type Note, type Point } from '../../domain';
import { SceneRenderer } from '../../ui/drawing';

export type NoteCardProps = {
  note: Note;
  position?: Point;
  dragging?: boolean;
  inert?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>, note: Note) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>, note: Note) => void;
};

function paperTilt(id: string): number {
  let sum = 0;
  for (const character of id) sum = (sum + character.charCodeAt(0)) % 17;
  return (sum - 8) / 8;
}

function passiveDateLabel(value: string): string {
  return value.replace('T', ' ');
}

function NoteCardComponent({
  note,
  position = note.position,
  dragging = false,
  inert = false,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: NoteCardProps) {
  const dimensions = NOTE_DIMENSIONS[note.size];
  return (
    <button
      type="button"
      className={`note-card note-card--${note.size.toLowerCase()} ${dragging ? 'is-dragging' : ''}`}
      aria-label="打开便利贴"
      tabIndex={inert ? -1 : 0}
      style={
        {
          left: position.x,
          top: position.y,
          width: dimensions.width,
          height: dimensions.height,
          zIndex: dragging ? 10000 : note.position.z + 10,
          '--paper-tilt': `${paperTilt(note.id)}deg`,
          pointerEvents: inert ? 'none' : 'auto',
        } as React.CSSProperties
      }
      onClick={(event) => onClick?.(event, note)}
      onPointerDown={(event) => onPointerDown?.(event, note)}
      onPointerMove={(event) => onPointerMove?.(event, note)}
      onPointerUp={(event) => onPointerUp?.(event, note)}
      onPointerCancel={(event) => onPointerCancel?.(event, note)}
    >
      <SceneRenderer
        scene={note.scene}
        width={dimensions.width}
        height={dimensions.height}
        ariaLabel="便利贴内容"
      />
      {note.passiveDate && (
        <span className="note-card__date">
          <CalendarDays size={12} />
          {passiveDateLabel(note.passiveDate)}
        </span>
      )}
      <span className="note-card__lift" aria-hidden="true" />
    </button>
  );
}

export const NoteCard = memo(NoteCardComponent);
NoteCard.displayName = 'NoteCard';
