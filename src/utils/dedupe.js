// Simple in-memory dedupe by hash or id; replace with Redis/DB later
const seen = new Set();

function isDuplicate(key) {
  if (!key) return false;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

module.exports = { isDuplicate };


