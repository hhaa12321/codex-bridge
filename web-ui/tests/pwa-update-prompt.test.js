import assert from "node:assert/strict";
import test from "node:test";

import { showPwaUpdatePrompt } from "../src/pwa-update-prompt.js";

const messages = {
  pwaUpdateNow: "Update now",
  pwaUpdating: "Updating…",
  pwaUpdateNotReady: "Not ready",
};

function promptFixture(apply) {
  const calls = { modal: 0, focus: 0, close: 0, reload: 0 };
  const dialog = {
    open: false,
    showModal: () => {
      calls.modal += 1;
      dialog.open = true;
    },
    close: () => {
      calls.close += 1;
      dialog.open = false;
    },
  };
  const fixture = {
    dialog,
    error: { hidden: true, textContent: "" },
    laterButton: { disabled: false },
    updateButton: {
      disabled: false,
      textContent: "Update now",
      focus: () => {
        calls.focus += 1;
      },
    },
    apply,
    reload: () => {
      calls.reload += 1;
    },
    translate: (key) => messages[key],
  };
  return { calls, fixture };
}

test("a confirmed update reloads only after the waiting worker takes over", async () => {
  let finishSwitch;
  const { calls, fixture } = promptFixture(
    () =>
      new Promise((resolve) => {
        finishSwitch = resolve;
      }),
  );
  showPwaUpdatePrompt(fixture);

  assert.equal(calls.modal, 1);
  assert.equal(calls.focus, 1);
  const applying = fixture.updateButton.onclick();
  assert.equal(fixture.updateButton.disabled, true);
  assert.equal(fixture.laterButton.disabled, true);
  assert.equal(fixture.updateButton.textContent, "Updating…");
  assert.equal(calls.reload, 0);

  finishSwitch(true);
  await applying;
  assert.equal(calls.reload, 1);
});

test("a failed takeover keeps the dialog open for retry without reloading", async () => {
  const { calls, fixture } = promptFixture(async () => false);
  showPwaUpdatePrompt(fixture);

  await fixture.updateButton.onclick();
  assert.equal(calls.reload, 0);
  assert.equal(fixture.updateButton.disabled, false);
  assert.equal(fixture.laterButton.disabled, false);
  assert.equal(fixture.updateButton.textContent, "Update now");
  assert.equal(fixture.error.hidden, false);
  assert.equal(fixture.error.textContent, "Not ready");

  const escape = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  fixture.dialog.oncancel(escape);
  assert.equal(escape.prevented, false);
  fixture.laterButton.onclick();
  assert.equal(calls.close, 1);
});
