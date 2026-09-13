import { memo, type CSSProperties } from 'react';
import type { DrawingScene } from '../../domain/types';
import { SceneElementView } from './SceneElementView';
import './drawing.css';

export type SceneRendererProps = {
  scene: DrawingScene;
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  rough?: boolean;
};

/** A complete, interaction-free rendering of one finite scene. */
export const SceneRenderer = memo(function SceneRenderer({
  scene,
  width,
  height,
  className = '',
  style,
  ariaLabel = '绘图内容',
  rough = true,
}: SceneRendererProps) {
  return (
    <svg
      className={`songtie-scene-renderer ${className}`.trim()}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
      style={{ background: scene.backgroundColor, ...style }}
    >
      {scene.elements.map((element) => (
        <SceneElementView key={element.id} element={element} rough={rough} />
      ))}
    </svg>
  );
});
