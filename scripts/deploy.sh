#!/bin/bash
# Run this only once manually if deploying via Render YAML

echo "Installing Chromium for Playwright..."
npx playwright install --with-deps chromium
npm start


