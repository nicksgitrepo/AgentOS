#!/usr/bin/env python3
"""Deterministic semantic validator for candidate Task IR fixtures."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "task-ir.schema.json"
FIXTURE_DIR = ROOT / "fixtures" / "task-ir"

MILESTONES = {
    "routing": 0,
    "seed_compile": 1,
    "tool_use": 2,
    "side_effect": 3,
    "acceptance": 4,
    "closure": 5,
}
SIDE_EFFECT_ACTIONS = {
    "activate",
    "publish",
    "deploy",
    "release",
    "migrate",
    "delete",
    "write_protected",
}
EXPECTED_FAILURES = {
    "invalid-contradiction.json": "UNRESOLVED_CONTRADICTION",
    "invalid-missing-protected-decision.json": "MISSING_PROTECTED_DECISION",
    "invalid-authority-escalation.json": "AUTHORITY_ESCALATION",
    "invalid-stale-block.json": "STALE_BLOCK",
    "invalid-context-budget-overflow.json": "CONTEXT_BUDGET_OVERFLOW",
    "invalid-omitted-unresolved.json": "UNRESOLVED_FIELD_LEDGER_MISMATCH",
}


class ValidationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValidationError("ROOT_NOT_OBJECT", f"{path.name} root is not an object")
    return value


def structural_check(schema: dict, document: dict) -> None:
    if schema.get("properties", {}).get("schemaVersion", {}).get("const") != "task-ir.v0.1":
        raise ValidationError("SCHEMA_VERSION_MISMATCH", "schema does not declare task-ir.v0.1")
    required = schema.get("required", [])
    missing = [key for key in required if key not in document]
    if missing:
        raise ValidationError("SCHEMA_REQUIRED_FIELD", f"missing top-level fields: {missing}")
    if document.get("schemaVersion") != "task-ir.v0.1":
        raise ValidationError("SCHEMA_VERSION_MISMATCH", "fixture schemaVersion is not task-ir.v0.1")

    defs = schema.get("$defs", {})
    expected_classes = {
        "owner_supplied",
        "registry_resolved",
        "compiler_derived",
        "agent_discoverable",
        "prohibited_to_infer",
    }
    actual_classes = set(defs.get("fieldClass", {}).get("enum", []))
    if actual_classes != expected_classes:
        raise ValidationError("SCHEMA_FIELD_CLASSES", "field class enum drifted")

    expected_milestones = set(MILESTONES)
    actual_milestones = set(defs.get("requiredBefore", {}).get("enum", []))
    if actual_milestones != expected_milestones:
        raise ValidationError("SCHEMA_MILESTONES", "required-before milestone enum drifted")

    required_paths = {
        "taskPacket": [
            "identity", "objective", "scope", "exclusions", "currentState",
            "acceptanceCriteria", "requiredOutputs", "requiredEvidence",
            "preservedInvariants", "stopConditions", "escalationConditions",
            "handoff", "closureRequirements",
        ],
        "taskPacket.identity": ["taskId", "requester", "taskFamily"],
        "taskPacket.scope": ["include", "exclude"],
        "taskPacket.handoff": ["recipient", "requiredFields", "closure"],
        "constraints": ["requiredFields", "forbiddenActions", "conditionalRules", "contradictions", "authorityCeiling"],
        "constraints.authorityCeiling": ["allowedActions", "forbiddenActions", "maxContextTokens"],
        "compilation": ["status", "stage", "selectedBlocks", "projectedContextTokens", "maxContextTokens", "requestedActions", "unresolvedFields"],
        "provenance": ["ownerIntentRef", "sourceRefs", "compilerVersion", "taskDigest"],
        "lifecycle": ["state", "admission", "activation", "refreshTriggers", "archiveConditions"],
    }

    def get_path(path: str):
        value = document
        for part in path.split("."):
            if not isinstance(value, dict) or part not in value:
                raise ValidationError("SCHEMA_REQUIRED_FIELD", f"missing schema path: {path}")
            value = value[part]
        return value

    for path, keys in required_paths.items():
        value = get_path(path)
        for key in keys:
            if not isinstance(value, dict) or key not in value:
                raise ValidationError("SCHEMA_REQUIRED_FIELD", f"missing {path}.{key}")

    for field in document["fieldLedger"]:
        for key in ["fieldId", "name", "type", "sourceClass", "status", "requiredBefore", "inferencePolicy", "protected"]:
            if key not in field:
                raise ValidationError("SCHEMA_FIELD_REQUIRED", key)
        if field["sourceClass"] not in expected_classes:
            raise ValidationError("SCHEMA_FIELD_CLASS", field["fieldId"])
        if field["requiredBefore"] not in expected_milestones:
            raise ValidationError("SCHEMA_FIELD_MILESTONE", field["fieldId"])

    for block in document["compilation"]["selectedBlocks"]:
        for key in ["blockId", "blockDigest", "status", "sourceStatus", "authorityEffectGrants"]:
            if key not in block:
                raise ValidationError("SCHEMA_BLOCK_REQUIRED", key)


def field_index(document: dict) -> dict:
    fields = document["fieldLedger"]
    ids = [field.get("fieldId") for field in fields]
    if any(not field_id for field_id in ids) or len(ids) != len(set(ids)):
        raise ValidationError("DUPLICATE_FIELD_ID", "field IDs must be unique")
    return {field["fieldId"]: field for field in fields}


def condition_value(rule: dict, fields: dict):
    when = rule["when"]
    field_id = when["fieldId"]
    if field_id not in fields:
        return "unknown"
    field = fields[field_id]
    if field.get("status") != "resolved":
        return "unknown"
    value = field.get("value")
    if "equals" in when:
        return value == when["equals"]
    if "notEquals" in when:
        return value != when["notEquals"]
    if "exists" in when:
        return (field.get("value") is not None) == when["exists"]
    return "unknown"


def require_resolved(fields: dict, field_ids: list[str], code: str) -> None:
    for field_id in field_ids:
        if field_id not in fields:
            raise ValidationError(code, f"required field is absent: {field_id}")
        if fields[field_id].get("status") != "resolved":
            raise ValidationError(code, f"required field is unresolved: {field_id}")


def semantic_check(document: dict) -> None:
    fields = field_index(document)
    constraints = document["constraints"]
    compilation = document["compilation"]
    requested_actions = set(compilation["requestedActions"])
    allowed_actions = set(constraints["authorityCeiling"]["allowedActions"])
    forbidden_actions = set(constraints["forbiddenActions"]) | set(
        constraints["authorityCeiling"]["forbiddenActions"]
    )
    stage_number = MILESTONES[compilation["stage"]]

    require_resolved(fields, constraints["requiredFields"], "REQUIRED_FIELD_UNRESOLVED")

    for contradiction in constraints["contradictions"]:
        if contradiction["status"] == "unresolved" and compilation["status"] == "compile_ready":
            raise ValidationError(
                "UNRESOLVED_CONTRADICTION",
                contradiction["contradictionId"],
            )

    for rule in constraints["conditionalRules"]:
        result = condition_value(rule, fields)
        if result == "unknown":
            raise ValidationError("CONDITION_UNKNOWN", rule["ruleId"])
        branch = rule["then"] if result else rule.get("else", {})
        require_resolved(fields, branch.get("requireFields", []), "CONDITIONAL_FIELD_UNRESOLVED")
        if requested_actions.intersection(set(branch.get("forbidActions", []))):
            raise ValidationError("CONDITIONAL_ACTION_FORBIDDEN", rule["ruleId"])

    for field in fields.values():
        required_before = MILESTONES[field["requiredBefore"]]
        if (
            field.get("protected")
            and field.get("status") != "resolved"
            and requested_actions.intersection(SIDE_EFFECT_ACTIONS)
            and required_before <= stage_number
        ):
            raise ValidationError(
                "MISSING_PROTECTED_DECISION",
                field["fieldId"],
            )
        if (
            field["sourceClass"] == "prohibited_to_infer"
            and field.get("status") == "resolved"
        ):
            raise ValidationError("PROHIBITED_FIELD_INFERRED", field["fieldId"])

    if compilation["status"] == "compile_ready":
        if not requested_actions.issubset(allowed_actions):
            extra = sorted(requested_actions - allowed_actions)
            raise ValidationError("AUTHORITY_ESCALATION", ",".join(extra))
        if requested_actions.intersection(forbidden_actions):
            blocked = sorted(requested_actions.intersection(forbidden_actions))
            raise ValidationError("AUTHORITY_ESCALATION", ",".join(blocked))

    for block in compilation["selectedBlocks"]:
        if block["authorityEffectGrants"]:
            raise ValidationError(
                "AUTHORITY_ESCALATION",
                f"block grant: {block['blockId']}",
            )
        if compilation["status"] == "compile_ready" and (
            block["status"] != "current" or block["sourceStatus"] != "current"
        ):
            raise ValidationError("STALE_BLOCK", block["blockId"])

    projected = compilation["projectedContextTokens"]
    local_max = compilation["maxContextTokens"]
    ceiling_max = constraints["authorityCeiling"]["maxContextTokens"]
    if projected > local_max or projected > ceiling_max:
        raise ValidationError(
            "CONTEXT_BUDGET_OVERFLOW",
            f"{projected}>{min(local_max, ceiling_max)}",
        )

    unresolved = set(compilation["unresolvedFields"])
    actual_unresolved = {
        field_id for field_id, field in fields.items() if field.get("status") != "resolved"
    }
    if unresolved != actual_unresolved:
        raise ValidationError("UNRESOLVED_FIELD_LEDGER_MISMATCH", "compilation ledger mismatch")

    lifecycle = document["lifecycle"]
    if lifecycle["activation"] == "active" or lifecycle["admission"] == "admitted":
        raise ValidationError("CANDIDATE_ONLY_VIOLATION", "fixture is activated or admitted")


def validate_fixture(schema: dict, path: Path) -> tuple[bool, str]:
    try:
        document = load_json(path)
        structural_check(schema, document)
        semantic_check(document)
        return True, "accepted"
    except ValidationError as error:
        return False, f"{error.code}: {error.message}"


def main() -> int:
    schema = load_json(SCHEMA_PATH)
    fixture_paths = sorted(FIXTURE_DIR.glob("*.json"))
    if not fixture_paths:
        print("FAIL NO_FIXTURES")
        return 1

    failures = 0
    expected_cases = set(EXPECTED_FAILURES)
    actual_cases = {path.name for path in fixture_paths}
    if not expected_cases.issubset(actual_cases):
        print("FAIL MISSING_EXPECTED_FIXTURE")
        return 1

    for path in fixture_paths:
        accepted, detail = validate_fixture(schema, path)
        if path.name == "valid-task-ir.json":
            if accepted:
                print(f"PASS {path.name}: accepted")
            else:
                print(f"FAIL {path.name}: {detail}")
                failures += 1
            continue

        expected_code = EXPECTED_FAILURES.get(path.name)
        if accepted:
            print(f"FAIL {path.name}: accepted but expected {expected_code}")
            failures += 1
        elif not detail.startswith(expected_code + ":"):
            print(f"FAIL {path.name}: got {detail}, expected {expected_code}")
            failures += 1
        else:
            print(f"PASS {path.name}: rejected [{expected_code}]")

    expected_total = 1 + len(EXPECTED_FAILURES)
    if failures:
        print(f"RESULT FAIL {failures}/{expected_total} cases failed")
        return 1
    print(f"RESULT PASS {expected_total}/{expected_total} deterministic cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
