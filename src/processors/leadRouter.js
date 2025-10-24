const fs = require('fs');
const path = require('path');
const settings = require('../config/settings');
const { logger } = require('../utils/logger');
const { notifyOffice } = require('./notifyOffice');

async function persistLead(lead) {
  const filePath = settings.storagePath;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  let existing = [];
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    existing = JSON.parse(raw || '[]');
  } catch (e) {
    // ignore if file doesn't exist
  }
  existing.push(lead);
  await fs.promises.writeFile(filePath, JSON.stringify(existing, null, 2));
}

async function routeLead(lead) {
  logger.info(`Routing lead ${lead.id} from ${lead.source}`);
  await notifyOffice(lead);
  await persistLead(lead);
}

module.exports = { routeLead };


