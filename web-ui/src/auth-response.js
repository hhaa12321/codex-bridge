export function authenticationNeedsNavigation(response) {
  return (
    response.type === "opaqueredirect" ||
    response.redirected ||
    (response.status >= 300 && response.status < 400) ||
    response.status === 401 ||
    response.status === 403 ||
    (response.ok && response.status !== 204)
  );
}
