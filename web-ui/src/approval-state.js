const currentDecisionMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

function commandText(command) {
  if (Array.isArray(command)) return command.join(" ");
  return typeof command === "string" ? command : "";
}

export function approvalRequestModel(request) {
  const id = Number(request?.id);
  if (!Number.isSafeInteger(id) || id < 0) return null;
  const method = request.method,
    params = request.params || {};
  if (method === "item/commandExecution/requestApproval") {
    return {
      id,
      method,
      kind: "command",
      lines: [
        commandText(params.command),
        typeof params.cwd === "string" ? params.cwd : "",
        typeof params.reason === "string" ? params.reason : "",
      ].filter(Boolean),
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      id,
      method,
      kind: "file",
      lines: [
        typeof params.grantRoot === "string" ? params.grantRoot : "",
        typeof params.reason === "string" ? params.reason : "",
      ].filter(Boolean),
    };
  }
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return {
      id,
      method,
      kind: method === "execCommandApproval" ? "command" : "file",
      lines: [
        commandText(params.command),
        typeof params.cwd === "string" ? params.cwd : "",
        typeof params.reason === "string" ? params.reason : "",
      ].filter(Boolean),
    };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      id,
      method,
      kind: "permissions",
      lines: [
        typeof params.reason === "string" ? params.reason : "",
        typeof params.cwd === "string" ? params.cwd : "",
        JSON.stringify(params.permissions || {}, null, 2),
      ].filter(Boolean),
    };
  }
  return null;
}

export function approvalResponseFor(request, decision) {
  const approve = decision === "accept";
  if (currentDecisionMethods.has(request?.method)) {
    if (request.method === "item/permissions/requestApproval") {
      return {
        permissions: approve
          ? request.params?.permissions || { fileSystem: null, network: null }
          : { fileSystem: null, network: null },
        scope: "turn",
      };
    }
    return { decision: approve ? "accept" : "decline" };
  }
  if (request?.method === "execCommandApproval" || request?.method === "applyPatchApproval") {
    return {
      decision: approve ? "approved" : { denied: { rejection: "Declined by user" } },
    };
  }
  return null;
}
