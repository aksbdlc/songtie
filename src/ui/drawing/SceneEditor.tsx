import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { constrainElement } from '../../domain/drawing';
import type { Bounds, Point } from '../../domain/model';
import type { DrawingElement, DrawingScene } from '../../domain/types';
import {
  clampPoint,
  elementBounds,
  findTopElement,
  isResizeHandleHit,
  moveElement,
  resizeElement,
} from './geometry';
import { SceneElementView } from './SceneElementView';
import './drawing.css';

export type DrawingTool =
  'select' | 'pen' | 'eraser' | 'text' | 'line' | 'arrow' | 'rectangle' | 'ellipse';

export type SceneEditorProps = {
  scene: DrawingScene;
  width: number;
  height: number;
  onChange: (scene: DrawingScene) => void;
  /** Called after a pointer gesture or text-editing session has finished. */
  onPointerUp?: (scene: DrawingScene) => void;
  className?: string;
  ariaLabel?: string;
  initialTool?: DrawingTool;
  initialColor?: string;
};

type Interaction =
  | {
      type: 'move';
      element: DrawingElement;
      pointer: Point;
    }
  | {
      type: 'resize';
      element: DrawingElement;
    }
  | {
      type: 'draw';
      id: string;
      tool: Exclude<DrawingTool, 'select' | 'eraser' | 'text'>;
      start: Point;
    }
  | { type: 'erase' };

const TOOL_LABELS: ReadonlyArray<[DrawingTool, string]> = [
  ['select', '选择'],
  ['pen', '画笔'],
  ['eraser', '橡皮'],
  ['text', '文字'],
  ['line', '直线'],
  ['arrow', '箭头'],
  ['rectangle', '方框'],
  ['ellipse', '圆形'],
];

const DEFAULT_STROKE_WIDTH = 2.4;

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `element-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function replaceElement(scene: DrawingScene, element: DrawingElement): DrawingScene {
  return {
    ...scene,
    elements: scene.elements.map((candidate) =>
      candidate.id === element.id ? element : candidate,
    ),
  };
}

function makeElement(
  tool: Exclude<DrawingTool, 'select' | 'eraser' | 'text'>,
  id: string,
  point: Point,
  color: string,
): DrawingElement {
  if (tool === 'pen') {
    return {
      id,
      type: 'path',
      points: [point],
      color,
      strokeWidth: DEFAULT_STROKE_WIDTH,
    };
  }
  if (tool === 'line' || tool === 'arrow') {
    return {
      id,
      type: tool,
      start: point,
      end: point,
      color,
      strokeWidth: DEFAULT_STROKE_WIDTH,
    };
  }
  return {
    id,
    type: tool,
    x: point.x,
    y: point.y,
    width: 1,
    height: 1,
    strokeColor: color,
    fillColor: 'transparent',
    strokeWidth: DEFAULT_STROKE_WIDTH,
  };
}

function updateDrawnElement(
  element: DrawingElement,
  tool: Exclude<DrawingTool, 'select' | 'eraser' | 'text'>,
  start: Point,
  pointer: Point,
  canvas: Bounds,
): DrawingElement {
  if (element.type === 'path' && tool === 'pen') {
    const previous = element.points[element.points.length - 1]!;
    if (Math.hypot(pointer.x - previous.x, pointer.y - previous.y) < 1.5) {
      return element;
    }
    return { ...element, points: [...element.points, pointer] };
  }
  if (
    (element.type === 'line' || element.type === 'arrow') &&
    (tool === 'line' || tool === 'arrow')
  ) {
    return { ...element, end: pointer };
  }
  if (
    (element.type === 'rectangle' || element.type === 'ellipse') &&
    (tool === 'rectangle' || tool === 'ellipse')
  ) {
    return constrainElement(
      {
        ...element,
        x: Math.min(start.x, pointer.x),
        y: Math.min(start.y, pointer.y),
        width: Math.abs(pointer.x - start.x),
        height: Math.abs(pointer.y - start.y),
      },
      canvas,
    );
  }
  return element;
}

function finalizeDrawnElement(element: DrawingElement, canvas: Bounds): DrawingElement {
  if (element.type === 'rectangle' || element.type === 'ellipse') {
    return constrainElement(
      {
        ...element,
        width: Math.max(element.width, 24),
        height: Math.max(element.height, 24),
      },
      canvas,
    );
  }
  if (
    (element.type === 'line' || element.type === 'arrow') &&
    Math.hypot(element.end.x - element.start.x, element.end.y - element.start.y) < 4
  ) {
    return constrainElement(
      {
        ...element,
        end: clampPoint({ x: element.start.x + 56, y: element.start.y + 36 }, canvas),
      },
      canvas,
    );
  }
  return constrainElement(element, canvas);
}

function pointerInSvg(event: ReactPointerEvent<SVGSVGElement>, canvas: Bounds): Point {
  const svg = event.currentTarget;
  const matrix = svg.getScreenCTM();
  if (matrix) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return clampPoint({ x: transformed.x, y: transformed.y }, canvas);
  }
  const rect = svg.getBoundingClientRect();
  return clampPoint(
    {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    },
    canvas,
  );
}

export function SceneEditor({
  scene,
  width,
  height,
  onChange,
  onPointerUp,
  className = '',
  ariaLabel = '绘图编辑器',
  initialTool = 'select',
  initialColor = '#37322b',
}: SceneEditorProps) {
  const canvas = { width, height };
  const [tool, setTool] = useState<DrawingTool>(initialTool);
  const [color, setColor] = useState(initialColor);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textLimitReached, setTextLimitReached] = useState(false);
  const interaction = useRef<Interaction | null>(null);
  const currentScene = useRef(scene);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    currentScene.current = scene;
  }, [scene]);

  useEffect(() => {
    if (editingTextId) textareaRef.current?.focus();
  }, [editingTextId]);

  const emit = (next: DrawingScene) => {
    currentScene.current = next;
    onChange(next);
  };

  const eraseAt = (point: Point) => {
    const hit = findTopElement(currentScene.current.elements, point);
    if (!hit) return;
    if (selectedId === hit.id) setSelectedId(null);
    emit({
      ...currentScene.current,
      elements: currentScene.current.elements.filter((element) => element.id !== hit.id),
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || editingTextId) return;
    const point = pointerInSvg(event, canvas);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'eraser') {
      interaction.current = { type: 'erase' };
      eraseAt(point);
      return;
    }

    if (tool === 'text') {
      const id = newId();
      const textElement: DrawingElement = constrainElement(
        {
          id,
          type: 'text',
          x: point.x,
          y: point.y,
          width: Math.min(220, width),
          height: Math.min(112, height),
          text: '',
          fontSize: 22,
          lineHeight: 28,
          color,
        },
        canvas,
      );
      emit({
        ...currentScene.current,
        elements: [...currentScene.current.elements, textElement],
      });
      setSelectedId(id);
      setEditingTextId(id);
      setTextLimitReached(false);
      setTool('select');
      return;
    }

    if (tool === 'select') {
      const selected = selectedId
        ? currentScene.current.elements.find((element) => element.id === selectedId)
        : undefined;
      if (selected && isResizeHandleHit(selected, point)) {
        interaction.current = { type: 'resize', element: selected };
        return;
      }
      const hit = findTopElement(currentScene.current.elements, point);
      setSelectedId(hit?.id ?? null);
      if (hit) {
        interaction.current = { type: 'move', element: hit, pointer: point };
      }
      return;
    }

    const id = newId();
    const element = makeElement(tool, id, point, color);
    emit({
      ...currentScene.current,
      elements: [...currentScene.current.elements, element],
    });
    setSelectedId(id);
    interaction.current = { type: 'draw', id, tool, start: point };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = interaction.current;
    if (!active) return;
    const point = pointerInSvg(event, canvas);

    if (active.type === 'erase') {
      eraseAt(point);
      return;
    }

    if (active.type === 'move') {
      const next = moveElement(
        active.element,
        point.x - active.pointer.x,
        point.y - active.pointer.y,
        canvas,
      );
      emit(replaceElement(currentScene.current, next));
      return;
    }

    if (active.type === 'resize') {
      emit(replaceElement(currentScene.current, resizeElement(active.element, point, canvas)));
      return;
    }

    const element = currentScene.current.elements.find((candidate) => candidate.id === active.id);
    if (!element) return;
    const updated = updateDrawnElement(element, active.tool, active.start, point, canvas);
    if (updated !== element) emit(replaceElement(currentScene.current, updated));
  };

  const finishInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!interaction.current) return;
    const finished = interaction.current;
    interaction.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (finished.type === 'draw') {
      const element = currentScene.current.elements.find(
        (candidate) => candidate.id === finished.id,
      );
      if (element) {
        const finalized = finalizeDrawnElement(element, canvas);
        emit(replaceElement(currentScene.current, finalized));
      }
    }
    if (finished.type === 'draw' && finished.tool !== 'pen') {
      setTool('select');
    }
    onPointerUp?.(currentScene.current);
  };

  const handleDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (tool !== 'select') return;
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    let point: Point;
    if (matrix) {
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = event.clientX;
      svgPoint.y = event.clientY;
      const transformed = svgPoint.matrixTransform(matrix.inverse());
      point = clampPoint({ x: transformed.x, y: transformed.y }, canvas);
    } else {
      const rect = svg.getBoundingClientRect();
      point = clampPoint(
        {
          x: ((event.clientX - rect.left) / rect.width) * width,
          y: ((event.clientY - rect.top) / rect.height) * height,
        },
        canvas,
      );
    }
    const hit = findTopElement(currentScene.current.elements, point);
    if (hit?.type === 'text') {
      setSelectedId(hit.id);
      setEditingTextId(hit.id);
      setTextLimitReached(false);
    }
  };

  const editingElement = editingTextId
    ? scene.elements.find(
        (element): element is Extract<DrawingElement, { type: 'text' }> =>
          element.id === editingTextId && element.type === 'text',
      )
    : undefined;
  const selected = selectedId
    ? scene.elements.find((element) => element.id === selectedId)
    : undefined;
  const selectedBounds = selected ? elementBounds(selected) : undefined;

  const finishTextEditing = () => {
    if (!editingTextId) return;
    let next = currentScene.current;
    const text = next.elements.find(
      (element) => element.id === editingTextId && element.type === 'text',
    );
    if (text?.type === 'text' && !text.text.trim()) {
      next = {
        ...next,
        elements: next.elements.filter((element) => element.id !== editingTextId),
      };
      emit(next);
      setSelectedId(null);
    }
    setEditingTextId(null);
    setTextLimitReached(false);
    onPointerUp?.(next);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (editingTextId || !selectedId) return;
    const selectedElement = currentScene.current.elements.find(
      (element) => element.id === selectedId,
    );
    if (!selectedElement) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const next = {
        ...currentScene.current,
        elements: currentScene.current.elements.filter((element) => element.id !== selectedId),
      };
      emit(next);
      setSelectedId(null);
      onPointerUp?.(next);
      return;
    }

    if (event.key === 'Enter' && selectedElement.type === 'text') {
      event.preventDefault();
      setEditingTextId(selectedElement.id);
      return;
    }

    const direction: Partial<Record<string, Point>> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const delta = direction[event.key];
    if (!delta) return;
    event.preventDefault();
    const distance = event.shiftKey ? 10 : 1;
    const moved = moveElement(selectedElement, delta.x * distance, delta.y * distance, canvas);
    const next = replaceElement(currentScene.current, moved);
    emit(next);
    onPointerUp?.(next);
  };

  return (
    <div className={`songtie-scene-editor ${className}`.trim()}>
      <div className="songtie-drawing-toolbar" role="toolbar" aria-label="绘图工具">
        {TOOL_LABELS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tool === value ? 'is-active' : ''}
            aria-pressed={tool === value}
            onClick={() => {
              setEditingTextId(null);
              setTextLimitReached(false);
              setTool(value);
            }}
          >
            {label}
          </button>
        ))}
        <label className="songtie-color-control" title="绘图颜色">
          <span>颜色</span>
          <input
            aria-label="绘图颜色"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
      </div>

      <svg
        className="songtie-scene-editor__canvas"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="application"
        tabIndex={0}
        aria-label={ariaLabel}
        style={{ background: scene.backgroundColor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishInteraction}
        onPointerCancel={finishInteraction}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      >
        {scene.elements.map((element) =>
          element.id === editingTextId ? null : (
            <SceneElementView key={element.id} element={element} />
          ),
        )}

        {selectedBounds && !editingTextId && (
          <g className="songtie-selection" pointerEvents="none">
            <rect
              x={selectedBounds.x - 4}
              y={selectedBounds.y - 4}
              width={selectedBounds.width + 8}
              height={selectedBounds.height + 8}
              fill="none"
              stroke="#5278d8"
              strokeWidth={1.5}
              strokeDasharray="7 5"
            />
            <rect
              x={selectedBounds.x + selectedBounds.width - 6}
              y={selectedBounds.y + selectedBounds.height - 6}
              width={12}
              height={12}
              rx={2}
              fill="#fff"
              stroke="#5278d8"
              strokeWidth={2}
            />
          </g>
        )}

        {editingElement && (
          <foreignObject
            x={editingElement.x}
            y={editingElement.y}
            width={editingElement.width}
            height={editingElement.height}
            className="songtie-text-editor"
          >
            <textarea
              ref={textareaRef}
              aria-label="编辑文字"
              value={editingElement.text}
              style={{
                color: editingElement.color,
                fontSize: `${editingElement.fontSize}px`,
                lineHeight: `${editingElement.lineHeight}px`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const nextText = event.currentTarget.value;
                const availableHeight = height - editingElement.y;
                const contentHeight = event.currentTarget.scrollHeight;
                if (contentHeight > availableHeight) {
                  event.currentTarget.value = editingElement.text;
                  setTextLimitReached(true);
                  return;
                }
                setTextLimitReached(false);
                const nextHeight =
                  contentHeight > event.currentTarget.clientHeight
                    ? Math.min(availableHeight, contentHeight + 2)
                    : editingElement.height;
                emit(
                  replaceElement(currentScene.current, {
                    ...editingElement,
                    height: nextHeight,
                    text: nextText,
                  }),
                );
              }}
              onBlur={finishTextEditing}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || (event.ctrlKey && event.key === 'Enter')) {
                  event.currentTarget.blur();
                }
              }}
            />
          </foreignObject>
        )}
      </svg>
      {textLimitReached && (
        <div className="songtie-text-limit" role="status">
          这块文字框放不下更多内容。可以先结束编辑、放大文字框，或另写一块。
        </div>
      )}
    </div>
  );
}
