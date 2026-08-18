#!/usr/bin/env node

/*
 * Public Controller project-store authority.
 *
 * The canonical Bootstrap project-store provisioner is not bound yet. Keep
 * this production surface fail-closed until it can hand Controller a real,
 * project-scoped opaque capability. No root, path, test minting, inspection,
 * or legacy alias is exposed here.
 */

function unavailable() {
  const error = new Error("Controller project-store authority is unavailable until trusted Bootstrap provisioning is bound");
  error.code = "CONTROLLER_PROJECT_STORE_PROVISIONING_REQUIRED";
  throw error;
}

export function readControllerProjectState() {
  return unavailable();
}

export function writeControllerProjectStateCompareAndSwap() {
  return unavailable();
}

export function consumeControllerProjectEventOnce() {
  return unavailable();
}
