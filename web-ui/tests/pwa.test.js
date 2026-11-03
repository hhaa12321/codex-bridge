import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  activateWaitingServiceWorker,
  checkForServiceWorkerUpdate,
  serviceWorkerURL,
  SW_SKIP_WAITING_MESSAGE,
  waitForPendingServiceWorker,
} from "../src/pwa.js";

function documentWithScript(source) {
  return {
    baseURI: "https://codex.example/",
    querySelector: () => ({ getAttribute: () => source }),
  };
}

test("the app bundle version gives each deployment a distinct service worker URL", () => {
  assert.equal(
    serviceWorkerURL(documentWithScript("/assets/app.js?v=0123456789ab")),
    "/sw.js?v=0123456789ab",
  );
  assert.equal(serviceWorkerURL(documentWithScript("/src/main.js")), "/sw.js");
  assert.equal(serviceWorkerURL(documentWithScript("/assets/app.js?v=stale")), "/sw.js");
  assert.equal(serviceWorkerURL({ querySelector: () => null }), "/sw.js");
});

test("an installing worker is awaited until it becomes the waiting update", async () => {
  const listeners = new Set();
  const installing = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const waiting = { scriptURL: "/sw.js?v=0123456789ab" };
  const registration = { installing, waiting: null };
  const pending = waitForPendingServiceWorker(registration, 100);

  registration.installing = null;
  registration.waiting = waiting;
  listeners.forEach((listener) => listener());

  assert.equal(await pending, waiting);
  assert.equal(listeners.size, 0);
});

test("update failures still inspect an installation already in progress", async () => {
  const wiring = { scriptURL: "/sw.js?v=0123456789ab" };
  const registration = {
    waiting: wiring,
    update: async () => {
      throw new Error("offline");
    },
  };

  assert.equal(await checkForServiceWorkerUpdate(registration), wiring);
});

test("update activation listens before messaging the waiting worker and waits for takeover", async () => {
  const listeners = new Set();
  const messages = [];
  const container = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const registration = {
    waiting: {
      postMessage: (message) => {
        assert.equal(listeners.size, 1);
        messages.push(message);
      },
    },
  };

  const switched = activateWaitingServiceWorker(container, registration, 100);
  assert.deepEqual(messages, [SW_SKIP_WAITING_MESSAGE]);
  listeners.forEach((listener) => listener());

  assert.equal(await switched, true);
  assert.equal(listeners.size, 0);
});

test("the service worker waits for confirmation and only accepts SKIP_WAITING", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const install = source.slice(
    source.indexOf('self.addEventListener("install"'),
    source.indexOf('self.addEventListener("message"'),
  );

  assert.doesNotMatch(install, /skipWaiting/);
  assert.match(source, /self\.addEventListener\("message"/);
  assert.match(source, /event\.data\?\.type === "SKIP_WAITING"/);
  assert.match(source, /event\.waitUntil\(self\.skipWaiting\(\)\)/);
});
