import { isKnownDate } from "@bomberoscr/lib/missing-date";

const LOCALE = "es-CR";

const PLACE_CONNECTORS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "e",
  "el",
  "en",
  "la",
  "las",
  "los",
  "por",
  "y"
]);

type IncidentLocation = {
  districtName: string | null;
  cantonName: string | null;
  provinceName: string | null;
};

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase(LOCALE) + word.slice(1);
}

// SIGAE sends text in upper case; abbreviations ("C.C.") and unit numbers ("M-128") must keep it.
// Only a period followed by more text marks an abbreviation, so "TRANSITO." still lower-cases.
function isAcronymLike(word: string): boolean {
  return /\d|\.\S/.test(word);
}

/** "SAN RAFAEL DE ALAJUELA" -> "San Rafael de Alajuela". */
export function formatPlaceName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (isAcronymLike(word)) return word;
      const lower = word.toLocaleLowerCase(LOCALE);
      return index > 0 && PLACE_CONNECTORS.has(lower) ? lower : capitalize(lower);
    })
    .join(" ");
}

/** "INCENDIO EN C.C. DE LINEAS" -> "Incendio en C.C. de lineas". */
export function toSentenceCase(text: string): string {
  const sentence = text
    .trim()
    .split(/\s+/)
    .map((word) => (isAcronymLike(word) ? word : word.toLocaleLowerCase(LOCALE)))
    .join(" ");
  return capitalize(sentence);
}

/**
 * The page title as a sentence-case headline with proper-cased place names. Mirrors the
 * `<details> EN <district>, <canton>, <province>` shape `getIncidentTitle` builds.
 */
export function formatIncidentHeadline(title: string, location: IncidentLocation): string {
  const places = [location.districtName, location.cantonName, location.provinceName].filter(
    (place): place is string => Boolean(place)
  );
  const suffix = places.length > 0 ? ` EN ${places.join(", ")}` : "";

  if (suffix && title.endsWith(suffix) && title.length > suffix.length) {
    const base = title.slice(0, -suffix.length);
    return `${toSentenceCase(base)} en ${places.map(formatPlaceName).join(", ")}`;
  }

  return toSentenceCase(title);
}

/**
 * "17 min 8 s", "2 h 16 min", "45 s". Parts are joined with non-breaking spaces so a
 * duration never wraps across lines in running text.
 */
export function formatElapsed(totalSeconds: number, { withSeconds = true } = {}): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts =
    hours > 0
      ? [`${hours} h`, minutes > 0 ? `${minutes} min` : null]
      : minutes > 0
        ? [`${minutes} min`, withSeconds && secs > 0 ? `${secs} s` : null]
        : [`${secs} s`];

  return parts
    .filter((part) => part !== null)
    .join(" ")
    .replaceAll(" ", "\u00A0");
}

type ResponseTimeLike = {
  vehicle: string;
  station: string;
  arrivalTime: string | null;
  responseTimeSeconds: number;
};

/** The first unit to reach the scene, by arrival time. */
export function getFirstArrival<T extends ResponseTimeLike>(responseTimes: readonly T[]): T | null {
  let first: T | null = null;
  for (const vehicle of responseTimes) {
    if (!isKnownDate(vehicle.arrivalTime) || vehicle.responseTimeSeconds <= 0) continue;
    if (
      !first ||
      new Date(vehicle.arrivalTime).getTime() < new Date(first.arrivalTime ?? "").getTime()
    ) {
      first = vehicle;
    }
  }
  return first;
}

type TimelineEventLike = { id: string; date: string };

/** Seconds from the report to the close event, or `null` while the incident is open. */
export function getAttentionSeconds(
  incidentTimestamp: string,
  timeline: readonly TimelineEventLike[]
): number | null {
  const closed = timeline.find((event) => event.id.endsWith(":closed"));
  if (!closed) return null;
  const diff = (new Date(closed.date).getTime() - new Date(incidentTimestamp).getTime()) / 1000;
  return diff > 0 ? diff : null;
}

type DeckInput = {
  isOpen: boolean;
  stations: readonly { name: string; vehicles: readonly unknown[] }[];
  responseTimes: readonly ResponseTimeLike[];
  attentionSeconds: number | null;
};

/** The standfirst under the headline: who went, how fast, and for how long. */
export function buildIncidentDeck({
  isOpen,
  stations,
  responseTimes,
  attentionSeconds
}: DeckInput): string | null {
  const unitCount = stations.reduce((acc, station) => acc + station.vehicles.length, 0);
  if (unitCount === 0 || stations.length === 0) return null;

  const units = unitCount === 1 ? "una unidad" : `${unitCount.toLocaleString(LOCALE)} unidades`;
  const from =
    stations.length === 1
      ? `la estación ${formatPlaceName(stations[0]?.name ?? "")}`
      : `${stations.length.toLocaleString(LOCALE)} estaciones`;
  const sentences = [`${unitCount === 1 ? "Se despachó" : "Se despacharon"} ${units} de ${from}.`];

  const first = getFirstArrival(responseTimes);
  if (first) {
    const elapsed = formatElapsed(first.responseTimeSeconds);
    sentences.push(
      unitCount === 1
        ? `La ${first.vehicle} llegó a la escena ${elapsed} después del despacho.`
        : `La primera en llegar, la ${first.vehicle}, lo hizo ${elapsed} después del despacho.`
    );
  }

  if (!isOpen && attentionSeconds !== null) {
    sentences.push(
      `El incidente se cerró tras ${formatElapsed(attentionSeconds, { withSeconds: false })}.`
    );
  }

  return sentences.join(" ");
}
