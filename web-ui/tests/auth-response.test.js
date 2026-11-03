import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAuthenticationGate } from "../src/auth-gate.js";
import { authenticationNeedsNavigation } from "../src/auth-response.js";

function response(status, { type = "basic", redirected = false } = {}) {
  return {
    status,
    type,
    redirected,
    ok: status >= 200 && status < 300,
  };
}

test("authentication navigation handles Cloudflare Access and Bridge auth failures", () => {
  assert.equal(authenticationNeedsNavigation(response(204)), false);
  assert.equal(authenticationNeedsNavigation(response(200, { type: "opaqueredirect" })), true);
  assert.equal(authenticationNeedsNavigation(response(302)), true);
  assert.equal(authenticationNeedsNavigation(response(307)), true);
  assert.equal(authenticationNeedsNavigation(response(204, { redirected: true })), true);
  assert.equal(authenticationNeedsNavigation(response(401)), true);
  assert.equal(authenticationNeedsNavigation(response(403)), true);
  assert.equal(authenticationNeedsNavigation(response(200)), true);
});

test("authentication navigation leaves server failures visible", () => {
  assert.equal(authenticationNeedsNavigation(response(500)), false);
  assert.equal(authenticationNeedsNavigation(response(502)), false);
  assert.equal(authenticationNeedsNavigation(response(503)), false);
});

test("authentication refresh probes again after the app resumes", async () => {
  let probes = 0;
  const gate = createAuthenticationGate(async () => {
    probes += 1;
  });

  await gate.wait();
  await gate.refresh();
  assert.equal(probes, 2);
});

test("authentication probe performs a top-level reload for Access redirects", async () => {
  const source = await readFile(new URL("../src/api.js", import.meta.url), "utf8");
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /authenticationNeedsNavigation\(response\)/);
  assert.match(source, /window\.location\.reload\(\)/);
});

test("resuming the app revalidates authentication before refreshing data", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /document\.visibilityState === "visible"\) reauthenticate\(\)/);
});
