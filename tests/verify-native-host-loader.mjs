import assert from "node:assert/strict";
import {compileHostAttachment} from "../control/native-host-attachment.mjs";
import {loadNativeHostAdapter} from "../control/native-host-loader.mjs";

const attachment = compileHostAttachment({
  attachment_id: "ATTACHMENT-3-0",
  host_id: "HOST-3-0",
  project_id: "PROJECT-3-0",
  environment_id: "ENV-3-0",
  attached_at_utc: "2026-01-01T00:00:00.000Z",
});
const moduleUrl = "data:text/javascript,export default async()=>({create_thread:async()=>({}),list_threads:async()=>({}),read_thread:async()=>({}),wait_threads:async()=>({}),send_message_to_thread:async()=>({}),set_thread_pinned:async()=>({}),set_thread_archived:async()=>({})})";
const host = await loadNativeHostAdapter(moduleUrl, attachment);

for (const action of ["create_thread", "list_threads", "read_thread", "wait_threads", "send_message_to_thread", "set_thread_pinned", "set_thread_archived"]) assert.equal(typeof host[action], "function");
await assert.rejects(() => host.list_threads({identity: {project_id: "FOREIGN-PROJECT"}}), /project differs/u);
console.log(JSON.stringify({status: "PASS", attachment: attachment.attachment_id, actions: 7}));
