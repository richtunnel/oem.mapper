import { NotImplementedError, ValidationError } from "../../../shared/errors.js";
import { JsonEstimateAdapter } from "./json-estimate.adapter.js";
import { UNIMPLEMENTED_ADAPTERS } from "./unimplemented.adapter.js";

/**
 * Adapter registry. One working adapter, three explicitly-not-implemented ones.
 * Detection order matters: a supported adapter wins; an unsupported-but-known
 * format fails with NOT_IMPLEMENTED (501) rather than a generic 400.
 */
export const jsonEstimateAdapter = new JsonEstimateAdapter();

export const ALL_ADAPTERS = Object.freeze([jsonEstimateAdapter, ...UNIMPLEMENTED_ADAPTERS]);

export function listAdapters() {
  return ALL_ADAPTERS.map((adapter) => adapter.describe());
}

/** Pick an adapter for a request body or uploaded file. */
export function selectAdapter({ contentType = null, filename = null, input = null } = {}) {
  for (const adapter of UNIMPLEMENTED_ADAPTERS) {
    if (adapter.matchesFile({ contentType, filename })) return adapter;
  }
  if (jsonEstimateAdapter.matchesFile({ contentType, filename }) || jsonEstimateAdapter.canHandle(input)) {
    return jsonEstimateAdapter;
  }
  if (contentType) {
    throw new ValidationError(
      `No source adapter can handle content type "${contentType}".`,
      { supported: listAdapters().filter((a) => a.implemented) },
    );
  }
  throw new ValidationError(
    "Request body must be a structured JSON estimate object (SPEC §2) or a JSON file upload.",
    { supported: listAdapters().filter((a) => a.implemented) },
  );
}

export { NotImplementedError };
