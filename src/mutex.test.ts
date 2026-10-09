import { describe, expect, it } from 'vitest';
import { withLock } from './mutex';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('withLock', () => {
  it('serializes concurrent operations', async () => {
    const order: number[] = [];

    const a = withLock(async () => {
      order.push(1);
      await delay(20);
      order.push(2);
      return 'a';
    });
    const b = withLock(async () => {
      order.push(3);
      await delay(10);
      order.push(4);
      return 'b';
    });

    const resultA = await a;
    const resultB = await b;

    expect(resultA).toBe('a');
    expect(resultB).toBe('b');
    // b must wait for a to finish, so order must be [1,2,3,4], never [1,3,...]
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('returns and propagates the inner value', async () => {
    const result = await withLock(async () => 42);
    expect(result).toBe(42);
  });

  it('does not kill the chain on a rejected operation', async () => {
    await withLock(async () => {
      throw new Error('boom');
    }).catch(() => {});

    const result = await withLock(async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('rejects with the inner error', async () => {
    await expect(
      withLock(async () => {
        throw new Error('expected');
      }),
    ).rejects.toThrow('expected');
  });
});