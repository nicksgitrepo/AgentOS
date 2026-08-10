#!/usr/bin/env node

/* Load only an external host adapter; the imported module is not governance. */

import {
  bindNativeHost,
  validateNativeHostAdapter,
  validateNativeHostAttachment,
} from "./native-host-attachment.mjs";

export async function loadNativeHostAdapter({attachment, moduleUrl, runtimeIdentity = null} = {}) {
  validateNativeHostAttachment(attachment);
  if (typeof moduleUrl !== "string" || moduleUrl.trim().length === 0) throw new Error("NATIVE_HOST_ADAPTER_REQUIRED: an external module URL is required");
  let imported;
  try {
    imported = await import(moduleUrl);
  } catch (error) {
    throw new Error(`NATIVE_HOST_ADAPTER_LOAD_FAILED: ${error?.message ?? String(error)}`, {cause: error});
  }
  const factory = imported?.createNativeHostAdapter ?? imported?.default;
  if (typeof factory !== "function") throw new Error("NATIVE_HOST_ADAPTER_LOAD_FAILED: module must export createNativeHostAdapter or default");
  const host = await factory({attachment: structuredClone(attachment)});
  validateNativeHostAdapter(host);
  return bindNativeHost(host, attachment, {runtimeIdentity});
}
