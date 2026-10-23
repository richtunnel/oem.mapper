/**
 * Estimate service — the six-stage pipeline in one place (SPEC §1):
 *
 *   1 ingest (source adapter) → 2 normalize/validate → 3 resolve vehicle →
 *   4 map parts + build impact matrix → 5 evaluate OEM rules → 6 build report
 *
 * Extraction, mapping and decisioning stay separate modules: an LLM or a new
 * estimating platform can be added at stage 1-2 without touching stage 5, which is
 * where the auditable decisions live.
 */
import { ValidationError } from "../../shared/errors.js";
import { jsonEstimateAdapter, selectAdapter } from "./adapters/index.js";
import { loadComponentCatalog } from "../oem-procedures/oem.repository.js";
import { ProcedureResolver } from "../oem-procedures/procedure-resolver.js";
import { resolveVehicle } from "../vehicles/vehicle.service.js";
import { buildImpactMatrix } from "../parts-mapping/impact-matrix.js";
import { evaluateEstimate } from "../decision-engine/decision.service.js";
import { buildReport } from "../reports/report.service.js";

/** Build the default catalogs once and reuse them (seed data, read-only). */
export function createCatalogs() {
  const { components, sensors, provenance: componentProvenance } = loadComponentCatalog();
  const resolver = ProcedureResolver.fromSeedData();
  return {
    components,
    sensors,
    resolver,
    provenance: {
      components: componentProvenance,
      procedures: resolver.provenance,
      verifiedRuleCount: resolver.verifiedRuleCount,
    },
  };
}

const defaultCatalogs = createCatalogs();

/**
 * Analyse one structured JSON estimate.
 * @param {object|string|Buffer} input estimate object, JSON string, or uploaded JSON file buffer
 * @param {{catalogs?: object, adapter?: object, procedureType?: string|null}} options
 */
export function analyzeEstimate(input, options = {}) {
  const catalogs = options.catalogs ?? defaultCatalogs;
  const adapter = options.adapter ?? selectAdapter({ input, contentType: options.contentType ?? null, filename: options.filename ?? null });

  // 1-2. Ingest + normalize + validate. Validation failures throw ValidationError (400);
  // unimplemented formats throw NotImplementedError (501). We never partially parse.
  const { estimate, warnings } = adapter.parse(input);

  let flow = { estimate, warnings };
  if (adapter !== jsonEstimateAdapter && !adapter.implemented) {
    throw new ValidationError(`Adapter "${adapter.id}" is registered but not implemented.`, { adapter: adapter.id });
  }

  // 3. Vehicle configuration. Never claims verification; states what it could not check.
  const vehicle = resolveVehicle(estimate.vehicle);

  // 4. Parts mapping + impact matrix (candidate generation only).
  const impactMatrix = buildImpactMatrix(estimate.lines, catalogs.components, { sensors: catalogs.sensors });

  // 5. Deterministic rule evaluation. No LLM touches this step.
  const { decisions, coverageGaps, review } = evaluateEstimate({
    impactMatrix,
    lines: estimate.lines,
    vehicle,
    resolver: catalogs.resolver,
    procedureType: options.procedureType ?? null,
  });

  // 6. Auditable report.
  const report = buildReport({
    estimate,
    vehicle,
    impactMatrix,
    decisions,
    coverageGaps,
    review,
    warnings,
    provenance: catalogs.provenance,
  });

  return { estimate, vehicle, impactMatrix, decisions, coverageGaps, review, report, adapter: adapter.describe() };
}
