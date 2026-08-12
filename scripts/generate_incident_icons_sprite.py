#!/usr/bin/env python3
"""Generate a 6x4 greenscreen sprite of incident-type icons via DigitalOcean Inference."""

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

REPO_ROOT = Path(__file__).resolve().parents[1]

# Must stay in lockstep with scripts/extract_incident_icons.py ICON_MAPPING order.
ICON_MAPPING: list[tuple[str, str, str]] = [
    # code, Spanish label, English visual brief for the model
    # ROW 1: Top-level categories
    ("1", "Emergencias por Fuego", "fire emergency: stylized flames"),
    ("2", "Emergencias por Agua", "water emergency: flood waves or water drop"),
    ("3", "Emergencias por Aire", "air emergency: wind / storm / gust"),
    ("4", "Emergencias por Tierra", "earth emergency: cracked ground or landslide"),
    (
        "5",
        "Emergencias Fisicoquímicas",
        "hazmat / physicochemical emergency: chemical flask or hazard diamond",
    ),
    (
        "6",
        "Rescates y Recuperaciones",
        "rescue and recovery: lifebuoy, rope, or helping hands",
    ),
    # ROW 2
    ("7", "Emergencias por Vehículos", "vehicle emergency: car with warning"),
    (
        "8",
        "Emergencia Pre-hospitalaria",
        "pre-hospital emergency: ambulance cross / medical aid",
    ),
    ("9", "Otros Incidentes", "other incidents: generic alert / question mark badge"),
    ("6.1.1.2.1", "Serpiente", "snake wildlife rescue"),
    ("6.1.1.1", "Abejas/Avispas", "bees / wasps swarm"),
    ("5.1.1", "Corto Circuito", "electrical short circuit: sparking wires / plug"),
    # ROW 3
    ("1.3.2", "Área de Desechos", "waste / dump fire area"),
    ("1.2.1", "Charral", "brush / scrubland fire"),
    ("5.2.2.3.1", "Escape Gas LPG", "LPG gas leak: gas cylinder with vapor"),
    ("7.1.1", "Colisión Vehicular", "vehicle collision: two cars crashing"),
    ("6.2.3", "Perezoso", "sloth wildlife rescue"),
    ("1.1.8.8", "Casa de Habitación", "house fire / residential building fire"),
    # ROW 4
    ("3.3", "Caída de Árbol", "fallen tree / tree on road"),
    ("6.2.2", "Felino", "big cat / feline wildlife rescue"),
    ("6.2.1", "Canino", "dog wildlife / animal rescue"),
    ("1.4.1.8.1", "Incendio Vehículo", "vehicle on fire"),
    ("6.1.1.3", "Ataque de Perro", "dog attack warning"),
    ("9.2.1", "Revisión", "inspection / checklist / review clipboard"),
]

COLS = 6
ROWS = 4
GREENSCREEN = "#00FF00"

DEFAULT_MODEL = "openai-gpt-image-2"
DEFAULT_BASE_URL = "https://inference.do-ai.run/v1"
DEFAULT_OUTPUT = REPO_ROOT / "apps/web/public/assets/generated-sprite.png"
DEFAULT_SIZE = "2048x2048"


def build_prompt() -> str:
    numbered = "\n".join(
        f"{i}. [{code}] {label} — {brief}"
        for i, (code, label, brief) in enumerate(ICON_MAPPING, start=1)
    )
    return f"""Create ONE sprite sheet image with exactly {len(ICON_MAPPING)} emergency-response icons
in a strict regular grid of {COLS} columns by {ROWS} rows (row-major, left-to-right, top-to-bottom).

LAYOUT (must follow exactly):
- Equal-sized cells covering the full canvas with no gaps between cells.
- Each icon centered in its cell with clear empty margin so icons never touch cell edges or neighbors.
- No cell borders, dividers, labels, numbers, captions, watermarks, or UI chrome.
- Exactly {COLS * ROWS} icons; do not add extras or leave empty cells.

CHROMA-KEY BACKGROUND (critical for post-processing):
- Every background pixel — including empty space inside each cell — must be a perfectly flat, solid greenscreen of exactly {GREENSCREEN} (RGB 0, 255, 0).
- No gradients, shadows, textures, vignettes, reflections, or other background colors.
- Do NOT use green anywhere inside the icons themselves (no green foliage accents, no green fills). Prefer reds, oranges, blues, yellows, blacks, whites, and grays for icon colors. For plants/animals, use browns, yellows, and dark neutrals instead of green.

ICON STYLE:
- Flat modern vector / app-icon look, consistent stroke weight and visual language across all icons.
- High contrast, readable at small sizes, suitable for a Costa Rica emergency incidents map.
- Simple symbolic shapes; no photorealism; no 3D plastic gloss.

ICON ORDER (row-major):
{numbered}
"""


def get_client(base_url: str) -> OpenAI:
    load_dotenv(REPO_ROOT / ".env")
    api_key = os.getenv("DIGITAL_OCEAN_MODEL_ACCESS_KEY")
    if not api_key:
        print(
            "Missing DIGITAL_OCEAN_MODEL_ACCESS_KEY (set in env or repo-root .env).",
            file=sys.stderr,
        )
        sys.exit(1)

    return OpenAI(base_url=base_url.rstrip("/"), api_key=api_key)


def generate_sprite(
    *,
    model: str,
    base_url: str,
    size: str,
    quality: str,
    output_path: Path,
    dry_run: bool,
) -> None:
    if len(ICON_MAPPING) != COLS * ROWS:
        raise SystemExit(
            f"ICON_MAPPING has {len(ICON_MAPPING)} entries; expected {COLS * ROWS}"
        )

    prompt = build_prompt()
    print(f"Model:   {model}")
    print(f"Base:    {base_url}")
    print(f"Size:    {size}")
    print(f"Quality: {quality}")
    print(f"Output:  {output_path}")
    print(f"Icons:   {len(ICON_MAPPING)} ({COLS}x{ROWS})")
    print()

    if dry_run:
        print("--- prompt ---")
        print(prompt)
        print("--- end prompt ---")
        return

    client = get_client(base_url)
    print("Requesting image generation...")
    result = client.images.generate(
        model=model,
        prompt=prompt,
        n=1,
        size=size,
        quality=quality,  # type: ignore[arg-type]
        background="opaque",  # type: ignore[arg-type]
    )

    image = result.data[0]
    b64 = getattr(image, "b64_json", None)
    if not b64:
        raise SystemExit(
            "API response had no b64_json image payload. "
            f"Raw fields: {getattr(image, 'model_dump', lambda: image)()}"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(base64.b64decode(b64))
    print(f"Saved sprite: {output_path} ({output_path.stat().st_size} bytes)")
    print()
    print("Next: python3 scripts/extract_incident_icons.py")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate greenscreen incident icon sprite via DigitalOcean openai-gpt-image-2"
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"DigitalOcean model slug (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"OpenAI-compatible base URL (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--size",
        default=DEFAULT_SIZE,
        help=f"Image size (default: {DEFAULT_SIZE})",
    )
    parser.add_argument(
        "--quality",
        default="high",
        choices=("low", "medium", "high", "auto"),
        help="Generation quality (default: high)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output sprite path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the prompt and exit without calling the API",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = args.output if args.output.is_absolute() else REPO_ROOT / args.output
    generate_sprite(
        model=args.model,
        base_url=args.base_url,
        size=args.size,
        quality=args.quality,
        output_path=output,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
