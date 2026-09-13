import type { Clock, IdGenerator } from '../application';

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private index = 0;

  constructor(private readonly ids: string[]) {}

  nextId(): string {
    const id = this.ids[this.index];
    if (id === undefined) {
      throw new Error('测试 id 序列已经用完。');
    }
    this.index += 1;
    return id;
  }
}
