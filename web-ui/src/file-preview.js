import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

export function createFilePreviewController({
  root,
  title,
  meta,
  body,
  closeButton,
  downloadButton,
  shareButton,
  transfer,
  progress,
  progressText,
  modeButton,
  translate,
  onError,
  renderMarkdown,
  inspectImage,
}) {
  let editor = null;
  let current = null;
  let currentPosition = null;
  let sourceMode = false;
  let transferController = null;
  let transferPromise = null;
  let downloadedFile = null;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const nativeShare = ios && typeof navigator.share === "function";

  const updateProgress = (loaded, total) => {
    transfer.hidden = false;
    if (total > 0) {
      const percent = Math.min(100, Math.round((loaded / total) * 100));
      progress.value = percent;
      progressText.textContent = `${percent}% · ${formatBytes(loaded)} / ${formatBytes(total)}`;
    } else {
      progress.removeAttribute("value");
      progressText.textContent = `${translate("downloadingFile")} ${formatBytes(loaded)}`;
    }
  };
  const loadFile = () => {
    if (downloadedFile) return Promise.resolve(downloadedFile);
    if (transferPromise) return transferPromise;
    if (!current?.download_url)
      return Promise.reject(new Error(translate("filePreviewUnsupported")));
    const preview = current;
    const controller = new AbortController();
    transferController = controller;
    shareButton.disabled = true;
    downloadButton.disabled = true;
    updateProgress(0, preview.size);
    transferPromise = (async () => {
      const response = await fetch(preview.download_url, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${translate("download")}: HTTP ${response.status}`);
      const total = Number(response.headers.get("content-length")) || preview.size || 0;
      const chunks = [];
      let loaded = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          updateProgress(loaded, total);
        }
      } else {
        const bytes = await response.arrayBuffer();
        chunks.push(bytes);
        loaded = bytes.byteLength;
        updateProgress(loaded, total);
      }
      if (total && loaded !== total) throw new Error(`${translate("download")}: incomplete file`);
      const file = new File(chunks, preview.name, {
        type: preview.mime_type?.split(";")[0] || "application/octet-stream",
      });
      if (current === preview) {
        downloadedFile = file;
        updateProgress(loaded, total || loaded);
        shareButton.disabled = false;
        if (nativeShare && navigator.canShare && !navigator.canShare({ files: [file] })) {
          shareButton.hidden = true;
          downloadButton.hidden = false;
        }
      }
      return file;
    })().finally(() => {
      if (transferController === controller) {
        transferController = null;
        transferPromise = null;
        downloadButton.disabled = false;
        if (!downloadedFile) shareButton.disabled = false;
      }
    });
    return transferPromise;
  };

  const destroyEditor = () => {
    editor?.destroy();
    editor = null;
  };
  const renderText = (content) => {
    destroyEditor();
    const mount = document.createElement("div");
    mount.className = "file-preview-editor";
    body.replaceChildren(mount);
    const extensions = [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": translate("filePreviewText"),
          spellcheck: "false",
        }),
      ],
      editorState = EditorState.create({ doc: content, extensions });
    let scrollTo;
    if (currentPosition?.line) {
      const line = editorState.doc.line(
          Math.min(Math.max(1, currentPosition.line), editorState.doc.lines),
        ),
        column = Math.min(Math.max(0, (currentPosition.column || 1) - 1), line.length),
        anchor = line.from + column;
      scrollTo = EditorView.scrollIntoView(anchor, { y: "center" });
    }
    editor = new EditorView({
      parent: mount,
      state: editorState,
      scrollTo,
    });
  };
  const renderCurrent = () => {
    if (!current) return;
    const renderableSource = current.kind === "markdown" || current.kind === "html";
    modeButton.hidden = !renderableSource;
    modeButton.textContent = translate(sourceMode ? "renderMarkdown" : "showMarkdownSource");
    if (current.kind === "markdown" && !sourceMode) {
      destroyEditor();
      const rendered = renderMarkdown(current.content || "");
      rendered.classList.add("file-preview-markdown");
      body.replaceChildren(rendered);
      return;
    }
    if (current.kind === "html" && !sourceMode) {
      destroyEditor();
      const frame = document.createElement("iframe");
      frame.className = "file-preview-html";
      frame.title = current.name;
      frame.setAttribute("sandbox", "");
      frame.referrerPolicy = "no-referrer";
      frame.srcdoc = secureHtmlPreviewDocument(current.content || "");
      body.replaceChildren(frame);
      return;
    }
    if (["text", "markdown", "html"].includes(current.kind)) {
      renderText(current.content || "");
      return;
    }
    destroyEditor();
    if (current.kind === "image" && current.preview_url) {
      const image = document.createElement("img");
      image.className = "file-preview-image";
      image.src = current.preview_url;
      image.alt = current.name;
      image.onclick = () => inspectImage(image.src, image.alt, image);
      body.replaceChildren(image);
      return;
    }
    const unsupported = document.createElement("div");
    unsupported.className = "file-preview-unsupported";
    unsupported.textContent = translate("filePreviewUnsupported");
    body.replaceChildren(unsupported);
  };
  const close = () => {
    transferController?.abort();
    transferController = null;
    transferPromise = null;
    downloadedFile = null;
    destroyEditor();
    current = null;
    currentPosition = null;
    root.hidden = true;
    document.body.classList.remove("file-preview-open");
  };
  const open = (preview, position = null) => {
    transferController?.abort();
    transferController = null;
    transferPromise = null;
    downloadedFile = null;
    transfer.hidden = true;
    progress.value = 0;
    current = preview;
    currentPosition = position;
    sourceMode = false;
    title.textContent = preview.name;
    meta.textContent = `${preview.mime_type} · ${formatBytes(preview.size)}`;
    downloadButton.hidden = !preview.download_url || nativeShare;
    downloadButton.disabled = false;
    shareButton.hidden = !preview.download_url || !nativeShare;
    shareButton.disabled = nativeShare;
    root.hidden = false;
    document.body.classList.add("file-preview-open");
    renderCurrent();
    closeButton.focus();
    if (nativeShare && preview.download_url) {
      loadFile().catch((error) => {
        if (error.name !== "AbortError" && current === preview) onError(error);
      });
    }
  };

  closeButton.onclick = close;
  root.onclick = (event) => {
    if (event.target === root) close();
  };
  modeButton.onclick = () => {
    sourceMode = !sourceMode;
    renderCurrent();
  };
  downloadButton.onclick = async () => {
    try {
      const file = await loadFile();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (error.name !== "AbortError") onError(error);
    }
  };
  shareButton.onclick = async () => {
    if (!downloadedFile) {
      loadFile().catch((error) => {
        if (error.name !== "AbortError") onError(error);
      });
      return;
    }
    try {
      await navigator.share({ files: [downloadedFile] });
    } catch (error) {
      if (error.name !== "AbortError") onError(error);
    }
  };

  return { open, close, isOpen: () => !root.hidden };
}

function secureHtmlPreviewDocument(source) {
  const policy = [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">${source}`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
