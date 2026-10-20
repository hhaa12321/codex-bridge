import assert from "node:assert/strict";
import test from "node:test";
import { mergeModelEffortUsage, mergeModelUsage, modelUsageRows } from "../src/model-usage.js";

test("model usage shows each model and a pending difference without double counting", () => {
  const rows = modelUsageRows({
    total_tokens: 250,
    model_usage: {
      "model-a": { total_tokens: 130, input_tokens: 100, output_tokens: 30 },
      "model-b": { total_tokens: 100, input_tokens: 85, output_tokens: 15 },
    },
  });
  assert.deepEqual(
    rows.map(({ model, total_tokens }) => [model, total_tokens]),
    [
      ["model-a", 130],
      ["model-b", 100],
      ["unknown", 20],
    ],
  );
});

test("older snapshots do not erase a newer model breakdown", () => {
  const merged = mergeModelUsage(
    { "model-a": { total_tokens: 100 } },
    { "model-a": { total_tokens: 130 }, "model-b": { total_tokens: 50 } },
  );
  assert.equal(merged["model-a"].total_tokens, 130);
  assert.equal(merged["model-b"].total_tokens, 50);
});

test("model usage shows distinct reasoning efforts and keeps an unknown effort", () => {
  const rows = modelUsageRows({
    total_tokens: 180,
    model_usage: { "model-a": { total_tokens: 180 } },
    model_effort_usage: {
      "model-a": {
        medium: { total_tokens: 100 },
        high: { total_tokens: 60 },
        unknown: { total_tokens: 20 },
      },
    },
  });
  assert.deepEqual(
    rows.map(({ model, effort, total_tokens }) => [model, effort, total_tokens]),
    [
      ["model-a", "medium", 100],
      ["model-a", "high", 60],
      ["model-a", "unknown", 20],
    ],
  );
  const merged = mergeModelEffortUsage(
    { "model-a": { high: { total_tokens: 60 } } },
    { "model-a": { medium: { total_tokens: 100 }, high: { total_tokens: 40 } } },
  );
  assert.equal(merged["model-a"].high.total_tokens, 60);
  assert.equal(merged["model-a"].medium.total_tokens, 100);
});
