function isUndefinedDate(date?: Date | null): boolean {
  return !date || date.getFullYear() === 1;
}

function toIsoStringOrNull(date?: Date | null): string | null {
  return isUndefinedDate(date) ? null : (date?.toISOString() ?? null);
}

function formatListSpanish(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return items.join(", ");
}

function formatIncidentTypes(types: Array<string | null | undefined>, fallback?: string): string {
  const filtered = types.filter((item): item is string => Boolean(item));
  if (filtered.length === 0) {
    return fallback ?? "";
  }
  return formatListSpanish(filtered);
}

function getLocation(incident: {
  province?: { name: string } | null;
  canton?: { name: string } | null;
  district?: { name: string } | null;
}): string | undefined {
  if (incident.province && incident.canton && incident.district) {
    return `${incident.district.name}, ${incident.canton.name}, ${incident.province.name}`;
  }
  return undefined;
}

function getIncidentTitle(
  importantDetails: string | null,
  specificType: string | null | undefined,
  type: string | null | undefined,
  location?: {
    districtName: string | null;
    cantonName: string | null;
    provinceName: string | null;
  }
): string {
  const baseTitle = importantDetails || specificType || type || "Incidente";

  if (!location) return baseTitle;

  const { districtName, cantonName, provinceName } = location;

  const locationParts: string[] = [];
  if (districtName) locationParts.push(districtName);
  if (cantonName) locationParts.push(cantonName);
  if (provinceName) locationParts.push(provinceName);

  if (locationParts.length === 0) return baseTitle;

  return `${baseTitle} EN ${locationParts.join(", ")}`;
}

function calculateTimeDiffInSeconds(end?: Date | null, start?: Date | null): number {
  if (!end || !start || isUndefinedDate(end) || isUndefinedDate(start)) {
    return 0;
  }
  return Math.floor((end.getTime() - start.getTime()) / 1000);
}

export {
  calculateTimeDiffInSeconds,
  formatIncidentTypes,
  getIncidentTitle,
  getLocation,
  isUndefinedDate,
  toIsoStringOrNull
};
