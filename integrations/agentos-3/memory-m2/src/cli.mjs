#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { MemoryProject } from "./project.mjs";
import { MemoryService } from "./memory.mjs";
import { CurrentProjection } from "./projections.mjs";
import { AgentRoster } from "./rosters.mjs";
import { RunWorkspace } from "./runs.mjs";
import { MemoryError } from "./errors.mjs";

function usage() {
  return `Usage:
  agentos-memory init <root> <project-id>
  agentos-memory put <root> <json-or-@file> [subject-ref]
  agentos-memory propose <root> <json-or-@file>
  agentos-memory transition <root> <record-ref> <verify|accept|reject|invalidate|tombstone> [reason]
  agentos-memory search <root> <query> [role] [lane]
  agentos-memory context <root> <query> [budget-bytes]
  agentos-memory project <root> <rebuild|verify>
  agentos-memory roster-register <root> <json-or-@file> [actor]
  agentos-memory roster-transition <root> <agent-id> <target-state> <options-json-or-@file>
  agentos-memory roster-rethread <root> <agent-id> <new-session-ref> <options-json-or-@file>
  agentos-memory roster-expire <root> <agent-id> <observed-at-utc> [actor]
  agentos-memory roster-list <root>
  agentos-memory run-start <root> <options-json-or-@file>
  agentos-memory run-seed <root> <run-id>
  agentos-memory run-write <root> <run-id> <text-or-@file>
  agentos-memory run-checkpoint <root> <run-id> [actor]
  agentos-memory run-recover <root> <run-id> [actor]
  agentos-memory run-close <root> <run-id> [options-json-or-@file]
  agentos-memory get <root> <object-ref>
  agentos-memory log <root>
  agentos-memory verify <root>`;
}

async function jsonArgument(argument) {
  const text = argument.startsWith("@") ? await readFile(argument.slice(1), "utf8") : argument;
  return JSON.parse(text);
}

async function textArgument(argument) {
  return argument.startsWith("@") ? readFile(argument.slice(1), "utf8") : argument;
}

async function main(argv) {
  const [command, root, ...args] = argv;
  if (!command || !root) throw new MemoryError("USAGE", usage());
  if (command === "init") {
    if (args.length !== 1) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.init(root, args[0]);
    process.stdout.write(`${JSON.stringify(await project.verify(), null, 2)}\n`);
    return;
  }
  if (command === "put") {
    if (args.length < 1 || args.length > 2) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const result = await project.record(await jsonArgument(args[0]), { subjectRef: args[1] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "propose") {
    if (args.length !== 1) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const result = await new MemoryService(project).propose(await jsonArgument(args[0]));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "transition") {
    if (args.length < 2 || args.length > 3) throw new MemoryError("USAGE", usage());
    const actions = { verify: "RECORD_VERIFIED", accept: "RECORD_ACCEPTED", reject: "RECORD_REJECTED", invalidate: "RECORD_INVALIDATED", tombstone: "RECORD_TOMBSTONED" };
    if (!(args[1] in actions)) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const event = await new MemoryService(project).transition(args[0], actions[args[1]], { reason: args[2] ?? null });
    process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
    return;
  }
  if (command === "search" || command === "context") {
    if (args.length < 1 || args.length > 3) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root);
    const memory = new MemoryService(project);
    const result = command === "search"
      ? await memory.search(args[0], { role: args[1] ?? null, lane: args[2] ?? null })
      : await memory.contextPacket(args[0], { budget_bytes: args[1] === undefined ? undefined : Number(args[1]) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "project") {
    if (args.length !== 1 || !["rebuild", "verify"].includes(args[0])) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: args[0] === "rebuild" });
    const projection = new CurrentProjection(project, new MemoryService(project));
    const result = args[0] === "rebuild" ? await projection.rebuild() : await projection.verify();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "roster-register") {
    if (args.length < 1 || args.length > 2) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const result = await new AgentRoster(project).register(await jsonArgument(args[0]), { actor: args[1] ?? "controller" });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "roster-transition") {
    if (args.length !== 3) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const result = await new AgentRoster(project).transition(args[0], args[1], await jsonArgument(args[2]));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "roster-expire") {
    if (args.length < 2 || args.length > 3) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const result = await new AgentRoster(project).expireLease(args[0], args[1], { actor: args[2] ?? "runtime" });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "roster-rethread") {
    if (args.length !== 3) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const result = await new AgentRoster(project).rethread(args[0], args[1], await jsonArgument(args[2]));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "roster-list") {
    if (args.length !== 0) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root);
    process.stdout.write(`${JSON.stringify(await new AgentRoster(project).projection(), null, 2)}\n`);
    return;
  }
  if (command === "run-start") {
    if (args.length !== 1) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const memory = new MemoryService(project);
    const result = await new RunWorkspace(project, memory).start(await jsonArgument(args[0]));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "run-write") {
    if (args.length !== 2) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root);
    const runs = new RunWorkspace(project, new MemoryService(project));
    await runs.writeScratch(args[0], await textArgument(args[1]));
    process.stdout.write(`${JSON.stringify({ run_id: args[0], written: true }, null, 2)}\n`);
    return;
  }
  if (command === "run-seed") {
    if (args.length !== 1) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root);
    const result = await new RunWorkspace(project, new MemoryService(project)).readSeed(args[0]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "run-checkpoint") {
    if (args.length < 1 || args.length > 2) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const result = await new RunWorkspace(project, new MemoryService(project)).checkpoint(args[0], { actor: args[1] ?? "runner" });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "run-recover") {
    if (args.length < 1 || args.length > 2) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root);
    const result = await new RunWorkspace(project, new MemoryService(project))
      .recoverLocal(args[0], { actor: args[1] ?? "controller.run-recovery" });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "run-close") {
    if (args.length < 1 || args.length > 2) throw new MemoryError("USAGE", usage());
    const project = await MemoryProject.open(root, { writable: true });
    const options = args[1] === undefined ? {} : await jsonArgument(args[1]);
    const result = await new RunWorkspace(project, new MemoryService(project)).close(args[0], options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const project = await MemoryProject.open(root);
  if (command === "get") {
    if (args.length !== 1) throw new MemoryError("USAGE", usage());
    process.stdout.write(`${JSON.stringify(await project.getJson(args[0]), null, 2)}\n`);
  } else if (command === "log") {
    if (args.length !== 0) throw new MemoryError("USAGE", usage());
    process.stdout.write(`${JSON.stringify((await project.verifyEvents()).events, null, 2)}\n`);
  } else if (command === "verify") {
    if (args.length !== 0) throw new MemoryError("USAGE", usage());
    process.stdout.write(`${JSON.stringify(await project.verify(), null, 2)}\n`);
  } else {
    throw new MemoryError("USAGE", usage());
  }
}

main(process.argv.slice(2)).catch((error) => {
  const code = error instanceof MemoryError ? error.code : "UNEXPECTED";
  process.stderr.write(`${code}: ${error.message}\n`);
  process.exitCode = 1;
});
