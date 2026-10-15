/**
 * Vehicle resolution — deliberately limited in this MVP.
 *
 * The spec's route sketch (SPEC §6) returns 422 whenever `vehicle.verified` is
 * false. Taken literally that would make this MVP answer nothing, because a VIN
 * decode / configuration provider is explicitly out of scope and no data in this
 * repository is verified. So this module NEVER claims verification:
 *
 *   - it derives a deterministic `vehicleKey` from year/make/model/trim,
 *   - it reports `configurationVerified: false` plus the reason and the facts it
 *     could NOT check,
 *   - it does not gate the pipeline. The report carries the unverified status
 *     into every decision instead, where it stays visible (hard constraint #1).
 *
 * VIN decoding, trim/fitment resolution and sensor-package verification are a
 * later delegation; the seams for them are the fields returned here.
 */
import { buildVehicleKey, normalizeText } from "../../shared/text.js";

export const VEHICLE_RESOLUTION = Object.freeze({
  DERIVED_FROM_ESTIMATE: "DERIVED_FROM_ESTIMATE",
  DECLARED_ON_ESTIMATE: "DECLARED_ON_ESTIMATE",
  UNRESOLVED: "UNRESOLVED",
});

export function resolveVehicle(vehicle) {
  const missingFields = [];
  const unchecked = [
    "VIN-decode provider (no provider is integrated in this MVP)",
    "Trim / sensor-package verification",
    "OEM part-catalog fitment",
  ];

  if (!vehicle) {
    return {
      status: VEHICLE_RESOLUTION.UNRESOLVED,
      vehicleKey: null,
      configurationVerified: false,
      reason: "The estimate did not contain a vehicle object.",
      missingFields: ["vehicle"],
      unchecked,
      vinDecoded: false,
    };
  }

  const derivedKey = buildVehicleKey(vehicle);
  const vehicleKey = vehicle.vehicleKey ?? derivedKey;

  if (!vehicleKey) {
    for (const field of ["year", "make", "model"]) {
      if (!vehicle[field]) missingFields.push(`vehicle.${field}`);
    }
    return {
      status: VEHICLE_RESOLUTION.UNRESOLVED,
      vehicleKey: null,
      configurationVerified: false,
      reason:
        `Cannot derive a vehicle key: ${missingFields.join(", ")} missing and no vehicle.vehicleKey supplied. ` +
        "Rule applicability is keyed on the vehicle configuration, so no rule can be applied.",
      missingFields,
      unchecked,
      vinDecoded: false,
    };
  }

  const status = vehicle.vehicleKey
    ? VEHICLE_RESOLUTION.DECLARED_ON_ESTIMATE
    : VEHICLE_RESOLUTION.DERIVED_FROM_ESTIMATE;

  return {
    status,
    // Key format is `<MAKE>-<YEAR>-<MODEL>` (see buildVehicleKey in shared/text.js).
    // `normalizeText` strips punctuation, so the separator has to be re-applied as a
    // hyphen — anything else (e.g. "_") silently stops the key matching the rule
    // library, and every line becomes a false "no rule" coverage gap.
    vehicleKey: normalizeText(vehicleKey).replace(/ /g, "-").toUpperCase(),
    configurationVerified: false,
    reason:
      status === VEHICLE_RESOLUTION.DECLARED_ON_ESTIMATE
        ? "vehicleKey was supplied on the estimate and taken at face value; it has not been checked against a VIN or a vehicle configuration provider."
        : "vehicleKey was derived from the estimate's year/make/model. It has not been checked against a VIN, trim, or sensor-package provider.",
    unmatchedInput: vehicle.trim ? [`trim "${vehicle.trim}" was ignored when deriving the vehicleKey (trim resolution is out of scope in this MVP)`] : [],
    missingFields,
    unchecked,
    vinDecoded: false,
  };
}
