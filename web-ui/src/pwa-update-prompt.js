export function showPwaUpdatePrompt({
  dialog,
  error,
  laterButton,
  updateButton,
  apply,
  reload,
  translate,
}) {
  let busy = false;

  const close = () => {
    if (dialog.open) dialog.close();
  };
  const reset = () => {
    busy = false;
    laterButton.disabled = false;
    updateButton.disabled = false;
    updateButton.textContent = translate("pwaUpdateNow");
    error.hidden = true;
    error.textContent = "";
  };

  laterButton.onclick = close;
  dialog.oncancel = (event) => {
    if (busy) event.preventDefault();
  };
  dialog.onclose = reset;
  updateButton.onclick = async () => {
    if (busy) return;
    busy = true;
    laterButton.disabled = true;
    updateButton.disabled = true;
    updateButton.textContent = translate("pwaUpdating");
    error.hidden = true;

    let switched = false;
    try {
      switched = await apply();
    } catch {
      // The prompt stays usable when activation cannot take over the page.
    }
    if (switched) {
      reload();
      return;
    }

    busy = false;
    laterButton.disabled = false;
    updateButton.disabled = false;
    updateButton.textContent = translate("pwaUpdateNow");
    error.textContent = translate("pwaUpdateNotReady");
    error.hidden = false;
  };

  if (!dialog.open) dialog.showModal();
  updateButton.focus();
}
