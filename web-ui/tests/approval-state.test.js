import assert from "node:assert/strict";
import test from "node:test";

import { approvalRequestModel, approvalResponseFor } from "../src/approval-state.js";

test("approval cards expose command context and current protocol decisions", () => {
  const request = {
    id: 7,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      command: ["printf", "approval-ok"],
      cwd: "/workspace/example",
      reason: "Needs workspace write access",
    },
  };
  assert.deepEqual(approvalRequestModel(request), {
    id: 7,
    method: request.method,
    kind: "command",
    lines: ["printf approval-ok", "/workspace/example", "Needs workspace write access"],
  });
  assert.deepEqual(approvalResponseFor(request, "accept"), { decision: "accept" });
  assert.deepEqual(approvalResponseFor(request, "decline"), { decision: "decline" });
});

test("file and legacy approval requests map to their native decisions", () => {
  assert.equal(
    approvalRequestModel({
      id: 8,
      method: "item/fileChange/requestApproval",
      params: { grantRoot: "/workspace/example", reason: "Apply patch" },
    }).kind,
    "file",
  );
  assert.deepEqual(approvalResponseFor({ method: "execCommandApproval" }, "accept"), {
    decision: "approved",
  });
  assert.deepEqual(approvalResponseFor({ method: "applyPatchApproval" }, "decline"), {
    decision: { denied: { rejection: "Declined by user" } },
  });
});

test("permission requests grant only the requested profile and decline with an empty profile", () => {
  const request = {
    id: 9,
    method: "item/permissions/requestApproval",
    params: {
      permissions: { fileSystem: { read: ["/workspace/example"] }, network: null },
      reason: "Read the project",
    },
  };
  assert.equal(approvalRequestModel(request).kind, "permissions");
  assert.deepEqual(approvalResponseFor(request, "accept"), {
    permissions: request.params.permissions,
    scope: "turn",
  });
  assert.deepEqual(approvalResponseFor(request, "decline"), {
    permissions: { fileSystem: null, network: null },
    scope: "turn",
  });
});

test("unsupported or malformed requests do not render an approval action", () => {
  assert.equal(approvalRequestModel({ id: "not-numeric", method: "unknown" }), null);
  assert.equal(approvalRequestModel({ id: 10, method: "mcp/unknownApproval", params: {} }), null);
  assert.equal(approvalResponseFor({ method: "unknown" }, "accept"), null);
});
