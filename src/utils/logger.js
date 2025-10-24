export function log(message, ...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${message}`, ...args);
}


