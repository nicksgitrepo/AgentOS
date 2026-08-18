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
assert.equal(naming.canonical_terms.AGENTOS_CONTROLLER.public_name, "Controller");
assert(naming.canonical_terms.AGENTOS_CONTROLLER.meaning.includes("workflow regulator"));
assert.equal(naming.canonical_terms.PRODUCT_OWNER.public_name, "Product Owner");
assert(namingArticle.includes("`Controller` (`AGENTOS_CONTROLLER`) regulates workflow"));
assert(namingArticle.includes("`Product Owner` (`AGENTOS.PRODUCT_OWNER`) owns user intent"));
assert.equal(naming.compatibility_aliases.GLOBAL_ORCHESTRATOR, "AGENTOS_CONTROLLER");
assert.equal(Object.hasOwn(naming.compatibility_aliases, "INTENT_REGULATOR"), false, "retired Intent Regulator cannot silently normalize into Product Owner authority");
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
assert.equal(taskDisplay.controllerDisplayName, "Controller");
assert.equal(taskDisplay.displayTitle, "Controller — TASK-CONTROLLER-ROLE-DISPLAY");
assert.equal(controllerDisplayTitle("TASK-CONTROLLER-ROLE-DISPLAY"), taskDisplay.displayTitle);
assert.throws(() => validateControllerRoleDisplay({controllerRole: "BOOTSTRAP", controllerDisplayName: "Bootstrap", displayTitle: "Start AgentOS safe build task"}, {taskId: "TASK-CONTROLLER-ROLE-DISPLAY"}), /AGENTOS_CONTROLLER/u);
assert.throws(() => validateControllerRoleDisplay({controllerRole: "AGENTOS_CONTROLLER", controllerDisplayName: "AgentOS Controller", displayTitle: "Start AgentOS safe build task"}, {taskId: "TASK-CONTROLLER-ROLE-DISPLAY"}), /legacy display names/u);
assert.throws(() => validateControllerRoleDisplay({controllerRole: "AGENTOS_CONTROLLER", controllerDisplayName: "Intent Regulator"}), /legacy display names/u);
assert.throws(() => validateControllerRoleDisplay({controllerRole: "AGENTOS_CONTROLLER", controllerDisplayName: "Controller", displayTitle: "Bootstrap — TASK-CONTROLLER-ROLE-DISPLAY"}, {taskId: "TASK-CONTROLLER-ROLE-DISPLAY"}), /Bootstrap/u);
assert(readme.includes("You are Bootstrap 2.1rc."));
assert(readme.includes("**Controller** regulates workflow") && readme.includes("Product Owner owns\nuser intent"));
assert(readme.includes("Bootstrap becomes the Product Owner only after the one-time Spawner start"));
assert(userGuide.includes("Product Owner") && userGuide.includes("Controller"));
assert(userGuide.includes("After the one-time Spawner start, Bootstrap becomes") && userGuide.includes("separate\n**Controller**"));

console.log("PASS role naming: Bootstrap, Spawner, workflow-only Controller, and intent-owning Product Owner stay distinct, with retired-name hostile coverage");
