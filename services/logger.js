export function createLogger(logs) {
  return function log(event, message, metaJson = null, level = 'info') {
    const ts = new Date().toISOString();
    const out = `[${ts}] [${event}] ${message}`;
    level === 'error' ? console.error(out) : console.log(out);

    if (!logs) return;
    logs.insert(ts, level, event, message, metaJson);
    logs.trim(2000);
  };
}
