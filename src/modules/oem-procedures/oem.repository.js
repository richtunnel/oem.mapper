/**
 * Dataset loader + honest provenance.
 *
 * Every dataset in src/data carries a `_provenance` block. This module refuses to
 * load a dataset that claims to be verified, so an unverified catalogue cannot
 * quietly become "real data" by editing a JSON file: promote a rule only by
 * following docs/OEM-DATA.md, which also requires updating this check.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AppError } from "../../shared/errors.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

function loadDataset(filename) {
  const path = join(DATA_DIR, filename);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const provenance = parsed._provenance ?? {};
  if (provenance.verified === true) {
    throw new AppError(
      `Dataset ${filename} claims verified data, which is not permitted while no legitimate OEM source exists.`,
      { code: "UNVERIFIED_DATASET_GUARD", statusCode: 500, details: { filename, provenance } },
    );
  }
  return { parsed, provenance };
}

export function loadComponentCatalog() {
  const { parsed, provenance } = loadDataset("components.json");
  const components = (parsed.components ?? []).map((component) => ({
    id: component.id,
    displayName: component.displayName ?? component.id,
    aliases: Array.isArray(component.aliases) ? component.aliases : [],
    systems: Array.isArray(component.systems) ? component.systems : [],
    nearbySensors: Array.isArray(component.nearbySensors) ? component.nearbySensors : [],
    position: component.position ?? "UNSPECIFIED",
    illustrative: component.illustrative !== false,
  }));

  const sensors = (parsed.sensors ?? []).map((sensor) => ({
    id: sensor.id,
    displayName: sensor.displayName ?? sensor.id,
    illustrative: sensor.illustrative !== false,
  }));

  assertUniqueIds(components, "component catalog", "components.json");
  return { components, sensors, provenance };
}

export function loadProcedureCatalog() {
  const { parsed, provenance } = loadDataset("oem-procedures.json");
  const rules = (parsed.rules ?? []).map(normalizeRule);

  assertUniqueIds(rules, "procedure catalog", "oem-procedures.json");
  for (const rule of rules) {
    if (!rule.vehicleKey) {
      throw new AppError(`Rule ${rule.id} has no applicability.vehicleKey.`, {
        code: "INVALID_RULE",
        statusCode: 500,
        details: { ruleId: rule.id },
      });
    }
  }
  return { rules, provenance };
}

export function normalizeRule(raw) {
  return {
    id: raw.id,
    ruleStatus: raw.ruleStatus ?? "UNVERIFIED",
    verified: raw.verified === true && raw.ruleStatus === "VERIFIED",
    procedure: raw.procedure,
    procedureType: raw.procedureType ?? null,
    description: raw.description ?? null,
    vehicleKey: raw.applicability?.vehicleKey ?? raw.vehicleKey ?? null,
    triggerComponent: raw.applicability?.triggerComponent ?? raw.triggerComponent ?? null,
    operations: raw.applicability?.operations ?? raw.operations ?? [],
    applicabilityProcedureType: raw.applicability?.procedureType ?? null,
    logic: (raw.logic ?? "ANY").toUpperCase(),
    conditions: Array.isArray(raw.conditions) ? raw.conditions.map(normalizeCondition) : [],
    reason: raw.reason ?? "",
    evidenceRequired: raw.evidenceRequired ?? [],
    source: {
      documentId: raw.source?.documentId ?? null,
      revision: raw.source?.revision ?? null,
      section: raw.source?.section ?? null,
      fictional: raw.source?.fictional !== false,
    },
  };
}

function normalizeCondition(condition) {
  return {
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
    label: condition.label ?? null,
  };
}

/** Every seed rule and component must be unique — a silent duplicate would change a decision. */
function assertUniqueIds(items, label, filename) {
  const seen = new Set();
  for (const item of items) {
    if (!item.id) throw new AppError(`Entry without id in ${filename}.`, { code: "INVALID_DATASET" });
    if (seen.has(item.id)) {
      throw new AppError(`Duplicate id "${item.id}" in ${label}.`, { code: "INVALID_DATASET", details: { filename, id: item.id } });
    }
    seen.add(item.id);
  }
}
