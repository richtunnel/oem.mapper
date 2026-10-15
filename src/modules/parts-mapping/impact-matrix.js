/**
 * Impact matrix — repair line × affected sensors × affected systems (SPEC §3C).
 *
 * READ THIS BEFORE CONSUMING THE OUTPUT:
 * The matrix is a CANDIDATE GENERATOR. A row with sensors listed means the
 * relationship between that repair and those sensors needs evaluation. It does NOT
 * mean any calibration is required, and no consumer may render it as such. The
 * only component allowed to decide a procedure is the decision engine, from
 * explicit OEM rules with evidence.
 *
 * Lines that could not be matched uniquely still appear in the matrix
 * (matchStatus UNMATCHED/AMBIGUOUS, empty sensor list) so they cannot be dropped
 * from the report — dropping them is how "not required" gets invented by accident.
 */
import { MATCH_STATUS } from "../../shared/constants.js";
import { findComponent } from "./matcher.js";

export const MATRIX_NOTE =
  "Candidate generation only: a populated row means the repair-to-sensor relationship needs evaluation, not that a calibration or any other procedure is required.";

export function buildImpactMatrix(lines = [], components = [], { sensors = [] } = {}) {
  const sensorNames = new Map(sensors.map((sensor) => [sensor.id, sensor.displayName]));

  return lines.map((line) => {
    const match = findComponent(line.description, components);

    const base = {
      lineId: line.lineId,
      // Original shop wording is preserved verbatim (SPEC §9 step 2), alongside
      // the normalized form and the canonical component when we have one.
      originalDescription: line.description,
      normalizedDescription: match.normalizedDescription,
      operation: line.operation,
      position: line.position,
      partNumber: line.partNumber ?? null,
      matchStatus: match.status,
      matchConfidence: match.matchConfidence,
      componentId: match.componentId,
      component: null,
      affectedSensors: [],
      affectedSystems: [],
      candidateOnly: true,
      note: MATRIX_NOTE,
    };

    if (match.status !== MATCH_STATUS.MATCHED || !match.component) {
      return {
        ...base,
        matchReason: match.reason,
        candidates: match.candidates,
        reason: match.reason,
      };
    }

    const component = match.component;
    const affectedSensors = (component.nearbySensors ?? []).map((sensorId) => ({
      sensorId,
      displayName: sensorNames.get(sensorId) ?? sensorId,
      // The component matched IS the sensor for self-referencing components
      // (e.g. front_radar lists front_radar as a nearby sensor).
      isTriggerComponentItself: sensorId === component.id,
    }));

    return {
      ...base,
      component: {
        id: component.id,
        displayName: component.displayName,
        systems: component.systems,
        position: component.position,
        illustrative: component.illustrative !== false,
      },
      affectedSensors,
      affectedSystems: [...(component.systems ?? [])],
      matchReason: match.reason,
      reason: `Repair on "${component.id}" is potentially adjacent to ${affectedSensors.length} sensor(s): ${affectedSensors
        .map((sensor) => sensor.sensorId)
        .join(", ") || "none catalogued"}. Evaluation only — see the decision report for what any rule actually indicates.`,
    };
  });
}

/** Counts used by the report summary; deliberately describes matrix coverage, not requirements. */
export function summarizeImpactMatrix(matrix = []) {
  return {
    lines: matrix.length,
    matched: matrix.filter((row) => row.matchStatus === MATCH_STATUS.MATCHED).length,
    ambiguous: matrix.filter((row) => row.matchStatus === MATCH_STATUS.AMBIGUOUS).length,
    unmatched: matrix.filter((row) => row.matchStatus === MATCH_STATUS.UNMATCHED).length,
    linesCarryingSensors: matrix.filter((row) => row.affectedSensors.length > 0).length,
  };
}
