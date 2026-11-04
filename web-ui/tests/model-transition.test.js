import assert from "node:assert/strict";
import test from "node:test";
import { modelStatusLabel } from "../src/model-transition.js";

test("shows the rollout model until the selected model takes effect", () => {
  assert.equal(
    modelStatusLabel("model-a", "low", "model-b", "high"),
    "model-a · low → model-b · high",
  );
  assert.equal(modelStatusLabel("model-b", "high", "model-b", "high"), "model-b · high");
});

test("does not claim a transition without a model observed in the rollout", () => {
  assert.equal(modelStatusLabel(null, null, "model-b", "high"), "model-b · high");
  assert.equal(modelStatusLabel("model-b", null, "model-b", "high"), "model-b · high");
});
