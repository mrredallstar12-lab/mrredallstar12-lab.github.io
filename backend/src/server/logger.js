const LEVELS = new Map([
  ["debug", 10],
  ["info", 20],
  ["warn", 30],
  ["error", 40]
]);

export function createLogger(level = "info") {
  const threshold = LEVELS.get(level) || LEVELS.get("info");

  function write(entryLevel, message, detail = {}) {
    if ((LEVELS.get(entryLevel) || 99) < threshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level: entryLevel,
      message,
      ...detail
    };
    const line = JSON.stringify(entry);
    if (entryLevel === "error") console.error(line);
    else console.log(line);
  }

  return {
    debug: (message, detail) => write("debug", message, detail),
    info: (message, detail) => write("info", message, detail),
    warn: (message, detail) => write("warn", message, detail),
    error: (message, detail) => write("error", message, detail)
  };
}

