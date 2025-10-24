const express = require('express');
const { logger } = require('./utils/logger');
const settings = require('./config/settings');

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  await new Promise((resolve) => {
    app.listen(settings.port, () => {
      logger.info(`API listening on port ${settings.port}`);
      resolve();
    });
  });
}

module.exports = { createApp, startServer };


