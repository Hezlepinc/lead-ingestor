export class TTLSet {
  constructor(ttlMs = 6 * 60 * 60 * 1000, maxSize = 10000) { // 6h, 10k ids
    this.ttl = ttlMs;
    this.max = maxSize;
    this.map = new Map(); // id -> expiresAt
  }

  has(id) {
    const exp = this.map.get(id);
    if (!exp) return false;
    if (exp < Date.now()) { this.map.delete(id); return false; }
    return true;
  }

  add(id) {
    if (this.map.size >= this.max) {
      // simple aging trim: remove 5% of earliest
      const removeCount = Math.ceil(this.max * 0.05);
      const keys = this.map.keys();
      for (let i = 0; i < removeCount; i++) {
        const k = keys.next().value;
        if (!k) break;
        this.map.delete(k);
      }
    }
    this.map.set(id, Date.now() + this.ttl);
  }
}


