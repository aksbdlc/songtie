import { DomainError } from './errors';
import { assertBounds, type Bounds, type Point } from './model';

type ElementBase = {
  id: string;
  opacity?: number;
};

export type TextElement = ElementBase & {
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  lineHeight: number;
  color: string;
};

export type PathElement = ElementBase & {
  type: 'path';
  points: Point[];
  color: string;
  strokeWidth: number;
};

export type LineElement = ElementBase & {
  type: 'line';
  start: Point;
  end: Point;
  color: string;
  strokeWidth: number;
};

export type ArrowElement = ElementBase & {
  type: 'arrow';
  start: Point;
  end: Point;
  color: string;
  strokeWidth: number;
};

type BoxElementBase = ElementBase & {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
};

export type RectangleElement = BoxElementBase & {
  type: 'rectangle';
};

export type EllipseElement = BoxElementBase & {
  type: 'ellipse';
};

export type DrawingElement =
  TextElement | PathElement | LineElement | ArrowElement | RectangleElement | EllipseElement;

export type DrawingScene = {
  schemaVersion: 1;
  engine: 'songtie-svg';
  backgroundColor: string;
  elements: DrawingElement[];
};

type ElementBounds = Bounds & Point;

const DEFAULT_BACKGROUND = 'transparent';

export function createEmptyScene(backgroundColor = DEFAULT_BACKGROUND): DrawingScene {
  return {
    schemaVersion: 1,
    engine: 'songtie-svg',
    backgroundColor,
    elements: [],
  };
}

function invalidScene(message: string): never {
  throw new DomainError('INVALID_DRAWING_SCENE', message);
}

function assertFinite(values: number[], message: string): void {
  if (values.some((value) => !Number.isFinite(value))) {
    invalidScene(message);
  }
}

function assertElement(element: DrawingElement): void {
  if (!element.id.trim()) {
    invalidScene('绘图元素必须有非空 id。');
  }
  if (
    element.opacity !== undefined &&
    (!Number.isFinite(element.opacity) || element.opacity < 0 || element.opacity > 1)
  ) {
    invalidScene('绘图元素透明度必须在 0 到 1 之间。');
  }

  switch (element.type) {
    case 'text':
      assertFinite(
        [element.x, element.y, element.width, element.height, element.fontSize, element.lineHeight],
        '文字元素尺寸必须是有限数值。',
      );
      if (
        element.width < 0 ||
        element.height < 0 ||
        element.fontSize <= 0 ||
        element.lineHeight <= 0
      ) {
        invalidScene('文字元素尺寸必须有效。');
      }
      return;
    case 'path':
      if (element.points.length === 0) {
        invalidScene('自由线条至少需要一个点。');
      }
      for (const point of element.points) {
        assertFinite([point.x, point.y], '自由线条坐标必须是有限数值。');
      }
      assertFinite([element.strokeWidth], '线宽必须是有限数值。');
      if (element.strokeWidth <= 0) invalidScene('线宽必须大于零。');
      return;
    case 'line':
    case 'arrow':
      assertFinite(
        [element.start.x, element.start.y, element.end.x, element.end.y, element.strokeWidth],
        '线条坐标和线宽必须是有限数值。',
      );
      if (element.strokeWidth <= 0) invalidScene('线宽必须大于零。');
      return;
    case 'rectangle':
    case 'ellipse':
      assertFinite(
        [element.x, element.y, element.width, element.height, element.strokeWidth],
        '图形尺寸和线宽必须是有限数值。',
      );
      if (element.strokeWidth <= 0) invalidScene('线宽必须大于零。');
      return;
  }
}

export function assertDrawingScene(scene: DrawingScene): void {
  if (scene.schemaVersion !== 1 || scene.engine !== 'songtie-svg') {
    invalidScene('不支持的绘图场景格式。');
  }
  if (!Array.isArray(scene.elements)) {
    invalidScene('绘图场景缺少元素列表。');
  }
  for (const element of scene.elements) assertElement(element);
}

function normalizeBox<T extends TextElement | RectangleElement | EllipseElement>(element: T): T {
  const x = element.width < 0 ? element.x + element.width : element.x;
  const y = element.height < 0 ? element.y + element.height : element.y;
  return {
    ...element,
    x,
    y,
    width: Math.abs(element.width),
    height: Math.abs(element.height),
  };
}

function normalizeElement(element: DrawingElement): DrawingElement {
  if (element.type === 'text' || element.type === 'rectangle' || element.type === 'ellipse') {
    return normalizeBox(element);
  }
  return element;
}

function getElementBounds(element: DrawingElement): ElementBounds {
  switch (element.type) {
    case 'text':
    case 'rectangle':
    case 'ellipse':
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      };
    case 'line':
    case 'arrow': {
      const x = Math.min(element.start.x, element.end.x);
      const y = Math.min(element.start.y, element.end.y);
      return {
        x,
        y,
        width: Math.max(element.start.x, element.end.x) - x,
        height: Math.max(element.start.y, element.end.y) - y,
      };
    }
    case 'path': {
      const xs = element.points.map(({ x }) => x);
      const ys = element.points.map(({ y }) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      };
    }
  }
}

function scalePoint(point: Point, origin: Point, scale: number): Point {
  return {
    x: origin.x + (point.x - origin.x) * scale,
    y: origin.y + (point.y - origin.y) * scale,
  };
}

function scaleElement(element: DrawingElement, origin: Point, scale: number): DrawingElement {
  switch (element.type) {
    case 'text': {
      const point = scalePoint(element, origin, scale);
      return {
        ...element,
        ...point,
        width: element.width * scale,
        height: element.height * scale,
        fontSize: element.fontSize * scale,
        lineHeight: element.lineHeight * scale,
      };
    }
    case 'rectangle':
    case 'ellipse': {
      const point = scalePoint(element, origin, scale);
      return {
        ...element,
        ...point,
        width: element.width * scale,
        height: element.height * scale,
        strokeWidth: element.strokeWidth * scale,
      };
    }
    case 'line':
    case 'arrow':
      return {
        ...element,
        start: scalePoint(element.start, origin, scale),
        end: scalePoint(element.end, origin, scale),
        strokeWidth: element.strokeWidth * scale,
      };
    case 'path':
      return {
        ...element,
        points: element.points.map((point) => scalePoint(point, origin, scale)),
        strokeWidth: element.strokeWidth * scale,
      };
  }
}

function translateElement(element: DrawingElement, dx: number, dy: number): DrawingElement {
  switch (element.type) {
    case 'text':
    case 'rectangle':
    case 'ellipse':
      return { ...element, x: element.x + dx, y: element.y + dy };
    case 'line':
    case 'arrow':
      return {
        ...element,
        start: { x: element.start.x + dx, y: element.start.y + dy },
        end: { x: element.end.x + dx, y: element.end.y + dy },
      };
    case 'path':
      return {
        ...element,
        points: element.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Keeps a complete element inside a finite canvas. Oversized elements are
 * uniformly scaled down first; otherwise their visual geometry is unchanged.
 */
export function constrainElement(input: DrawingElement, canvas: Bounds): DrawingElement {
  assertBounds(canvas);
  assertElement(input);
  let element = normalizeElement(input);
  let box = getElementBounds(element);

  const widthScale = box.width > 0 ? canvas.width / box.width : 1;
  const heightScale = box.height > 0 ? canvas.height / box.height : 1;
  const scale = Math.min(1, widthScale, heightScale);
  if (scale < 1) {
    element = scaleElement(element, { x: box.x, y: box.y }, scale);
    box = getElementBounds(element);
  }

  const targetX = clamp(box.x, 0, Math.max(0, canvas.width - box.width));
  const targetY = clamp(box.y, 0, Math.max(0, canvas.height - box.height));
  return translateElement(element, targetX - box.x, targetY - box.y);
}

export function constrainScene(scene: DrawingScene, canvas: Bounds): DrawingScene {
  assertDrawingScene(scene);
  assertBounds(canvas);
  return {
    ...scene,
    elements: scene.elements.map((element) => constrainElement(element, canvas)),
  };
}

/** True only when preserving the scene verbatim would keep every element visible. */
export function sceneFitsBounds(scene: DrawingScene, canvas: Bounds): boolean {
  assertDrawingScene(scene);
  assertBounds(canvas);
  return scene.elements.every((element) => {
    const box = getElementBounds(normalizeElement(element));
    return (
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= canvas.width &&
      box.y + box.height <= canvas.height
    );
  });
}
