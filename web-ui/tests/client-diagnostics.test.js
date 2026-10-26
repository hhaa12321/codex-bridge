import assert from "node:assert/strict";
import test from "node:test";

import { createClientDiagnostics, sanitizeDiagnosticEvent } from "../src/client-diagnostics.js";

test("client diagnostics retain only bounded operational fields", () => {
  const sanitized = sanitizeDiagnosticEvent({
    type: "command_complete",
    command: "send",
    request_id: "req-1234",
    duration_ms: 123.7,
    route: "/api/command?secret=value#thread",
    text: "private prompt",
    token: "secret-token",
    nested: { path: "/home/private" },
  });

  assert.deepEqual(sanitized, {
    type: "command_complete",
    command: "send",
    request_id: "req-1234",
    duration_ms: 124,
    route: "/api/command",
  });
  assert.equal(sanitizeDiagnosticEvent({ type: "bad type", command: "send" }), null);
});

test("client diagnostics flush one bounded privacy-safe batch", async () => {
  const requests = [];
  const timers = new Map();
  let nextTimer = 0;
  const diagnostics = createClientDiagnostics({
    now: () => 1_234,
    randomUUID: () => "session-1234",
    contextProvider: (sessionId) => ({
      session_id: sessionId,
      route: "/?token=secret#thread",
      viewport_width: 390,
      viewport_height: 844,
      theme: "dark",
      visible: true,
      online: true,
      visibility: "visible",
    }),
    schedule: (callback, delay) => {
      const timer = ++nextTimer;
      timers.set(timer, { callback, delay });
      return timer;
    },
    cancel: (timer) => timers.delete(timer),
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, status: 204 };
    },
  });

  diagnostics.record("command_start", {
    request_id: "req-1234",
    command: "thread_watch",
    text: "do not log this",
  });
  assert.equal(timers.size, 1);
  assert.equal(await diagnostics.flush(), true);
  assert.equal(timers.size, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/client-log");
  assert.equal(requests[0].body.context.route, "/");
  assert.equal(requests[0].body.context.session_id, "session-1234");
  assert.deepEqual(requests[0].body.events, [
    {
      type: "command_start",
      request_id: "req-1234",
      command: "thread_watch",
      seq: 1,
      ts: 1_234,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /do not log this|secret/);
});
