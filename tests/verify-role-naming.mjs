#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {compileControllerRoleDisplay, controllerDisplayTitle, validateControllerRoleDisplay} from "../control/controller-role-display.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const naming = readJson("schemas/naming-and-terminology.v1.json");
const controller = readJson("schemas/agentos-controller.v1.json");
const readme = read("README.md");
const userGuide = read("docs/user-guide.md");
const namingArticle = read("governance/2.1rc/naming-and-terminology.md");

assert.equal(naming.canonical_terms.BOOTSTRAP.public_name, "Bootstrap");
assert(naming.canonical_terms.BOOTSTRAP.meaning.includes("read-only discovery"));
assert.equal(naming.canonical_terms.AGENTOS_CONTROLLER.public_name, "Intent Regulator");
assert(naming.canonical_terms.AGENTOS_CONTROLLER.meaning.includes("Project-persistent"));
assert(namingArticle.includes("`Intent Regulator` (`AGENTOS_CONTROLLER`) is project-persistent."));
assert(!namingArticle.includes("`AgentOS Controller` is project-persistent."));
assert.equal(naming.compatibility_aliases.GLOBAL_ORCHESTRATOR, "AGENTOS_CONTROLLER");
assert.equal(naming.canonical_paths.bootstrap_controller, "control/bootstrap-compiler.mjs");
assert.equal(naming.canonical_paths.agentos_controller, "control/agentos-controller.mjs");

function validateOngoingControllerRole(binding) {
  assert.equal(binding.name, "AGENTOS_CONTROLLER");
  assert.equal(binding.scope, "PROJECT_PERSISTENT");
  assert.notEqual(binding.name, "BOOTSTRAP");
}

validateOngoingControllerRole(controller);
assert.throws(() => validateOngoingControllerRole({...controller, name: "BOOTSTRAP"}), /AGENTOS_CONTROLLER/u);
const taskDisplay = compileControllerRoleDisplay({taskId: "TASK-CONTROLLER-ROLE-DISPLAY"});
assert.equal(taskDisplay.controllerRole, "AGENTOS_CONTROLLER");
assert.equal(taskDisplay.controllerDisplayName, "Intent Regulator");
assert.equal(taskDisplay.displayTitle, "Intent Regulator — TASK-CONTROLLER-ROLE-DISPLAY");
assert.equal(controllerDisplayTitle("TASK-CONTROLLER-ROLE-DISPLAY"), taskDisplay.displayTitle);
assert.throws(() => validateControllerRoleDisplay({controllerRole: "BOOTSTRAP", controllerDisplayName: "Bootstrap", displayTitle: "Start AgentOS safe build task"}, {taskId: "TASK-CONTROLLER-ROLE-DISPLAY"}), /AGENTOS_CONTROLLER/u);
assert.throws(() => validateControllerRoleDisplay({controllerRole: "AGENTOS_CONTROLLER", controllerDisplayName: "AgentOS Controller", displayTitle: "Start AgentOS safe build task"}, {taskId: "TASK-CONTROLLER-ROLE-DISPLAY"}), /title/u);
assert.throws(() => validateControllerRoleDisplay({controllerRole: "AGENTOS_CONTROLLER", controllerDisplayName: "AgentOS Controller", displayTitle: "Bootstrap — TASK-CONTROLLER-ROLE-DISPLAY"}, {taskId: "TASK-CONTROLLER-ROLE-DISPLAY"}), /Bootstrap/u);
assert(readme.includes("You are Bootstrap 2.1rc."));
assert(readme.includes("After\nsetup, the ongoing project-persistent role is **Intent Regulator**\n`AGENTOS_CONTROLLER`. It owns the control-plane conversation"));
assert(readme.includes("Bootstrap does not continue as that role."));
assert(userGuide.includes("After setup, the ongoing owner conversation is with the project-persistent"));
assert(userGuide.includes("Bootstrap remains the separate") && userGuide.includes("discovery and setup authority"));

console.log("PASS role naming: Bootstrap setup and Intent Regulator continuity stay distinct, with conflation hostile coverage");
