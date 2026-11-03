import { diagnostics } from "./client-diagnostics.js";

export const SW_SKIP_WAITING_MESSAGE = Object.freeze({ type: "SKIP_WAITING" });
export const SW_INSTALL_TIMEOUT_MS = 30_000;
export const SW_SWITCH_TIMEOUT_MS = 3_000;

export function serviceWorkerURL(documentRef = document) {
  const source = documentRef.querySelector('script[type="module"][src]')?.getAttribute("src");
  if (!source) return "/sw.js";
  try {
    const version = new URL(source, documentRef.baseURI).searchParams.get("v");
    if (/^[0-9a-f]{12}$/i.test(version || "")) return `/sw.js?v=${version}`;
  } catch {
    // A malformed script URL falls back to the stable service worker URL.
  }
  return "/sw.js";
}

export function waitForPendingServiceWorker(registration, timeoutMs = SW_INSTALL_TIMEOUT_MS) {
  if (registration?.waiting) return Promise.resolve(registration.waiting);
  const installing = registration?.installing;
  if (!installing) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (worker) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      installing.removeEventListener("statechange", inspect);
      resolve(worker);
    };
    function inspect() {
      if (registration.waiting) finish(registration.waiting);
      else if (!registration.installing) finish(null);
    }

    installing.addEventListener("statechange", inspect);
    timer = setTimeout(() => finish(null), timeoutMs);
    inspect();
  });
}

export async function checkForServiceWorkerUpdate(registration, timeoutMs = SW_INSTALL_TIMEOUT_MS) {
  if (registration.waiting) return registration.waiting;
  try {
    await registration.update();
  } catch {
    // The registration can already have an installing worker even when update() fails.
  }
  return waitForPendingServiceWorker(registration, timeoutMs);
}

export function activateWaitingServiceWorker(
  container,
  registration,
  timeoutMs = SW_SWITCH_TIMEOUT_MS,
) {
  const waiting = registration?.waiting;
  if (!waiting) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (changed) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      container.removeEventListener("controllerchange", onChange);
      resolve(changed);
    };
    function onChange() {
      finish(true);
    }

    // Listen first: skipWaiting can take effect immediately after postMessage.
    container.addEventListener("controllerchange", onChange);
    timer = setTimeout(() => finish(false), timeoutMs);
    waiting.postMessage(SW_SKIP_WAITING_MESSAGE);
  });
}

export function registerServiceWorker({ onUpdateAvailable } = {}) {
  if (!("serviceWorker" in navigator)) return;

  const register = async () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let registration;
    try {
      registration = await navigator.serviceWorker.register(serviceWorkerURL(document), {
        scope: "/",
      });
      diagnostics.record("service_worker", {
        status: "registered",
        source: registration.scope,
      });
    } catch {
      diagnostics.record("service_worker", {
        status: "registration_failed",
      });
      return;
    }

    if (!hadController || !onUpdateAvailable) return;
    const waiting = await checkForServiceWorkerUpdate(registration);
    if (!waiting) return;

    diagnostics.record("service_worker", {
      status: "update_available",
      source: waiting.scriptURL || registration.scope,
    });
    await onUpdateAvailable({
      apply: () => activateWaitingServiceWorker(navigator.serviceWorker, registration),
    });
  };

  if (document.readyState === "complete") void register();
  else window.addEventListener("load", register, { once: true });
}
