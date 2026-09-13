import { describe, expect, it } from 'vitest';

import { DomainError } from './errors';
import { classifyQuickText, createQuickTextScene, measureQuickText } from './quick-text';

describe('快捷文字容量', () => {
  it('按固定排版指标选择最小可完整显示的纸张', () => {
    expect(classifyQuickText('笑一笑').size).toBe('S');
    expect(classifyQuickText('a'.repeat(29)).size).toBe('M');
    expect(classifyQuickText('a'.repeat(116)).size).toBe('L');
  });

  it('中文和 emoji 占两个半角列，换行被明确计数', () => {
    expect(measureQuickText('一二三四五六七八', 'S').lines).toBe(2);
    expect(measureQuickText('🙂🙂🙂🙂🙂🙂🙂🙂', 'S').lines).toBe(2);
    expect(classifyQuickText('1\n2\n3\n4\n5\n6').size).toBe('L');
  });

  it('拒绝空白和大号纸也无法容纳的文字', () => {
    expectErrorCode(() => classifyQuickText(' \n\t '), 'EMPTY_QUICK_TEXT');
    expectErrorCode(() => classifyQuickText('a'.repeat(281)), 'QUICK_TEXT_TOO_LONG');
    expectErrorCode(() => classifyQuickText('W'.repeat(280)), 'QUICK_TEXT_TOO_LONG');
  });

  it('快捷文字会成为可继续编辑的普通文字元素', () => {
    const scene = createQuickTextScene('一个念头', 'S', 'note-1:text');

    expect(scene).toMatchObject({
      schemaVersion: 1,
      engine: 'songtie-svg',
      elements: [
        {
          id: 'note-1:text',
          type: 'text',
          text: '一个念头',
          x: 18,
          y: 18,
        },
      ],
    });
  });
});

function expectErrorCode(action: () => unknown, code: DomainError['code']): void {
  try {
    action();
    throw new Error('预期领域错误，但操作成功。 ');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}
