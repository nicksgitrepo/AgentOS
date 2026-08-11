#!/usr/bin/env python3
"""Deterministic semantic validator for candidate context-block fixtures.

This is a local fail-closed companion to context-block.schema.json. It checks
the packaging invariants that JSON Schema alone cannot express, without
claiming domain utility, safety certification, admission, or activation.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "context-block.schema.json"
FIXTURE_DIR = ROOT / "fixtures" / "context-block"

EXPECTED_FAILURES = {
    "invalid-authority-grants.json": "AUTHORITY_GRANTS_NONEMPTY",
    "invalid-stale-source.json": "STALE_SOURCE",
    "invalid-missing-provenance.json": "PROVENANCE_MISSING",
    "invalid-missing-scope.json": "SCOPE_MISSING",
    "invalid-missing-version.json": "VERSION_MISSING",
    "invalid-missing-digest.json": "DIGEST_MISSING",
    "invalid-duplicate-claim-id.json": "DUPLICATE_CLAIM_ID",
    "invalid-lifecycle-admitted.json": "LIFECYCLE_CANDIDATE_ONLY",
    "invalid-secrets-allowed.json": "SECURITY_SECRET_PROHIBITED",
    "invalid-protected-data.json": "PROTECTED_DATA_PROHIBITED",
    "invalid-budget-overflow.json": "BUDGET_OVERFLOW",
    "invalid-progressive-loading.json": "PROGRESSIVE_LOADING_BOUNDARY",
}

REQUIRED_TOP_LEVEL = {
    "schemaVersion",
    "blockId",
    "blockClass",
    "revision",
    "lifecycleState",
    "purpose",
    "scope",
    "claims",
    "authorityEffect",
    "loading",
    "provenance",
    "refresh",
    "evaluation",
    "security",
}
CURRENT_SOURCE_STATUSES = {"current"}
CANDIDATE_LIFECYCLES = {"candidate", "research_memo"}
PROTECTED_DATA_MARKERS = {
    "secret",
    "secrets",
    "credential",
    "credentials",
    "token",
    "tokens",
    "password",
    "personal_data",
    "regulated_data",
    "protected_data",
    "pii",
}
DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")


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
    if schema.get("properties", {}).get("schemaVersion", {}).get("const") != "context-block.v0.1":
        raise ValidationError("SCHEMA_CONTRACT_DRIFT", "schema version contract drifted")
    schema_required = set(schema.get("required", []))
    if not REQUIRED_TOP_LEVEL.issubset(schema_required):
        raise ValidationError("SCHEMA_CONTRACT_DRIFT", "required top-level contract drifted")
    budget_required = set(
        schema.get("$defs", {})
        .get("loading", {})
        .get("properties", {})
        .get("budget", {})
        .get("required", [])
    )
    if "maxTokens" not in budget_required:
        raise ValidationError("SCHEMA_CONTRACT_DRIFT", "budget maxTokens is not required")
    if "secretsAllowed" not in set(
        schema.get("$defs", {}).get("security", {}).get("required", [])
    ):
        raise ValidationError("SCHEMA_CONTRACT_DRIFT", "security declaration is not required")

    if document.get("schemaVersion") != "context-block.v0.1":
        raise ValidationError("SCHEMA_VERSION_MISMATCH", "fixture schemaVersion is not context-block.v0.1")
    missing = REQUIRED_TOP_LEVEL - set(document)
    if missing:
        raise ValidationError("SCHEMA_REQUIRED_FIELD", ",".join(sorted(missing)))

    revision = document.get("revision")
    if not isinstance(revision, dict) or not revision.get("version"):
        raise ValidationError("VERSION_MISSING", "revision.version")
    if not isinstance(revision.get("contentDigest"), str):
        raise ValidationError("DIGEST_MISSING", "revision.contentDigest")

    scope = document.get("scope")
    if not isinstance(scope, dict) or not scope.get("include"):
        raise ValidationError("SCOPE_MISSING", "block scope.include")

    provenance = document.get("provenance")
    if not isinstance(provenance, dict) or not provenance.get("sourceRecords"):
        raise ValidationError("PROVENANCE_MISSING", "provenance.sourceRecords")


def require_scope(value: object, location: str) -> None:
    if not isinstance(value, dict) or not isinstance(value.get("include"), list) or not value["include"]:
        raise ValidationError("SCOPE_MISSING", location)


def require_digest(value: object, location: str) -> None:
    if not isinstance(value, str) or not DIGEST_RE.fullmatch(value):
        raise ValidationError("DIGEST_MISSING", location)


def require_version(value: object, location: str) -> None:
    if not isinstance(value, str) or not VERSION_RE.fullmatch(value):
        raise ValidationError("VERSION_MISSING", location)


def unique_entity_ids(document: dict) -> None:
    collections = [
        ("claims", "claimId", "DUPLICATE_CLAIM_ID"),
        ("provenance.sourceRecords", "sourceId", "DUPLICATE_SOURCE_ID"),
        ("resources", "resourceId", "DUPLICATE_RESOURCE_ID"),
        ("requirements", "requirementId", "DUPLICATE_REQUIREMENT_ID"),
        ("prohibitions", "prohibitionId", "DUPLICATE_PROHIBITION_ID"),
        ("procedures", "procedureId", "DUPLICATE_PROCEDURE_ID"),
        ("inputs", "fieldId", "DUPLICATE_FIELD_ID"),
        ("outputs", "fieldId", "DUPLICATE_FIELD_ID"),
        ("handoffs", "handoffId", "DUPLICATE_HANDOFF_ID"),
    ]
    for path, key, code in collections:
        value = document
        for part in path.split("."):
            value = value.get(part, []) if isinstance(value, dict) else []
        ids = [item.get(key) for item in value if isinstance(item, dict)]
        if any(not item_id for item_id in ids) or len(ids) != len(set(ids)):
            raise ValidationError(code, path)


def semantic_check(document: dict) -> None:
    revision = document["revision"]
    require_version(revision.get("version"), "revision.version")
    require_digest(revision.get("contentDigest"), "revision.contentDigest")
    require_scope(document.get("scope"), "block scope")

    provenance = document["provenance"]
    sources = provenance.get("sourceRecords")
    if not isinstance(sources, list) or not sources:
        raise ValidationError("PROVENANCE_MISSING", "provenance.sourceRecords")
    source_ids = set()
    for source in sources:
        source_id = source.get("sourceId")
        source_ids.add(source_id)
        require_digest(source.get("digest"), f"source:{source_id}.digest")
        if source.get("status") not in CURRENT_SOURCE_STATUSES:
            raise ValidationError("STALE_SOURCE", str(source_id))
        if source.get("authorityClass") != "owner_intent":
            require_version(source.get("version"), f"source:{source_id}.version")

    unique_entity_ids(document)

    for claim in document.get("claims", []):
        require_scope(claim.get("scope"), f"claim:{claim.get('claimId')}.scope")
        source_refs = claim.get("sourceRefs")
        if not source_refs:
            raise ValidationError("PROVENANCE_MISSING", f"claim:{claim.get('claimId')}.sourceRefs")
        for source_ref in source_refs:
            if source_ref.get("refId") not in source_ids:
                raise ValidationError("PROVENANCE_MISSING", f"claim:{claim.get('claimId')}.sourceRefs")

    authority_effect = document["authorityEffect"]
    if authority_effect.get("grants") != []:
        raise ValidationError("AUTHORITY_GRANTS_NONEMPTY", "context blocks cannot grant capabilities")

    if document.get("lifecycleState") not in CANDIDATE_LIFECYCLES:
        raise ValidationError("LIFECYCLE_CANDIDATE_ONLY", str(document.get("lifecycleState")))

    security = document.get("security")
    if not isinstance(security, dict) or "secretsAllowed" not in security:
        raise ValidationError("SECURITY_DECLARATION_MISSING", "security.secretsAllowed")
    if security.get("secretsAllowed") is not False:
        raise ValidationError("SECURITY_SECRET_PROHIBITED", "security.secretsAllowed must be false")
    data_classes = {str(value).lower() for value in security.get("dataClasses", [])}
    if data_classes.intersection(PROTECTED_DATA_MARKERS):
        raise ValidationError("PROTECTED_DATA_PROHIBITED", "security.dataClasses")
    for collection_name in ("resources", "inputs", "outputs"):
        for item in document.get(collection_name, []):
            if item.get("redaction") in {"secret", "personal_data", "regulated_data"}:
                raise ValidationError("PROTECTED_DATA_PROHIBITED", f"{collection_name}:{item.get('resourceId', item.get('fieldId'))}")

    loading = document["loading"]
    budget = loading["budget"]
    token_fields = ("summaryTokens", "instructionTokens", "resourceTokens")
    if any(not isinstance(budget.get(key), int) or budget[key] < 0 for key in token_fields):
        raise ValidationError("BUDGET_INVALID", "loading.budget")
    if not isinstance(budget.get("maxTokens"), int) or budget["maxTokens"] < 1:
        raise ValidationError("BUDGET_INVALID", "loading.budget.maxTokens")
    total = sum(budget[key] for key in token_fields)
    if total > budget["maxTokens"]:
        raise ValidationError("BUDGET_OVERFLOW", f"{total}>{budget['maxTokens']}")

    resources = document.get("resources", [])
    resource_ids = {item.get("resourceId") for item in resources}
    lazy_resources = loading.get("lazyResources", [])
    if budget["resourceTokens"] > 0 and not lazy_resources:
        raise ValidationError("PROGRESSIVE_LOADING_BOUNDARY", "resource budget has no lazy resources")
    if lazy_resources and budget["resourceTokens"] == 0:
        raise ValidationError("PROGRESSIVE_LOADING_BOUNDARY", "lazy resources have no resource budget")
    if any(reference.get("refId") not in resource_ids for reference in lazy_resources):
        raise ValidationError("PROGRESSIVE_LOADING_BOUNDARY", "lazy resource reference is unresolved")


def validate_fixture(schema: dict, path: Path) -> tuple[bool, str]:
    try:
        structural_check(schema, load_json(path))
        document = load_json(path)
        semantic_check(document)
        return True, "accepted"
    except ValidationError as error:
        return False, f"{error.code}: {error.message}"


def main() -> int:
    try:
        schema = load_json(SCHEMA_PATH)
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        print(f"FAIL SCHEMA_LOAD {error}")
        return 1

    fixture_paths = sorted(FIXTURE_DIR.glob("*.json"))
    if not fixture_paths:
        print("FAIL NO_FIXTURES")
        return 1
    actual_cases = {path.name for path in fixture_paths}
    if not set(EXPECTED_FAILURES).issubset(actual_cases):
        print("FAIL MISSING_EXPECTED_FIXTURE")
        return 1

    failures = 0
    for path in fixture_paths:
        accepted, detail = validate_fixture(schema, path)
        if path.name == "valid-context-block.json":
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
        print(f"RESULT FAIL {failures}/{expected_total} context-block cases failed")
        return 1
    print(f"RESULT PASS {expected_total}/{expected_total} context-block semantic cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
