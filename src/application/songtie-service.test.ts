import { describe, expect, it } from 'vitest';

import { DomainError, createEmptyScene, type DrawingScene } from '../domain';
import { FixedClock, InMemorySongtieRepository, SequenceIdGenerator } from '../test-support';
import { SongtieService } from './songtie-service';

const SCREEN = { width: 800, height: 600 };

describe('SongtieService', () => {
  it('只初始化一面足以容纳大号便利贴的有限墙', async () => {
    const { service } = harness();

    await expect(service.initializeWall({ width: 389, height: 600 })).rejects.toMatchObject({
      code: 'INVALID_BOUNDS',
    });
    const wall = await service.initializeWall(SCREEN);
    expect(wall).toMatchObject({ id: 'active', bounds: SCREEN, revision: 1 });
    await expect(service.initializeWall(SCREEN)).rejects.toMatchObject({
      code: 'WALL_ALREADY_INITIALIZED',
    });
  });

  it('快捷创建自动选尺寸、生成文字元素并落在有限墙上', async () => {
    const { service, repository } = await initializedHarness();
    const note = await service.captureQuickNote('突然想到一件事');

    expect(note).toMatchObject({
      id: 'note-1',
      size: 'S',
      revision: 1,
      createdAt: '2026-08-20T04:05:06.000Z',
    });
    expect(note.scene.elements[0]).toMatchObject({
      id: 'note-1:text',
      type: 'text',
      text: '突然想到一件事',
    });
    expect(note.position.x + 180).toBeLessThanOrEqual(SCREEN.width);
    expect(note.position.y + 108).toBeLessThanOrEqual(SCREEN.height);
    expect(repository.inspect().notes).toHaveLength(1);
  });

  it('超长快捷输入不创建便利贴', async () => {
    const { service, repository } = await initializedHarness();

    await expect(service.captureQuickNote('a'.repeat(281))).rejects.toMatchObject({
      code: 'QUICK_TEXT_TOO_LONG',
    });
    expect(repository.inspect().notes).toHaveLength(0);
  });

  it('全屏创建默认使用大号，并让多个落点优先避免重叠', async () => {
    const { service } = await initializedHarness(['note-1', 'note-2']);
    const first = await service.createWallNote();
    const second = await service.createWallNote();

    expect(first.size).toBe('L');
    expect(second.size).toBe('L');
    expect(second.position.z).toBe(1);
    expect(second.position).not.toEqual(first.position);
  });

  it('移动时限制墙界并吸附附近边缘，每次保存递增版本', async () => {
    const { service } = await initializedHarness(['note-1', 'note-2']);
    const first = await service.captureQuickNote('一');
    const second = await service.captureQuickNote('二');
    await service.moveNote(first.id, { x: 100, y: 100 }, { snap: false });
    const moved = await service.moveNote(second.id, { x: 288, y: 104 });

    expect(moved.position).toMatchObject({ x: 280, y: 100 });
    expect(moved.revision).toBe(2);
    const clamped = await service.moveNote(second.id, { x: 10_000, y: -100 }, { snap: false });
    expect(clamped.position).toMatchObject({ x: 620, y: 0 });
    expect(clamped.revision).toBe(3);
  });

  it('拒绝会隐藏或重排内容的缩小，允许原样放得下的尺寸切换', async () => {
    const { service } = await initializedHarness();
    const note = await service.createWallNote();
    await service.moveNote(note.id, { x: 410, y: 340 }, { snap: false });
    await expect(
      service.saveNote({
        id: note.id,
        size: 'S',
        passiveDate: '2026-08-30',
        scene: oversizedRectangleScene(),
      }),
    ).rejects.toMatchObject({ code: 'SCENE_DOES_NOT_FIT' });

    const saved = await service.saveNote({
      id: note.id,
      size: 'S',
      passiveDate: '2026-08-30',
      scene: createEmptyScene(),
    });
    expect(saved).toMatchObject({
      size: 'S',
      position: { x: 410, y: 340 },
      passiveDate: '2026-08-30',
      revision: 3,
    });
    expect(saved.scene.elements).toEqual([]);
  });

  it('完成从当前墙原子移入只读陈列，删除则不进入陈列', async () => {
    const { service, repository, clock } = await initializedHarness(['complete-me', 'delete-me']);
    await service.captureQuickNote('值得记住');
    await service.captureQuickNote('可以放下');
    clock.set(new Date(2026, 7, 21, 23, 30));

    const completed = await service.completeNote('complete-me');
    await service.deleteNote('delete-me');
    const state = repository.inspect();

    expect(completed).toMatchObject({
      id: 'complete-me',
      completedOn: '2026-08-21',
      completedOrder: 1,
    });
    expect(state.notes).toEqual([]);
    expect(state.completedNotes).toEqual([completed]);
  });

  it('墙面涂鸦保存受墙界限制并递增版本', async () => {
    const { service } = await initializedHarness();
    const wall = await service.saveWallScene(oversizedRectangleScene());

    expect(wall.revision).toBe(2);
    expect(wall.scene.elements[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 675,
      height: 600,
    });
  });

  it('内存仓库阻止旧版本覆盖新保存', async () => {
    const { service, repository } = await initializedHarness();
    const original = await service.captureQuickNote('版本一');
    await service.moveNote(original.id, { x: 0, y: 0 }, { snap: false });

    await expect(repository.updateNote(original, 1)).rejects.toSatisfy(
      (error: unknown) => error instanceof DomainError && error.code === 'REVISION_CONFLICT',
    );
  });
});

function harness(ids = ['note-1']): {
  repository: InMemorySongtieRepository;
  clock: FixedClock;
  service: SongtieService;
} {
  const repository = new InMemorySongtieRepository();
  const clock = new FixedClock(new Date('2026-08-20T04:05:06.000Z'));
  const service = new SongtieService(repository, clock, new SequenceIdGenerator(ids));
  return { repository, clock, service };
}

async function initializedHarness(ids = ['note-1']): Promise<ReturnType<typeof harness>> {
  const result = harness(ids);
  await result.service.initializeWall(SCREEN);
  return result;
}

function oversizedRectangleScene(): DrawingScene {
  return {
    ...createEmptyScene(),
    elements: [
      {
        id: 'rectangle',
        type: 'rectangle',
        x: -100,
        y: -100,
        width: 900,
        height: 800,
        strokeColor: '#111',
        fillColor: 'transparent',
        strokeWidth: 2,
      },
    ],
  };
}
