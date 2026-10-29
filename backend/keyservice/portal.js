"use strict";
// No localStorage/sessionStorage, third-party scripts, analytics or secret logging.
const element = (id) => document.getElementById(id);
const base = window.location.pathname.startsWith("/maintenance/") ? "/maintenance" : "";
let csrf = "";
let rootId = "";
let busy = false;
const feedback = (text) => { element("feedback").textContent = text; };
function signedOut() {
  csrf = "";
  rootId = "";
  document.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
  element("controls").hidden = true;
  element("signin").hidden = false;
}
async function request(path, data) {
  const response = await fetch(base + path, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: {"Content-Type": "application/json", "X-CSRFToken": csrf},
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 403) signedOut();
    throw new Error(response.status === 403 ? "Access denied or session expired. Sign in again." :
      response.status === 409 ? "The key state changed. Refresh status before trying again." :
      response.status === 503 ? "Key service is sealed or unavailable." : "The operation could not be verified. Check the recovery key and retry.");
  }
  return result;
}
async function refresh() {
  const state = await request("/v1/custody-status", {});
  rootId = state.root_id;
  element("state").textContent = state.sealed ? "Sealed" : "Ready";
  element("root-version").textContent = "Root version: " + rootId;
  element("unseal").hidden = !state.sealed;
  element("seal").hidden = state.sealed;
}
async function perform(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try { await action(); } catch (error) { feedback(error instanceof Error ? error.message : "Operation failed."); }
  finally { busy = false; document.querySelectorAll("button").forEach((button) => { button.disabled = false; }); }
}
element("login").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const data = {username: element("username").value, password: element("password").value};
    element("password").value = "";
    try { const result = await request("/login", data); csrf = result.csrf; }
    finally { data.password = ""; }
    element("signin").hidden = true;
    element("controls").hidden = false;
    await refresh(); feedback("Custodian signed in. No recovery key has been stored.");
  });
});
element("unseal").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const data = {secret: element("recovery").value.trim()}; element("recovery").value = "";
    try { await request("/v1/unseal", data); } finally { data.secret = ""; }
    await refresh(); feedback("Key service is ready. Authorized document operations can resume.");
  });
});
element("seal").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => { await request("/v1/seal", {}); element("seal-confirm").checked = false; await refresh(); feedback("Key service sealed. Stored documents have not been deleted."); });
});
element("rotate").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    if (element("new-secret").value !== element("confirm-secret").value) throw new Error("Recovery keys do not match.");
    const data = {secret: element("new-secret").value.trim(), expected: rootId};
    element("new-secret").value = element("confirm-secret").value = "";
    let result;
    try { result = await request("/v1/rotate-root", data); } finally { data.secret = ""; }
    element("backup-confirm").checked = false; await refresh(); feedback(result.storage_cleanup_complete ? "Root protection rotated and live database cleaned. Preserve old backup recovery material separately." : "Root protection rotated, but live database cleanup is incomplete. Operator maintenance is required; do not repeat rotation. Preserve backup recovery material.");
  });
});
element("logout").addEventListener("click", () => {
  void perform(async () => { try { await request("/v1/logout", {}); } finally { signedOut(); } feedback("Signed out. The service sealing state was not changed."); });
});
window.addEventListener("pagehide", signedOut);
setInterval(() => { if (csrf && !busy) void perform(refresh); }, 15000);
