import { memo, type CSSProperties } from 'react';
import { HANDWRITTEN_FONT } from '../../domain/quick-text';
import type { DrawingElement } from '../../domain/types';
import { elementBounds } from './geometry';

type SceneElementViewProps = {
  element: DrawingElement;
  rough?: boolean;
};

function pathData(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function arrowHead(element: Extract<DrawingElement, { type: 'arrow' }>) {
  const angle = Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x);
  const length = Math.max(10, element.strokeWidth * 4);
  const spread = Math.PI / 7;
  return [
    element.end,
    {
      x: element.end.x - Math.cos(angle - spread) * length,
      y: element.end.y - Math.sin(angle - spread) * length,
    },
    {
      x: element.end.x - Math.cos(angle + spread) * length,
      y: element.end.y - Math.sin(angle + spread) * length,
    },
  ]
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
}

export const SceneElementView = memo(function SceneElementView({
  element,
  rough = true,
}: SceneElementViewProps) {
  const opacity = element.opacity ?? 1;
  const roughStrokeProps = rough
    ? {
        transform: 'translate(0.65 0.45)',
        opacity: opacity * 0.24,
      }
    : undefined;

  if (element.type === 'text') {
    const style: CSSProperties = {
      boxSizing: 'border-box',
      color: element.color,
      fontFamily: HANDWRITTEN_FONT,
      fontSize: `${element.fontSize}px`,
      lineHeight: `${element.lineHeight}px`,
      overflow: 'hidden',
      overflowWrap: 'anywhere',
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
    };
    return (
      <foreignObject
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        opacity={opacity}
        pointerEvents="none"
      >
        <div style={style}>{element.text}</div>
      </foreignObject>
    );
  }

  if (element.type === 'path') {
    if (element.points.length === 1) {
      const point = element.points[0]!;
      return (
        <circle
          cx={point.x}
          cy={point.y}
          r={Math.max(1.5, element.strokeWidth / 2)}
          fill={element.color}
          opacity={opacity}
        />
      );
    }
    const d = pathData(element.points);
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {rough && (
          <path
            d={d}
            stroke={element.color}
            strokeWidth={element.strokeWidth}
            {...roughStrokeProps}
          />
        )}
        <path d={d} stroke={element.color} strokeWidth={element.strokeWidth} opacity={opacity} />
      </g>
    );
  }

  if (element.type === 'line' || element.type === 'arrow') {
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {rough && (
          <line
            x1={element.start.x}
            y1={element.start.y}
            x2={element.end.x}
            y2={element.end.y}
            stroke={element.color}
            strokeWidth={element.strokeWidth}
            {...roughStrokeProps}
          />
        )}
        <line
          x1={element.start.x}
          y1={element.start.y}
          x2={element.end.x}
          y2={element.end.y}
          stroke={element.color}
          strokeWidth={element.strokeWidth}
          opacity={opacity}
        />
        {element.type === 'arrow' && (
          <polygon
            points={arrowHead(element)}
            fill={element.color}
            stroke={element.color}
            strokeWidth={Math.max(1, element.strokeWidth / 2)}
            opacity={opacity}
          />
        )}
      </g>
    );
  }

  const bounds = elementBounds(element);
  const common = {
    fill: element.fillColor,
    stroke: element.strokeColor,
    strokeWidth: element.strokeWidth,
    opacity,
  };

  if (element.type === 'ellipse') {
    return (
      <g>
        {rough && (
          <ellipse
            cx={bounds.x + bounds.width / 2}
            cy={bounds.y + bounds.height / 2}
            rx={bounds.width / 2}
            ry={bounds.height / 2}
            {...common}
            fill="none"
            {...roughStrokeProps}
          />
        )}
        <ellipse
          cx={bounds.x + bounds.width / 2}
          cy={bounds.y + bounds.height / 2}
          rx={bounds.width / 2}
          ry={bounds.height / 2}
          {...common}
        />
      </g>
    );
  }

  return (
    <g>
      {rough && (
        <rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          rx={3}
          {...common}
          fill="none"
          {...roughStrokeProps}
        />
      )}
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        rx={3}
        {...common}
      />
    </g>
  );
});
