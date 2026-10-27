import {
  ACCENTS,
  ACRONYMS,
  CANTONS,
  COMMON_PLACE_WORDS,
  DISTRICTS,
  PHRASES,
  PLACE_NAMES,
  PROPER_NOUNS,
  PROVINCES,
  STATION_NAMES,
  TYPOS
} from "@/lib/spelling/dictionary.gen";

const LOCALE = "es-CR";
const LETTERS = "A-ZÑÁÉÍÓÚÜ";
const WORD = new RegExp(`(?<![${LETTERS}])[${LETTERS}]+(?![${LETTERS}])`, "g");
const TOKEN = new RegExp(
  `^([^${LETTERS}]*)([${LETTERS}](?:[${LETTERS}'-]*[${LETTERS}])?)([^${LETTERS}]*)$`
);
// The longest place or station name the free-text matcher looks for, in words.
const MAX_NAME_WORDS = 6;

/** Words a name keeps in lower case: "Barrio San José de la Montaña". */
const CONNECTORS = new Set([
  "A",
  "AL",
  "CON",
  "DE",
  "DEL",
  "E",
  "EL",
  "EN",
  "LA",
  "LAS",
  "LOS",
  "O",
  "POR",
  "U",
  "UN",
  "UNA",
  "UNAS",
  "UNOS",
  "Y"
]);
const ARTICLES = new Set(["EL", "LA", "LAS", "LOS"]);
/** Words that may sit between ESTACION and the station's name. */
const STATION_INTRO = new Set(["BOMBEROS", "DE", "DEL", "EL", "LA"]);
/** One- and two-letter Spanish words, which a unit prefix ("M 74") never is. */
const SHORT_WORDS = new Set([
  "A",
  "AL",
  "DE",
  "E",
  "EL",
  "EN",
  "LA",
  "LE",
  "LO",
  "ME",
  "MI",
  "NI",
  "NO",
  "O",
  "SE",
  "SI",
  "SU",
  "TE",
  "TU",
  "U",
  "UN",
  "Y",
  "YA"
]);

type Token = { pre: string; core: string; post: string };

/** Upper case without acute accents or diaeresis; keeps Ñ, the way SIGAE writes. */
function toKey(text: string): string {
  return text
    .toLocaleUpperCase(LOCALE)
    .normalize("NFD")
    .replace(/(?!\u0303)\p{Mn}/gu, "")
    .normalize("NFC");
}

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase(LOCALE) + word.slice(1);
}

// Abbreviations ("C.C.") and unit numbers ("M-128") keep SIGAE's capitals. Only a period
// followed by more text marks an abbreviation, so "TRANSITO." still lower-cases.
function isAcronymLike(word: string): boolean {
  return /\d|\.\S/.test(word);
}

// Mixed-case text was typed by someone who already chose its spelling.
function isUpperCase(text: string): boolean {
  return text === text.toLocaleUpperCase(LOCALE);
}

function spell(part: string, cased: (word: string) => string): string {
  return ACRONYMS[part] ?? cased((ACCENTS[part] ?? part).toLocaleLowerCase(LOCALE));
}

function lowerWord(key: string): string {
  return key
    .split("-")
    .map((part) => spell(part, (word) => word))
    .join("-");
}

function titleWord(key: string, first = true): string {
  if (!first && CONNECTORS.has(key)) return key.toLocaleLowerCase(LOCALE);
  return key
    .split("-")
    .map((part) => spell(part, capitalize))
    .join("-");
}

function detailWord(key: string): string {
  return PROPER_NOUNS.has(key) ? titleWord(key) : lowerWord(key);
}

/** Words of `text`, each split from its punctuation; a string for anything else ("C.C."). */
function tokenize(text: string): (Token | string)[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      if (isAcronymLike(raw)) return raw;
      const match = TOKEN.exec(raw);
      if (!match) return raw;
      return { pre: match[1] ?? "", core: match[2] ?? "", post: match[3] ?? "" };
    });
}

/** Text that is not one clean word ("AYA/ICE") still gets accents and acronyms. */
function formatLiteral(raw: string, format: (key: string) => string): string {
  if (isAcronymLike(raw)) return raw;
  return raw.replace(WORD, (word) => format(word));
}

/** Title case for names: "BARRIO SAN JOSE" -> "Barrio San José". */
function toTitleCase(text: string): string {
  return tokenize(toKey(text))
    .map((token, index) =>
      typeof token === "string"
        ? formatLiteral(token, (word) => titleWord(word, index === 0))
        : `${token.pre}${titleWord(token.core, index === 0)}${token.post}`
    )
    .join(" ");
}

export function formatProvinceName(name: string): string {
  return PROVINCES[toKey(name.trim())] ?? toTitleCase(name);
}

export function formatCantonName(name: string): string {
  return CANTONS[toKey(name.trim())] ?? toTitleCase(name);
}

/** Several cantons share district names spelled differently, so the canton picks the spelling. */
export function formatDistrictName(name: string, cantonName: string | null): string {
  const key = toKey(name.trim());
  const inCanton = cantonName ? DISTRICTS[`${toKey(cantonName.trim())}|${key}`] : undefined;
  return inCanton ?? PLACE_NAMES[key] ?? toTitleCase(name);
}

/** "AEROPUERTO JUAN SANTAMARIA" -> "Aeropuerto Juan Santamaría". */
export function formatStationName(name: string): string {
  if (!isUpperCase(name)) return name.trim();
  return PLACE_NAMES[toKey(name.trim())] ?? toTitleCase(name);
}

/**
 * A free-text address in title case: it is mostly business and landmark names, which no
 * table can tell apart from ordinary words. Typos are never corrected here: too many names
 * look like them.
 */
export function formatAddress(address: string): string {
  if (!isUpperCase(address)) return address.trim();
  return toTitleCase(address);
}

/** An incident type for running text: "C.C. EN ALUMBRADO PUBLICO" -> "C.C. en alumbrado público". */
export function formatTypeName(name: string): string {
  if (!isUpperCase(name)) return name.trim();
  return tokenize(toKey(name))
    .map((token) =>
      typeof token === "string"
        ? formatLiteral(token, lowerWord)
        : `${token.pre}${lowerWord(token.core)}${token.post}`
    )
    .join(" ");
}

function fixTyposAndPhrases(text: string): string {
  let fixed = toKey(text).replace(WORD, (word) => TYPOS[word] ?? word);
  for (const [phrase, replacement] of Object.entries(PHRASES)) {
    fixed = fixed.replace(
      new RegExp(`(?<![${LETTERS}])${phrase}(?![${LETTERS}])`, "g"),
      replacement
    );
  }
  return fixed;
}

/** Where a name starting at `start` must end: punctuation ("JACO, GARABITO") splits names. */
function nameEnd(tokens: readonly (Token | string)[], start: number): number {
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index];
    if (typeof token === "string" || token === undefined) return index;
    if (index > start && token.pre !== "") return index;
    if (token.post !== "") return index + 1;
  }
  return tokens.length;
}

/** "ESTACION", "ESTACION DE", "ESTACION DE LA", "ESTACION DE BOMBEROS DE" before `index`. */
function followsStation(keys: readonly (string | null)[], index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && index - previous <= 3 && STATION_INTRO.has(keys[previous] ?? "")) {
    previous--;
  }
  return keys[previous] === "ESTACION";
}

type NameMatch = { length: number; display: string };

/**
 * The longest place or station name starting at `index`. One-word names that are also
 * ordinary words ("HOSPITAL", "LIMON") and names led by an article ("LA FORTUNA") only
 * count after "ESTACION DE", where they can only be a name.
 */
function matchName(keys: readonly (string | null)[], index: number): NameMatch | null {
  const afterStation = followsStation(keys, index);
  // "ESTACION DEL ROBLE" names the station "EL ROBLE".
  const contracted = afterStation && keys[index - 1] === "DEL";

  for (let length = Math.min(MAX_NAME_WORDS, keys.length - index); length > 0; length--) {
    const words = keys.slice(index, index + length);
    if (words.some((word) => word === null)) continue;
    const first = words[0] ?? "";
    if (CONNECTORS.has(words.at(-1) ?? "")) continue;
    if (CONNECTORS.has(first) && !(afterStation && ARTICLES.has(first))) continue;
    const key = words.join(" ");

    if (afterStation) {
      if (STATION_NAMES.has(key)) return { length, display: formatStationName(key) };
      if (contracted && STATION_NAMES.has(`EL ${key}`)) {
        return { length, display: formatStationName(`EL ${key}`).replace(/^El /, "") };
      }
    }

    const place = PLACE_NAMES[key];
    if (
      place &&
      (afterStation || (length > 1 && !ARTICLES.has(first)) || !COMMON_PLACE_WORDS.has(key))
    ) {
      return { length, display: place };
    }
  }
  return null;
}

/**
 * SIGAE's upper-case incident details as a sentence: accents restored, typos and split
 * words fixed, and place, station and personal names capitalized.
 * "ESTACION DE GARABITO REPORTA CORTO CIRCUITO EN TENDIDO ELECTRICO" ->
 * "Estación de Garabito reporta cortocircuito en tendido eléctrico".
 */
export function formatIncidentDetails(details: string): string {
  if (!isUpperCase(details)) return details.trim();

  const tokens = tokenize(fixTyposAndPhrases(details));
  const keys = tokens.map((token) => (typeof token === "string" ? null : token.core));

  const output: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (typeof token === "string" || token === undefined) {
      output.push(formatLiteral(token ?? "", detailWord));
      continue;
    }

    const next = tokens[index + 1];
    const isUnitPrefix =
      token.core.length <= 2 &&
      !SHORT_WORDS.has(token.core) &&
      typeof next === "string" &&
      /^\d/.test(next);
    if (isUnitPrefix) {
      output.push(`${token.pre}${token.core}${token.post}`);
      continue;
    }

    const match = matchName(keys.slice(0, nameEnd(tokens, index)), index);
    if (match) {
      const last = tokens[index + match.length - 1];
      const post = typeof last === "string" || last === undefined ? "" : last.post;
      output.push(`${token.pre}${match.display}${post}`);
      index += match.length - 1;
      continue;
    }
    output.push(`${token.pre}${detailWord(token.core)}${token.post}`);
  }

  return capitalize(output.join(" "));
}

type IncidentLocation = {
  districtName: string | null;
  cantonName: string | null;
  provinceName: string | null;
};

/** "Colisión con persona atrapada en Jacó, Garabito, Puntarenas". */
export function formatIncidentHeadline(details: string, location: IncidentLocation): string {
  const places = [
    location.districtName ? formatDistrictName(location.districtName, location.cantonName) : null,
    location.cantonName ? formatCantonName(location.cantonName) : null,
    location.provinceName ? formatProvinceName(location.provinceName) : null
  ].filter((place): place is string => Boolean(place));

  const sentence = formatIncidentDetails(details);
  return places.length > 0 ? `${sentence} en ${places.join(", ")}` : sentence;
}
