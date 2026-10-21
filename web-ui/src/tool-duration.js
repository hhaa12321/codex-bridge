export function formatRunningToolDuration(startedAtMs, nowMs, language) {
  const seconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (seconds < 60) return language === "zh" ? `${seconds} 秒` : `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return language === "zh" ? `${minutes} 分钟` : `${minutes} min`;
}

export function createToolGroupClock(limit = 64) {
  const starts = new Map();
  return {
    startedAt(key, candidate, now = Date.now()) {
      if (starts.has(key)) return starts.get(key);
      const parsed = typeof candidate === "number" ? candidate : Date.parse(candidate);
      const startedAt = Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : now;
      starts.set(key, startedAt);
      if (starts.size > limit) starts.delete(starts.keys().next().value);
      return startedAt;
    },
  };
}
