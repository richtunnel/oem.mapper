/**
 * Source-adapter interface (SPEC §2: "you would write a separate adapter for each
 * supported source format").
 *
 * An adapter is the ONLY place that understands an external estimate format. It
 * returns the normalized internal estimate validated by estimate.schema.js.
 * Everything downstream (mapping, impact matrix, decisions) is format-agnostic —
 * that is what lets a new estimating platform be added without touching the
 * decision logic.
 *
 * @typedef {Object} SourceAdapter
 * @property {string} id                    Stable adapter id, e.g. "structured-json".
 * @property {string} name                  Human-readable name.
 * @property {boolean} implemented          False for adapters that throw NotImplementedError.
 * @property {string[]} contentTypes        MIME types this adapter claims.
 * @property {string[]} extensions          File extensions this adapter claims.
 * @property {(input: unknown) => boolean} canHandle
 * @property {(input: unknown) => {format: string, estimate: object, warnings: object[]}} parse
 */
export class SourceAdapterBase {
  constructor({ id, name, contentTypes = [], extensions = [], implemented = true }) {
    this.id = id;
    this.name = name;
    this.contentTypes = contentTypes;
    this.extensions = extensions;
    this.implemented = implemented;
  }

  /** @returns {boolean} */
  canHandle() {
    return false;
  }

  /** @param {unknown} input */
  parse() {
    throw new Error(`${this.constructor.name}.parse() must be implemented.`);
  }

  matchesFile({ contentType, filename }) {
    const type = String(contentType ?? "").split(";")[0].trim().toLowerCase();
    const ext = String(filename ?? "").toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    return this.contentTypes.includes(type) || (!!ext && this.extensions.includes(ext));
  }

  describe() {
    return {
      id: this.id,
      name: this.name,
      implemented: this.implemented,
      contentTypes: this.contentTypes,
      extensions: this.extensions,
    };
  }
}
