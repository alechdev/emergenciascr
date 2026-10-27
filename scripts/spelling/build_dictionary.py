#!/usr/bin/env python3
"""Build apps/web/api/lib/spelling/dictionary.gen.ts from the SIGAE text in the database.

SIGAE sends upper-case text with acute accents stripped ("ESTACION DE JACO"). This script
collects every word the site displays (incident details, addresses, type, station and place
names) and decides how to spell each one:

- Places come from the IGN's official territorial division, matched by INEC code, with the
  overrides in curated.json.
- Common words take the accent the Spanish (Costa Rica) hunspell dictionary requires.
- Proper nouns hunspell does not know (Pérez, Tobías) take the accented form when it clearly
  dominates a Spanish word-frequency list.
- Typos in incident details are words hunspell rejects that sit one keystroke away from a
  frequent valid word. Addresses are never corrected: too many names look like typos.

Words valid with and without an accent (cerro/cerró, publica/pública) follow curated.json,
then one rule: accent only when the stress falls before the last vowel. Final-stress forms
are almost always past-tense verbs ("cerró", "cortó"), which reports do not use.

Review the diff of the generated file before committing: it is the human check on every
correction.

Requires hunspell with es_CR (`pacman -S hunspell-es_cr`), psql and network access.
Usage: DRIZZLE_POSTGRES_URL=postgres://... python3 scripts/spelling/build_dictionary.py [--report]
--report lists the words valid with and without an accent and the accents taken from place
names, the two places a wrong call is most likely.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1].parent
CURATED_PATH = Path(__file__).resolve().parent / "curated.json"
OUTPUT_PATH = REPO_ROOT / "apps/web/api/lib/spelling/dictionary.gen.ts"

DTA_COMMIT = "d52bbd1feb6b28915d08b36fca298bf1adb2c278"
DTA_URL = f"https://raw.githubusercontent.com/ryze-cr/ubicaciones-cr/{DTA_COMMIT}/data/dta.json"
DTA_FIXES_URL = (
    f"https://raw.githubusercontent.com/ryze-cr/ubicaciones-cr/{DTA_COMMIT}/data/correcciones.json"
)
FREQUENCY_COMMIT = "525f9b560de45753a5ea01069454e72e9aa541c6"
FREQUENCY_URL = (
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/"
    f"{FREQUENCY_COMMIT}/content/2018/es/es_50k.txt"
)

WORD_PATTERN = "[^A-ZÑÁÉÍÓÚÜ]+"
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÑ"
VOWELS = set("AEIOUÁÉÍÓÚÜ")
ACCENTED_VOWELS = set("ÁÉÍÓÚ")

# Words used fewer times than this are left out of the accent table to keep it small; type,
# station and place words are always kept because every page shows them.
MIN_WORD_USES = 2
# A typo is rare; its correction is common and much more common than the typo.
MAX_TYPO_USES = 50
MIN_TYPO_LENGTH = 4
MIN_CORRECTION_USES = 30
MIN_CORRECTION_RATIO = 20
# A proper noun takes the accent when the accented form is at least this much more frequent.
MIN_PROPER_NOUN_RATIO = 2
MIN_PROPER_NOUN_FREQUENCY = 50
# For words valid both ways, the accented form must be at least this share of the plain one.
MIN_AMBIGUOUS_SHARE = 0.2


def strip_accents(text: str) -> str:
    """Upper case without acute accents or diaeresis; keeps Ñ, the way SIGAE writes."""
    decomposed = unicodedata.normalize("NFD", text.upper())
    kept = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn" or ch == "\u0303")
    return unicodedata.normalize("NFC", kept)


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def query(database_url: str, sql: str) -> list[list[str]]:
    result = subprocess.run(
        ["psql", database_url, "-At", "-F", "\t", "-c", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line.split("\t") for line in result.stdout.splitlines() if line]


def word_counts(database_url: str, expression: str, table: str) -> Counter[str]:
    rows = query(
        database_url,
        f"select word, count(*) from (select regexp_split_to_table(upper({expression}), "
        f"'{WORD_PATTERN}') as word from {table}) words where word <> '' group by word",
    )
    counts: Counter[str] = Counter()
    for word, count in rows:
        counts[strip_accents(word)] += int(count)
    return counts


def hunspell_invalid(words: set[str]) -> set[str]:
    """The lower-case words hunspell es_CR rejects."""
    result = subprocess.run(
        ["hunspell", "-d", "es_CR", "-l"],
        input="\n".join(sorted(words)),
        check=True,
        capture_output=True,
        text=True,
    )
    return set(result.stdout.split())


def hunspell_suggestions(words: set[str]) -> dict[str, list[str]]:
    """Suggestions for each rejected word, in hunspell's order."""
    ordered = sorted(words)
    result = subprocess.run(
        ["hunspell", "-d", "es_CR", "-a"],
        input="\n".join(f"^{word}" for word in ordered),
        check=True,
        capture_output=True,
        text=True,
    )
    suggestions: dict[str, list[str]] = {}
    for line in result.stdout.splitlines():
        if line.startswith("& "):
            head, _, tail = line.partition(": ")
            suggestions[head.split()[1]] = [item.strip() for item in tail.split(",")]
    return suggestions


def acronyms_upper(curated: dict) -> set[str]:
    return {entry.upper() for entry in curated["acronyms"]}


def edits1(word: str) -> set[str]:
    splits = [(word[:i], word[i:]) for i in range(len(word) + 1)]
    deletes = [a + b[1:] for a, b in splits if b]
    transposes = [a + b[1] + b[0] + b[2:] for a, b in splits if len(b) > 1]
    replaces = [a + c + b[1:] for a, b in splits if b for c in ALPHABET]
    inserts = [a + c + b for a, b in splits for c in ALPHABET]
    return set(deletes + transposes + replaces + inserts)


def stress_before_last_vowel(accented: str) -> bool:
    vowels = [ch for ch in accented if ch in VOWELS]
    return bool(vowels) and vowels[-1] not in ACCENTED_VOWELS


def load_places(database_url: str, curated: dict) -> dict:
    dta = json.loads(fetch(DTA_URL))
    fixes = json.loads(fetch(DTA_FIXES_URL))
    official: dict[str, str] = {}
    for province in dta["provincias"]:
        official[province["codigo"]] = province["nombre"]
        for canton in province["cantones"]:
            official[canton["codigo"]] = canton["nombre"]
            for district in canton["distritos"]:
                official[district["codigo"]] = district["nombre"]
    for district in fixes.get("agregar_distritos", []):
        official[district["codigo"]] = district["nombre"]
    for rename in fixes.get("renombrar", []):
        official[rename["codigo"]] = rename["a"]
    overrides = {k: v for k, v in curated["placeNames"].items() if not k.startswith("_")}

    rows = query(
        database_url,
        "select 'province', trim(p.code), p.name, null from provinces p "
        "union all select 'canton', trim(c.code), c.name, null from cantons c "
        "union all select 'district', trim(d.code), d.name, c.name from districts d "
        'join cantons c on c.id = d."cantonId"',
    )

    def display(code: str, name: str) -> str:
        if code in overrides:
            return overrides[code]
        if code in official:
            return official[code]
        # Codes the IGN no longer lists (sea zones) already arrive in mixed case.
        return name.strip()

    provinces: dict[str, str] = {}
    cantons: dict[str, str] = {}
    districts: dict[str, str] = {}
    by_name: dict[str, set[str]] = defaultdict(set)
    for kind, code, name, canton in rows:
        key = strip_accents(name.strip())
        shown = display(code, name)
        by_name[key].add(shown)
        if kind == "province":
            provinces[key] = shown
        elif kind == "canton":
            cantons[key] = shown
        else:
            districts[f"{strip_accents(canton.strip())}|{key}"] = shown

    # A name shared by places spelled differently ("GARITA") is left to the district table.
    names = {key: next(iter(shown)) for key, shown in by_name.items() if len(shown) == 1}
    return {"provinces": provinces, "cantons": cantons, "districts": districts, "names": names}


def main() -> int:
    database_url = os.environ.get("DRIZZLE_POSTGRES_URL")
    if not database_url:
        print("Set DRIZZLE_POSTGRES_URL to the database to read from.", file=sys.stderr)
        return 1

    curated = json.loads(CURATED_PATH.read_text())
    places = load_places(database_url, curated)

    details = word_counts(database_url, '"importantDetails"', "incidents")
    addresses = word_counts(database_url, "address", "incidents")
    labels = word_counts(database_url, "name", "incident_types") + word_counts(
        database_url, "name", "stations"
    )
    stations = sorted(
        {strip_accents(name.strip()) for (name,) in query(database_url, "select name from stations")}
    )

    place_words: dict[str, str] = {}
    for shown in list(places["names"].values()) + list(places["districts"].values()):
        for word in shown.replace("(", " ").replace(")", " ").split():
            upper = word.upper()
            if strip_accents(upper) != upper:
                place_words[strip_accents(upper)] = upper
    place_keys = {word for name in places["names"] for word in name.split()}

    frequency: dict[str, int] = {}
    forms: dict[str, list[str]] = defaultdict(list)
    for line in fetch(FREQUENCY_URL).splitlines():
        word, count = line.split()
        frequency[word] = int(count)
        forms[strip_accents(word)].append(word)

    uses = details + addresses + labels
    vocabulary = set(uses) | place_keys
    # Only frequent words are worth hunspell's slow suggestions and the judgment calls below.
    frequent = {
        word for word, count in uses.items() if count >= MIN_WORD_USES or word in labels
    } | place_keys
    candidates = {word.lower() for word in vocabulary} | {word.capitalize() for word in frequent}
    for word in vocabulary:
        candidates.update(forms.get(word, []))
    invalid = hunspell_invalid(candidates)
    suggestions = hunspell_suggestions({word.lower() for word in frequent} & invalid)

    def variant_order(form: str) -> tuple[int, bool, str]:
        # Most frequent first; on a tie, the stress before the last vowel ("averías" over the
        # voseo "averiás"), then alphabetical so reruns give the same table.
        return (-frequency.get(form, 0), not stress_before_last_vowel(form.upper()), form)

    force = {k: v for k, v in curated["accents"]["force"].items()}
    keep = set(curated["accents"]["keep"])
    accents: dict[str, str] = {}
    ambiguous: list[tuple[int, str, str, bool]] = []
    place_collisions: list[tuple[int, str, str]] = []
    for word in sorted(vocabulary):
        if word in keep:
            continue
        if word in force:
            accents[word] = force[word]
            continue
        if word in place_words:
            accents[word] = place_words[word]
            if word.lower() not in invalid:
                place_collisions.append((uses[word], word, place_words[word]))
            continue
        plain = word.lower()
        # Hunspell suggests capitalized names ("Cartago"); only a change of accent counts.
        variants = {
            form.lower()
            for form in forms.get(word, []) + suggestions.get(plain, [])
            if form.lower() != plain and strip_accents(form) == word
        }
        valid = sorted((form for form in variants if form not in invalid), key=variant_order)
        if plain in invalid and valid:
            accents[word] = valid[0].upper()
        elif word not in frequent:
            continue
        elif plain not in invalid and valid:
            best = valid[0]
            share = frequency.get(best, 0) / max(frequency.get(plain, 0), 1)
            chosen = stress_before_last_vowel(best.upper()) and share >= MIN_AMBIGUOUS_SHARE
            if chosen:
                accents[word] = best.upper()
            ambiguous.append((uses[word], word, best, chosen))
        elif plain in invalid:
            # Hunspell knows many names only capitalized ("Quirós").
            named = [
                form
                for form in suggestions.get(plain, [])
                if form[:1].isupper() and strip_accents(form) == word and form != word.capitalize()
            ]
            proper = sorted(variants, key=variant_order)
            if named:
                accents[word] = named[0].upper()
            elif proper:
                best = proper[0]
                count = frequency.get(best, 0)
                if (
                    count >= MIN_PROPER_NOUN_FREQUENCY
                    and count >= MIN_PROPER_NOUN_RATIO * frequency.get(plain, 0)
                ):
                    accents[word] = best.upper()

    reject = set(curated["typos"]["reject"])
    invalid_details = hunspell_invalid({word.lower() for word in details})
    # Real words, places and names are never typos, however rare.
    known_words = {
        word
        for word in details
        if word.lower() not in invalid_details
        or word in place_keys
        or word in accents
        or frequency.get(word.lower(), 0) >= MIN_PROPER_NOUN_FREQUENCY
    }
    typos: dict[str, str] = {}
    for word, count in details.items():
        if (
            word in reject
            or word in known_words
            or len(word) < MIN_TYPO_LENGTH
            or count > MAX_TYPO_USES
        ):
            continue
        corrections = {
            candidate
            for candidate in edits1(word)
            if candidate in known_words
            and details[candidate] >= MIN_CORRECTION_USES
            and details[candidate] >= MIN_CORRECTION_RATIO * count
        }
        if len(corrections) == 1:
            typos[word] = corrections.pop()
    typos.update({k: v for k, v in curated["typos"]["extra"].items()})

    # Hunspell hands back some names unchanged ("McDonald" for MCDONALD).
    accents = {word: accented for word, accented in accents.items() if accented != word}
    spelled = {word: accents.get(word, word) for word in frequent | set(places["names"])}
    invalid_spelled = hunspell_invalid(
        {form.lower() for form in spelled.values()} | {form.capitalize() for form in spelled.values()}
    )
    common_place_words = sorted(
        key
        for key in places["names"]
        if " " not in key and spelled[key].lower() not in invalid_spelled
    )
    # Names in free text: words hunspell only accepts capitalized ("Grecia"), words of station
    # and place names it doesn't know ("ODUBER", "NEILY"), and the curated list.
    name_words = {
        word
        for name in stations + list(places["names"])
        for word in name.split()
        if word.isalpha()
    }
    curated_names = set(curated["properNouns"])
    proper_nouns = sorted(
        word
        for word in details
        if word in curated_names
        or (
            word in frequent
            and word not in acronyms_upper(curated)
            and word in spelled
            and spelled[word].lower() in invalid_spelled
            and (word in name_words or spelled[word].capitalize() not in invalid_spelled)
        )
    )
    phrases = {k: v for k, v in curated["phrases"].items() if not k.startswith("_")}
    acronyms = {entry.upper(): entry for entry in curated["acronyms"]}

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        render(
            accents=accents,
            typos=typos,
            phrases=phrases,
            acronyms=acronyms,
            places=places,
            stations=stations,
            common_place_words=common_place_words,
            proper_nouns=proper_nouns,
        )
    )
    if "--report" in sys.argv:
        print("Words valid with and without an accent (uses, word, accented form, accented?):")
        for count, word, accented, chosen in sorted(ambiguous, reverse=True):
            print(f"  {count}\t{word}\t{accented}\t{'yes' if chosen else 'no'}")
        print("Accents taken from place names that are also plain words (uses, word, accented):")
        for count, word, accented in sorted(place_collisions, reverse=True):
            print(f"  {count}\t{word}\t{accented}")
    print(
        f"Wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}: {len(accents)} accents, {len(typos)} typos, "
        f"{len(places['names'])} place names, {len(places['districts'])} districts, "
        f"{len(stations)} stations."
    )
    return 0


def render_record(name: str, comment: str, entries: dict[str, str]) -> str:
    body = "\n".join(
        f"  {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)},"
        for key, value in sorted(entries.items())
    )
    return f"/** {comment} */\nexport const {name}: Readonly<Record<string, string>> = {{\n{body}\n}};\n"


def render_set(name: str, comment: str, entries: list[str]) -> str:
    body = "\n".join(f"  {json.dumps(entry, ensure_ascii=False)}," for entry in sorted(entries))
    return f"/** {comment} */\nexport const {name}: ReadonlySet<string> = new Set([\n{body}\n]);\n"


def render(**data) -> str:
    places = data["places"]
    sections = [
        "// Generated by scripts/spelling/build_dictionary.py. Do not edit by hand: change\n"
        "// scripts/spelling/curated.json and rerun the script.\n",
        render_record(
            "ACCENTS",
            "SIGAE's upper-case word, without accents, to its accented upper-case spelling.",
            data["accents"],
        ),
        render_record(
            "TYPOS", "Misspelled words in incident details to their correction.", data["typos"]
        ),
        render_record(
            "PHRASES", "Multi-word fixes in incident details, applied first.", data["phrases"]
        ),
        render_record(
            "ACRONYMS", "Words that keep their capitals, with their display form.", data["acronyms"]
        ),
        render_record("PROVINCES", "Province names by SIGAE name.", places["provinces"]),
        render_record("CANTONS", "Canton names by SIGAE name.", places["cantons"]),
        render_record(
            "DISTRICTS",
            'District names by "CANTON|DISTRICT"; several cantons share district names.',
            places["districts"],
        ),
        render_record(
            "PLACE_NAMES",
            "Every place name that is spelled the same wherever it appears.",
            places["names"],
        ),
        render_set("STATION_NAMES", "Station names as SIGAE sends them.", data["stations"]),
        render_set(
            "COMMON_PLACE_WORDS",
            'One-word place names that are also ordinary words ("HOSPITAL"); free text only '
            "capitalizes them inside a longer name or after ESTACION.",
            data["common_place_words"],
        ),
        render_set(
            "PROPER_NOUNS",
            'Words in incident details that are names ("JUAN", "QUIROS"); free text capitalizes them.',
            data["proper_nouns"],
        ),
    ]
    return "\n".join(sections)


if __name__ == "__main__":
    sys.exit(main())
