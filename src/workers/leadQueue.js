// Minimal queue/scheduler placeholder
const { logger } = require('../utils/logger');

class LeadQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  enqueue(task) {
    this.queue.push(task);
    this.processNext();
  }

  async processNext() {
    if (this.processing) return;
    const next = this.queue.shift();
    if (!next) return;
    this.processing = true;
    try {
      await next();
    } catch (e) {
      logger.error('LeadQueue task failed', { error: e.message });
    } finally {
      this.processing = false;
      if (this.queue.length) this.processNext();
    }
  }
}

module.exports = { LeadQueue };


