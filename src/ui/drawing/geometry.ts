import { constrainElement } from '../../domain/drawing';
import type { Bounds, Point } from '../../domain/model';
import type { DrawingElement } from '../../domain/types';

export type ElementBounds = Bounds & Point;

const MIN_SIZE = 18;

export function clampPoint(point: Point, canvas: Bounds): Point {
  return {
    x: Math.min(Math.max(point.x, 0), canvas.width),
    y: Math.min(Math.max(point.y, 0), canvas.height),
  };
}

export function elementBounds(element: DrawingElement): ElementBounds {
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
        width: Math.abs(element.end.x - element.start.x),
        height: Math.abs(element.end.y - element.start.y),
      };
    }
    case 'path': {
      const xs = element.points.map((point) => point.x);
      const ys = element.points.map((point) => point.y);
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

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const ratio = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

export function hitTestElement(element: DrawingElement, point: Point, tolerance = 7): boolean {
  switch (element.type) {
    case 'text':
    case 'rectangle':
      return (
        point.x >= element.x - tolerance &&
        point.x <= element.x + element.width + tolerance &&
        point.y >= element.y - tolerance &&
        point.y <= element.y + element.height + tolerance
      );
    case 'ellipse': {
      const radiusX = Math.max(element.width / 2, 1);
      const radiusY = Math.max(element.height / 2, 1);
      const centerX = element.x + radiusX;
      const centerY = element.y + radiusY;
      return (
        ((point.x - centerX) / (radiusX + tolerance)) ** 2 +
          ((point.y - centerY) / (radiusY + tolerance)) ** 2 <=
        1
      );
    }
    case 'line':
    case 'arrow':
      return (
        distanceToSegment(point, element.start, element.end) <=
        Math.max(tolerance, element.strokeWidth + 3)
      );
    case 'path': {
      if (element.points.length === 1) {
        const onlyPoint = element.points[0]!;
        return (
          Math.hypot(point.x - onlyPoint.x, point.y - onlyPoint.y) <=
          Math.max(tolerance, element.strokeWidth + 3)
        );
      }
      return element.points.slice(1).some((end, index) => {
        const start = element.points[index]!;
        return distanceToSegment(point, start, end) <= Math.max(tolerance, element.strokeWidth + 3);
      });
    }
  }
}

export function findTopElement(
  elements: DrawingElement[],
  point: Point,
): DrawingElement | undefined {
  return [...elements].reverse().find((element) => hitTestElement(element, point));
}

export function moveElement(
  element: DrawingElement,
  dx: number,
  dy: number,
  canvas: Bounds,
): DrawingElement {
  let moved: DrawingElement;
  switch (element.type) {
    case 'text':
    case 'rectangle':
    case 'ellipse':
      moved = { ...element, x: element.x + dx, y: element.y + dy };
      break;
    case 'line':
    case 'arrow':
      moved = {
        ...element,
        start: { x: element.start.x + dx, y: element.start.y + dy },
        end: { x: element.end.x + dx, y: element.end.y + dy },
      };
      break;
    case 'path':
      moved = {
        ...element,
        points: element.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
      break;
  }
  return constrainElement(moved, canvas);
}

export function resizeElement(
  element: DrawingElement,
  pointer: Point,
  canvas: Bounds,
): DrawingElement {
  const bounds = elementBounds(element);
  const target = clampPoint(pointer, canvas);

  switch (element.type) {
    case 'text': {
      const baseWidth = Math.max(element.width, MIN_SIZE);
      const baseHeight = Math.max(element.height, MIN_SIZE);
      const minimumScale = Math.max(MIN_SIZE / baseWidth, MIN_SIZE / baseHeight);
      const requestedScale = Math.min(
        (target.x - bounds.x) / baseWidth,
        (target.y - bounds.y) / baseHeight,
      );
      const scale = Math.max(minimumScale, requestedScale);
      return constrainElement(
        {
          ...element,
          width: baseWidth * scale,
          height: baseHeight * scale,
          fontSize: element.fontSize * scale,
          lineHeight: element.lineHeight * scale,
        },
        canvas,
      );
    }
    case 'rectangle':
    case 'ellipse':
      return constrainElement(
        {
          ...element,
          width: Math.max(MIN_SIZE, target.x - bounds.x),
          height: Math.max(MIN_SIZE, target.y - bounds.y),
        },
        canvas,
      );
    case 'line':
    case 'arrow': {
      const scaleX = bounds.width > 0 ? Math.max(1, target.x - bounds.x) / bounds.width : 1;
      const scaleY = bounds.height > 0 ? Math.max(1, target.y - bounds.y) / bounds.height : 1;
      const scale = (point: Point): Point => ({
        x: bounds.x + (point.x - bounds.x) * scaleX,
        y: bounds.y + (point.y - bounds.y) * scaleY,
      });
      return constrainElement(
        { ...element, start: scale(element.start), end: scale(element.end) },
        canvas,
      );
    }
    case 'path': {
      const scaleX = bounds.width > 0 ? Math.max(1, target.x - bounds.x) / bounds.width : 1;
      const scaleY = bounds.height > 0 ? Math.max(1, target.y - bounds.y) / bounds.height : 1;
      return constrainElement(
        {
          ...element,
          points: element.points.map((point) => ({
            x: bounds.x + (point.x - bounds.x) * scaleX,
            y: bounds.y + (point.y - bounds.y) * scaleY,
          })),
        },
        canvas,
      );
    }
  }
}

export function isResizeHandleHit(element: DrawingElement, point: Point, radius = 11): boolean {
  const bounds = elementBounds(element);
  return (
    Math.hypot(point.x - (bounds.x + bounds.width), point.y - (bounds.y + bounds.height)) <= radius
  );
}
