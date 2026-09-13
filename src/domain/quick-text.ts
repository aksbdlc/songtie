import { createEmptyScene, type DrawingScene, type TextElement } from './drawing';
import { DomainError } from './errors';
import { NOTE_DIMENSIONS, type Bounds, type NoteSize } from './model';

export const QUICK_TEXT_STYLE = {
  padding: 18,
  fontSize: 20,
  lineHeight: 26,
  averageHalfWidth: 10,
} as const;

export const HANDWRITTEN_FONT = '"Comic Sans MS", "Kaiti SC", "STKaiti", "KaiTi", cursive';

export type QuickTextLayout = {
  columns: number;
  lines: number;
  maxLines: number;
};

export type QuickTextClassification = {
  size: NoteSize;
  layout: QuickTextLayout;
};

function isWideCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function characterColumns(character: string): number {
  if (/\p{Mark}/u.test(character) || character === '\u200d') return 0;
  if (character === '\t') return 4;
  if (isWideCharacter(character)) return 2;
  // Latin glyphs vary substantially in the handwritten font. These weights
  // deliberately err on the wide side so W/M-heavy input cannot pass the
  // domain capacity check and later disappear below the paper edge.
  if (/[MW@%&#]/.test(character)) return 2;
  if (/[mw]/.test(character)) return 1.6;
  if (/[A-Z]/.test(character)) return 1.4;
  if (/[ilI1.,'`:;|!]/.test(character)) return 0.65;
  return 1;
}

function columnsFor(bounds: Bounds): number {
  return Math.max(
    1,
    Math.floor((bounds.width - QUICK_TEXT_STYLE.padding * 2) / QUICK_TEXT_STYLE.averageHalfWidth),
  );
}

function maxLinesFor(bounds: Bounds): number {
  return Math.max(
    1,
    Math.floor((bounds.height - QUICK_TEXT_STYLE.padding * 2) / QUICK_TEXT_STYLE.lineHeight),
  );
}

function wrappedLineCount(text: string, columns: number): number {
  const sourceLines = text.replace(/\r\n?/g, '\n').split('\n');
  let count = 0;

  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      count += 1;
      continue;
    }

    let used = 0;
    count += 1;
    for (const character of Array.from(sourceLine)) {
      const width = characterColumns(character);
      if (used > 0 && used + width > columns) {
        count += 1;
        used = 0;
      }
      used += width;
    }
  }

  return count;
}

export function measureQuickText(text: string, size: NoteSize): QuickTextLayout {
  const bounds = NOTE_DIMENSIONS[size];
  const columns = columnsFor(bounds);
  return {
    columns,
    lines: wrappedLineCount(text, columns),
    maxLines: maxLinesFor(bounds),
  };
}

/**
 * Uses fixed font metrics rather than browser measurement so the preview and
 * save decision remain identical across machines and test runs.
 */
export function classifyQuickText(text: string): QuickTextClassification {
  if (!text.trim()) {
    throw new DomainError('EMPTY_QUICK_TEXT', '先写下一点内容再贴上墙。 ');
  }

  for (const size of ['S', 'M', 'L'] as const) {
    const layout = measureQuickText(text, size);
    if (layout.lines <= layout.maxLines) return { size, layout };
  }

  throw new DomainError('QUICK_TEXT_TOO_LONG', '这段文字放不进大号便利贴，请删减后再保存。');
}

export function createQuickTextScene(
  text: string,
  size: NoteSize,
  elementId: string,
): DrawingScene {
  const chosen = classifyQuickText(text);
  const chosenOrder = { S: 0, M: 1, L: 2 } as const;
  if (chosenOrder[size] < chosenOrder[chosen.size]) {
    throw new DomainError('QUICK_TEXT_TOO_LONG', '文字无法完整显示在指定尺寸的便利贴中。');
  }

  const bounds = NOTE_DIMENSIONS[size];
  const textElement: TextElement = {
    id: elementId,
    type: 'text',
    x: QUICK_TEXT_STYLE.padding,
    y: QUICK_TEXT_STYLE.padding,
    width: bounds.width - QUICK_TEXT_STYLE.padding * 2,
    // Keep the full usable height. Actual handwritten fonts can wrap a little
    // earlier than the deterministic estimator, but must never reveal a scroll
    // area or clip an otherwise accepted quick note.
    height: bounds.height - QUICK_TEXT_STYLE.padding * 2,
    text,
    fontSize: QUICK_TEXT_STYLE.fontSize,
    lineHeight: QUICK_TEXT_STYLE.lineHeight,
    color: '#342f27',
  };

  return {
    ...createEmptyScene('#fff2a8'),
    elements: [textElement],
  };
}
