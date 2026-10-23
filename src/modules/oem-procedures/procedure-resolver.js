/**
 * Procedure resolver: given a vehicle key, component and operation, return the
 * candidate rules. It performs APPLICABILITY only — it never evaluates conditions
 * and never returns a decision. That separation is what lets the decision engine
 * be tested against synthetic rules without touching the data files.
 */
import { loadProcedureCatalog, normalizeRule } from "./oem.repository.js";

export class ProcedureResolver {
  constructor({ rules, provenance = null } = {}) {
    this.rules = rules ?? [];
    this.provenance = provenance;
  }

  static fromSeedData() {
    const { rules, provenance } = loadProcedureCatalog();
    return new ProcedureResolver({ rules, provenance });
  }

  /** Rules declaring the given vehicleKey (rules for other vehicles are never mixed in). */
  rulesForVehicle(vehicleKey) {
    return this.rules.filter((rule) => rule.vehicleKey === vehicleKey);
  }

  /**
   * Applicability filter: vehicleKey + triggerComponent + operations (+ optional procedure type).
   * @returns {{applicable: object[], vehicleKeyKnown: boolean}}
   */
  findApplicableRules({ vehicleKey, componentId, operation, procedureType = null }) {
    const forVehicle = this.rulesForVehicle(vehicleKey);
    const applicable = forVehicle.filter((rule) => {
      if (rule.triggerComponent !== componentId) return false;
      if (!rule.operations.includes(operation)) return false;
      if (procedureType && rule.applicabilityProcedureType && rule.applicabilityProcedureType !== procedureType) return false;
      return true;
    });
    return { applicable, vehicleKeyKnown: forVehicle.length > 0 || this.vehicleKeyInCatalog(vehicleKey) };
  }

  vehicleKeyInCatalog(vehicleKey) {
    return this.rules.some((rule) => rule.vehicleKey === vehicleKey);
  }

  /** All rule ids, for coverage reporting. */
  catalogSize() {
    return this.rules.length;
  }

  get verifiedRuleCount() {
    return this.rules.filter((rule) => rule.verified).length;
  }
}

/** Build a resolver from an in-memory rule list (used by tests with test doubles). */
export function createResolver(rules) {
  return new ProcedureResolver({ rules: rules.map(normalizeRule), provenance: { label: "TEST_DOUBLE", verified: false } });
}
