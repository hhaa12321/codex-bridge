import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileCompactionProgress,
  startCompactionProgress,
  updateCompactionProgress,
} from "../src/compaction-progress.js";

test("compaction stays visible from start response through completion until rollout confirms it", () => {
  let progress = startCompactionProgress("thread-1");
  assert.equal(progress.phase, "running");
  progress = reconcileCompactionProgress(progress, { active_turn_id: "turn-1" }, []);
  assert.equal(progress.turnId, "turn-1");
  progress = updateCompactionProgress(progress, "item/completed", {
    threadId: "thread-1",
    turnId: "turn-1",
    item: { type: "contextCompaction" },
  });
  assert.equal(progress.phase, "completed");
  progress = updateCompactionProgress(progress, "turn/completed", {
    threadId: "thread-1",
    turn: { id: "turn-1" },
  });
  assert.equal(progress.phase, "completed");
  assert.equal(
    reconcileCompactionProgress(progress, null, [
      {
        category: "compaction",
        turn_id: "turn-1",
      },
    ]),
    null,
  );
});

test("failed compaction clears at turn completion without suppressing another turn", () => {
  let progress = startCompactionProgress("thread-1");
  progress = updateCompactionProgress(progress, "turn/started", {
    threadId: "thread-1",
    turn: { id: "turn-1" },
  });
  assert.equal(
    updateCompactionProgress(progress, "turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-0" },
    }),
    progress,
  );
  assert.equal(
    updateCompactionProgress(progress, "turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1" },
    }),
    null,
  );
});

test("automatic compaction starts from the live item event within an existing turn", () => {
  const progress = updateCompactionProgress(null, "item/started", {
    threadId: "thread-1",
    turnId: "turn-1",
    item: { type: "contextCompaction", id: "compact-1" },
  });
  assert.deepEqual(progress, {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "compact-1",
    phase: "running",
  });
  assert.equal(
    updateCompactionProgress(progress, "item/started", {
      threadId: "thread-2",
      turnId: "turn-2",
      item: { type: "contextCompaction" },
    }),
    progress,
  );
  assert.equal(
    reconcileCompactionProgress(progress, null, [
      { category: "compaction", turn_id: "turn-1", id: "compact-older" },
    ]),
    progress,
  );
});
