const locks = new Map<string, NodeJS.Timeout>();

export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  if (locks.has(key)) throw Object.assign(new Error('locked'), { status: 423 });
  const to = setTimeout(() => locks.delete(key), ttlMs);
  locks.set(key, to);
  try {
    return await fn();
  } finally {
    clearTimeout(to);
    locks.delete(key);
  }
}


