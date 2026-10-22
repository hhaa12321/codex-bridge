export function startCompactionProgress(threadId) {
  return { threadId, turnId: null, itemId: null, phase: "running" };
}

export function updateCompactionProgress(progress, method, params = {}) {
  if (method === "item/started" && params.item?.type === "contextCompaction") {
    if (progress && params.threadId !== progress.threadId) return progress;
    return {
      threadId: params.threadId,
      turnId: params.turnId || progress?.turnId || null,
      itemId: params.item.id || null,
      phase: "running",
    };
  }
  if (!progress || params.threadId !== progress.threadId) return progress;
  if (method === "item/completed" && params.item?.type === "contextCompaction") {
    return {
      ...progress,
      turnId: params.turnId || progress.turnId,
      itemId: params.item.id || progress.itemId,
      phase: "completed",
    };
  }
  if (method === "turn/started") {
    return { ...progress, turnId: params.turn?.id || progress.turnId };
  }
  if (method === "turn/completed") {
    if (progress.turnId && params.turn?.id && progress.turnId !== params.turn.id) return progress;
    return progress.phase === "completed" ? progress : null;
  }
  return progress;
}

export function reconcileCompactionProgress(progress, activity, messages) {
  if (!progress) return null;
  const turnId = progress.turnId || activity?.active_turn_id || null;
  if (
    turnId &&
    messages?.some(
      (message) =>
        message.category === "compaction" &&
        (progress.itemId ? message.id === progress.itemId : message.turn_id === turnId),
    )
  )
    return null;
  return turnId === progress.turnId ? progress : { ...progress, turnId };
}
