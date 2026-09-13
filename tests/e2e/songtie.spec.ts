import { expect, test, type Page } from '@playwright/test';

async function resetProduct(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
}

async function capture(page: Page, text: string) {
  await page.goto('/?window=quick-capture');
  const input = page.getByLabel('写下突然冒出的想法');
  await input.fill(text);
  await page.getByRole('button', { name: '贴上去' }).click();
  await expect(input).toHaveValue('');
}

async function dragNoteTo(page: Page, side: 'left' | 'right') {
  const note = page.getByRole('button', { name: '打开便利贴' }).first();
  const box = await note.boundingBox();
  if (!box) throw new Error('便利贴没有可拖动边界');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(side === 'left' ? 55 : 1400, 770, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await resetProduct(page);
});

test('随手贴自动选择纸张，保存后在当前墙完整出现', async ({ page }) => {
  await capture(page, '去阳台看看月亮');
  await page.goto('/');

  const note = page.getByRole('button', { name: '打开便利贴' });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('去阳台看看月亮');
  await note.click();
  await expect(page.getByRole('dialog', { name: '检视便利贴' })).toBeVisible();
  await expect(page.getByLabel('便利贴自由编辑')).toBeVisible();
});

test('便利贴可以通过 Enter 和 Space 稳定打开', async ({ page }) => {
  await capture(page, '键盘也能打开我');
  await page.goto('/');

  const note = page.getByRole('button', { name: '打开便利贴' });
  await note.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '检视便利贴' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await note.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: '检视便利贴' })).toBeVisible();
});

test('自由文字放不下时拒绝溢出，而不是静默隐藏内容', async ({ page }) => {
  await capture(page, '原来的文字');
  await page.goto('/');
  await page.getByRole('button', { name: '打开便利贴' }).click();

  const canvas = page.getByLabel('便利贴自由编辑');
  await canvas.dblclick({ position: { x: 70, y: 60 } });
  const textarea = page.getByLabel('编辑文字');
  await expect(textarea).toBeVisible();
  const original = await textarea.inputValue();
  await textarea.fill('这段内容绝对放不下。'.repeat(160));

  await expect(page.getByRole('status')).toContainText('放不下更多内容');
  await expect(textarea).toHaveValue(original);
});

test('拖拽被 pointercancel 取消时不会移动、完成或删除便利贴', async ({ page }) => {
  await capture(page, '取消拖拽时留在原地');
  await page.goto('/');

  const storedPosition = async () =>
    page.evaluate(() => {
      const state = JSON.parse(window.localStorage.getItem('songtie.browser-state.v1') ?? '{}') as {
        notes?: Array<{ position: { x: number; y: number; z: number } }>;
      };
      return state.notes?.[0]?.position ?? null;
    });
  const before = await storedPosition();
  const note = page.getByRole('button', { name: '打开便利贴' });
  const box = await note.boundingBox();
  if (!box) throw new Error('便利贴没有可拖动边界');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(55, 770, { steps: 10 });
  await note.dispatchEvent('pointercancel', {
    pointerId: 1,
    clientX: 55,
    clientY: 770,
    button: 0,
    bubbles: true,
  });
  await page.mouse.up();

  await expect(note).toHaveCount(1);
  expect(await storedPosition()).toEqual(before);
  const storedCounts = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem('songtie.browser-state.v1') ?? '{}') as {
      notes?: unknown[];
      completedNotes?: unknown[];
    };
    return {
      active: state.notes?.length ?? 0,
      completed: state.completedNotes?.length ?? 0,
    };
  });
  expect(storedCounts).toEqual({ active: 1, completed: 0 });

  await page.reload();
  await expect(page.getByRole('button', { name: '打开便利贴' })).toHaveCount(1);
});

test('过长的随手贴不会生成，也不会清空输入', async ({ page }) => {
  await page.goto('/?window=quick-capture');
  const text = 'W'.repeat(280);
  const input = page.getByLabel('写下突然冒出的想法');
  await input.fill(text);
  await expect(page.getByText('放不进大纸片')).toBeVisible();
  await page.getByRole('button', { name: '贴上去' }).click();
  await expect(page.getByRole('alert')).toContainText('请删减');
  await expect(input).toHaveValue(text);

  await page.goto('/');
  await expect(page.getByRole('button', { name: '打开便利贴' })).toHaveCount(0);
});

test('墙面涂鸦与便利贴分别保存，重载后仍然存在', async ({ page }) => {
  await capture(page, '画一条通往它的线');
  await page.goto('/');
  await page.getByRole('button', { name: /涂写/ }).click();
  const canvas = page.getByLabel('墙面涂鸦');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('墙面画布没有边界');
  await page.mouse.move(box.x + 260, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 510, box.y + 330, { steps: 14 });
  await page.mouse.up();
  await page.getByRole('button', { name: /摆放/ }).click();
  await expect(page.getByRole('button', { name: '打开便利贴' })).toHaveCount(1);

  await page.reload();
  await expect(page.getByLabel('墙面涂鸦').locator('path')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '打开便利贴' })).toContainText('画一条通往它的线');
});

test('完成和删除走向不同出口，完成陈列保持只读', async ({ page }) => {
  await capture(page, '把第一版做出来');
  await page.goto('/');
  await dragNoteTo(page, 'right');
  await expect(page.getByRole('button', { name: '打开便利贴' })).toHaveCount(0);

  await page.getByRole('button', { name: /完成陈列/ }).click();
  const completed = page.getByRole('button', { name: /完成于 .*打开查看/ });
  await expect(completed).toHaveCount(1);
  await expect(completed).toContainText('完成于');
  await completed.click();
  await expect(page.getByRole('dialog', { name: '查看完成便利贴' })).toBeVisible();
  await expect(page.getByLabel('便利贴自由编辑')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /回到当前墙/ }).click();

  await capture(page, '这个念头可以放下');
  await page.goto('/');
  await dragNoteTo(page, 'left');
  await expect(page.getByRole('button', { name: '打开便利贴' })).toHaveCount(0);
  await page.getByRole('button', { name: /完成陈列/ }).click();
  await expect(page.getByRole('button', { name: /完成于 .*打开查看/ })).toHaveCount(1);
});

test('一百张便利贴仍能完整铺开并直接交互', async ({ page }) => {
  await page.evaluate(() => {
    const createdAt = new Date().toISOString();
    const notes = Array.from({ length: 100 }, (_, index) => ({
      id: `load-note-${index}`,
      size: 'S' as const,
      position: {
        x: 12 + (index % 7) * 202,
        y: 88 + (index % 6) * 116,
        z: index,
      },
      scene: {
        schemaVersion: 1 as const,
        engine: 'songtie-svg' as const,
        engineVersion: '1',
        backgroundColor: index % 2 === 0 ? '#fff2a8' : '#dcefc8',
        elements: Array.from({ length: 20 }, (_, pathIndex) => ({
          id: `load-note-${index}:path-${pathIndex}`,
          type: 'path' as const,
          points: [
            { x: 10, y: 8 + pathIndex * 4 },
            { x: 90, y: 12 + pathIndex * 4 },
            { x: 170, y: 8 + pathIndex * 4 },
          ],
          color: '#37322b',
          strokeWidth: 2,
        })),
      },
      passiveDate: null,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    }));
    window.localStorage.setItem(
      'songtie.browser-state.v1',
      JSON.stringify({
        wall: {
          id: 'active',
          bounds: { width: 1456, height: 819 },
          scene: {
            schemaVersion: 1,
            engine: 'songtie-svg',
            engineVersion: '1',
            backgroundColor: '#f5f0e6',
            elements: [],
          },
          revision: 1,
          updatedAt: createdAt,
        },
        notes,
        completedNotes: [],
      }),
    );
  });

  const startedAt = Date.now();
  await page.reload();
  const notes = page.getByRole('button', { name: '打开便利贴' });
  await expect(notes).toHaveCount(100);
  expect(Date.now() - startedAt).toBeLessThan(8_000);

  const topmost = notes.last();
  const box = await topmost.boundingBox();
  if (!box) throw new Error('最上层便利贴没有可拖动边界');
  const dragStartedAt = Date.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(900, 300, { steps: 40 });
  await page.mouse.up();
  await expect(notes).toHaveCount(100);
  expect(Date.now() - dragStartedAt).toBeLessThan(10_000);

  await topmost.click();
  await expect(page.getByRole('dialog', { name: '检视便利贴' })).toBeVisible();
});
