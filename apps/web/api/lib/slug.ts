// Regex patterns for slug generation
const locationPatternRegex = / EN [^,]+,/;
const diacriticRegex = /\p{M}/gu;
const specialCharRegex = /[^a-z0-9\s-]/g;
const multipleSpacesRegex = /\s+/g;
const multipleHyphensRegex = /-+/g;

/**
 * Converts a string to a URL-friendly slug.
 * Removes location information (EN ...), special characters, and formats for URLs.
 * Only removes location when "EN" is followed by a comma (indicating a place name).
 *
 * @example
 * createIncidentSlug("COLISION DE VEHICULO EN San José, Central, San José")
 * // "colision-de-vehiculo"
 *
 * @example
 * createIncidentSlug("RESCATE DE FELINO ATRAPADO EN MEDIO DE DOS PAREDES")
 * // "rescate-de-felino-atrapado-en-medio-de-dos-paredes"
 *
 * @example
 * createIncidentSlug("INCENDIO ESTRUCTURAL")
 * // "incendio-estructural"
 *
 * @param title - The incident title to convert to a slug.
 * @returns A URL-friendly slug without location information.
 */
export function createIncidentSlug(title: string): string {
  // Remove location part only if "EN" is followed by a comma pattern (e.g., "EN District, Canton, Province")
  // This preserves descriptions like "ATRAPADO EN MEDIO DE" while removing "EN San José, Central, San José"
  let titleWithoutLocation = title;

  if (locationPatternRegex.test(title)) {
    // Find the last occurrence of " EN " followed by comma-separated location
    const lastEnIndex = title.lastIndexOf(" EN ");
    if (lastEnIndex !== -1) {
      const afterEn = title.substring(lastEnIndex + 4);
      // Only remove if it contains a comma (location format)
      if (afterEn.includes(",")) {
        titleWithoutLocation = title.substring(0, lastEnIndex);
      }
    }
  }

  return titleWithoutLocation
    .toLowerCase()
    .normalize("NFD") // Decompose accented characters
    .replace(diacriticRegex, "") // Remove diacritics
    .replace(specialCharRegex, "") // Remove special characters
    .trim()
    .replace(multipleSpacesRegex, "-") // Replace spaces with hyphens
    .replace(multipleHyphensRegex, "-"); // Replace multiple hyphens with single hyphen
}

/**
 * Builds a link-ready incident slug in the format: {id}-{slug}-{yyyy-mm-dd}
 *
 * @example
 * buildIncidentSlug(1549092, "COLISION DE VEHICULO EN ...", new Date("2025-01-01"))
 * // "1549092-colision-de-vehiculo-2025-01-01"
 *
 * @param id - The incident ID.
 * @param title - The incident title (uses fallback if empty/null).
 * @param date - The incident date.
 * @returns A link-ready slug for the incident.
 */
export function buildIncidentSlug(id: number, title: string | null, date: Date): string {
  const slug = createIncidentSlug(title || "incidente");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const dateString = `${year}-${month}-${day}`;

  return `${id}-${slug}-${dateString}`;
}

/**
 * Builds a link-ready incident slug from partial incident data.
 * Uses importantDetails, specificIncidentType, or incidentType as fallback for title.
 *
 * @param incident - Partial incident data with id, incidentTimestamp, and optional title fields.
 * @returns A link-ready slug for the incident.
 */
export function buildIncidentSlugFromPartial(incident: {
  id: number;
  incidentTimestamp: Date;
  importantDetails?: string | null;
  specificIncidentType?: string | null;
  incidentType?: string | null;
}): string {
  const title =
    incident.importantDetails ||
    incident.specificIncidentType ||
    incident.incidentType ||
    "Incidente";
  return buildIncidentSlug(incident.id, title, incident.incidentTimestamp);
}
