import {assert} from "./canonical-json.mjs";
import {bindNativeHost, validateHostAttachment} from "./native-host-attachment.mjs";

export async function loadNativeHostAdapter(module_url, attachment) {
  validateHostAttachment(attachment);
  assert(typeof module_url === "string" && module_url.length > 0, "native host adapter module URL is required");
  const loaded = await import(module_url);
  const factory = loaded.createNativeHostAdapter ?? loaded.default;
  assert(typeof factory === "function", "native host adapter module must export createNativeHostAdapter or default");
  const host = await factory({attachment: {...attachment}});
  return bindNativeHost(host, attachment);
}
