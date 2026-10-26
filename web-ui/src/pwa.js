import { diagnostics } from "./client-diagnostics.js";

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const register = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        diagnostics.record("service_worker", {
          status: "registered",
          source: registration.scope,
        });
      })
      .catch(() => {
        diagnostics.record("service_worker", {
          status: "registration_failed",
        });
      });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
