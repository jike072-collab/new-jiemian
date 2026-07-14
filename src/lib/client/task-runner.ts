export function createClientTaskRunner(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function runWithSlot<T>(task: () => Promise<T>) {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
