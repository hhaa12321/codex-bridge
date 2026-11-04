function modelLabel(model, effort) {
  return [model, effort].filter(Boolean).join(" · ");
}

export function modelStatusLabel(currentModel, currentEffort, selectedModel, selectedEffort) {
  const selected = modelLabel(selectedModel, selectedEffort);
  if (!currentModel) return selected;
  const current = modelLabel(currentModel, currentEffort);
  return currentModel === selectedModel && (!currentEffort || currentEffort === selectedEffort)
    ? selected
    : selected
      ? `${current} → ${selected}`
      : current;
}
