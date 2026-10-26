const MAX_BUFFER = 64;
const MAX_BATCH = 24;
const FLUSH_DELAY_MS = 1_200;

const ALLOWED_FIELDS = new Set([
  "type",
  "seq",
  "ts",
  "request_id",
  "command",
  "status",
  "duration_ms",
  "close_code",
  "retry_delay_ms",
  "retry_count",
  "writer_state",
  "previous_writer_state",
  "reason_code",
  "error_code",
  "event_sequence",
  "skipped",
  "route",
  "visible",
  "online",
  "viewport_width",
  "viewport_height",
  "theme",
  "visibility",
  "connection",
  "phase",
  "count",
  "bytes",
  "metric",
  "cache",
  "source",
  "session_id",
]);

function safeText(key, value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 128 || [...text].some((character) => character.charCodeAt(0) < 32))
    return null;
  if (key === "type") return /^[a-zA-Z0-9._-]+$/.test(text) ? text : null;
  if (key === "route") return text.startsWith("/") ? text.split(/[?#]/, 1)[0] : null;
  return text;
}

export function sanitizeDiagnosticEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const output = {};
  const declaresType = Object.hasOwn(event, "type");
  for (const [key, value] of Object.entries(event)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (typeof value === "boolean") output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = Math.round(Math.max(-1_000_000_000_000, Math.min(1_000_000_000_000, value)));
    } else {
      const text = safeText(key, value);
      if (text) output[key] = text;
    }
  }
  if (declaresType && !output.type) return null;
  return Object.keys(output).length ? output : null;
}

function browserContext(sessionId) {
  if (typeof window === "undefined" || typeof document === "undefined")
    return { session_id: sessionId };
  return {
    session_id: sessionId,
    route: window.location.pathname,
    viewport_width: Math.round(window.innerWidth || 0),
    viewport_height: Math.round(window.innerHeight || 0),
    visible: document.visibilityState === "visible",
    online: navigator.onLine !== false,
    theme: document.documentElement.dataset.theme || "system",
    visibility: document.visibilityState,
  };
}

export function createClientDiagnostics({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  contextProvider = browserContext,
} = {}) {
  const sessionId = randomUUID();
  let sequence = 0;
  let queue = [];
  let history = [];
  let timer = null;
  let flushing = null;

  function record(type, fields = {}) {
    const event = sanitizeDiagnosticEvent({
      ...fields,
      type,
      seq: ++sequence,
      ts: now(),
    });
    if (!event) return;
    queue.push(event);
    history.push(event);
    if (queue.length > MAX_BUFFER) queue.splice(0, queue.length - MAX_BUFFER);
    if (history.length > 100) history.splice(0, history.length - 100);
    if (
      typeof console !== "undefined" &&
      ["ws_close", "ws_retry", "command_error", "writer_state", "slow_performance"].includes(type)
    )
      console.debug?.("[codex-bridge:diag]", event);
    scheduleFlush();
  }

  function scheduleFlush(delay = FLUSH_DELAY_MS) {
    if (timer !== null || flushing || !queue.length) return;
    timer = schedule(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function flush() {
    if (flushing) return flushing;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (!fetchImpl || !queue.length) return true;
    const batch = queue.splice(0, MAX_BATCH);
    flushing = (async () => {
      try {
        const response = await fetchImpl("/api/client-log", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: sanitizeDiagnosticEvent(contextProvider(sessionId)) || {},
            events: batch,
          }),
          keepalive: true,
        });
        if (!response.ok && response.status >= 500) queue.unshift(...batch);
        return response.ok;
      } catch {
        queue.unshift(...batch);
        return false;
      } finally {
        flushing = null;
        if (queue.length > MAX_BUFFER) queue.splice(0, queue.length - MAX_BUFFER);
        if (queue.length) scheduleFlush(5_000);
      }
    })();
    return flushing;
  }

  return {
    record,
    flush,
    recent: () => history.map((event) => ({ ...event })),
    sessionId,
  };
}

export const diagnostics =
  typeof window === "undefined"
    ? { record() {}, flush: async () => true, recent: () => [], sessionId: null }
    : createClientDiagnostics();

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    diagnostics.record("visibility", {
      visible: document.visibilityState === "visible",
      visibility: document.visibilityState,
    });
    if (document.hidden) void diagnostics.flush();
  });
  window.addEventListener("online", () => diagnostics.record("network", { online: true }));
  window.addEventListener("offline", () => diagnostics.record("network", { online: false }));
  window.addEventListener("pagehide", () => void diagnostics.flush());
}
