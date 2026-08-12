#!/usr/bin/env python3
"""
Extract incident type icons from sprite sheet and remove green chromakey background.
"""

from __future__ import annotations

import os

import numpy as np
from PIL import Image
from scipy import ndimage

# Input/Output paths
SPRITE_PATH = "apps/web/public/assets/generated-sprite.png"
OUTPUT_DIR = "apps/web/public/assets/incident-types"

# Grid configuration: 6 columns x 4 rows
COLS = 6
ROWS = 4

# Generated icons often overflow their grid cell. Expand the crop into
# neighbors, then keep only components that intersect this cell's core.
CELL_EXPAND_PX = 28
CORE_MARGIN_PX = 24


# Mapping of grid positions (col, row) to incident codes
# Based on the prompt order we used for generation
ICON_MAPPING = [
    # ROW 1: Top-level categories
    ("1", "Emergencias por Fuego"),
    ("2", "Emergencias por Agua"),
    ("3", "Emergencias por Aire"),
    ("4", "Emergencias por Tierra"),
    ("5", "Emergencias Fisicoquímicas"),
    ("6", "Rescates y Recuperaciones"),
    # ROW 2: Top-level + Sub-types
    ("7", "Emergencias por Vehículos"),
    ("8", "Emergencia Pre-hospitalaria"),
    ("9", "Otros Incidentes"),
    ("6.1.1.2.1", "Serpiente"),
    ("6.1.1.1", "Abejas/Avispas"),
    ("5.1.1", "Corto Circuito"),
    # ROW 3: Sub-types
    ("1.3.2", "Área de Desechos"),
    ("1.2.1", "Charral"),
    ("5.2.2.3.1", "Escape Gas LPG"),
    ("7.1.1", "Colisión Vehicular"),
    ("6.2.3", "Perezoso"),
    ("1.1.8.8", "Casa de Habitación"),
    # ROW 4: Sub-types
    ("3.3", "Caída de Árbol"),
    ("6.2.2", "Felino"),
    ("6.2.1", "Canino"),
    ("1.4.1.8.1", "Incendio Vehículo"),
    ("6.1.1.3", "Ataque de Perro"),
    ("9.2.1", "Revisión"),
]


def rgb_to_hsv_array(rgb_array: np.ndarray) -> np.ndarray:
    """Convert RGB array to HSV array efficiently."""
    rgb_normalized = rgb_array.astype(np.float32) / 255.0
    r, g, b = rgb_normalized[:, :, 0], rgb_normalized[:, :, 1], rgb_normalized[:, :, 2]

    max_c = np.maximum(np.maximum(r, g), b)
    min_c = np.minimum(np.minimum(r, g), b)
    delta = max_c - min_c

    h = np.zeros_like(max_c)
    mask_r = (max_c == r) & (delta != 0)
    h[mask_r] = (60 * ((g[mask_r] - b[mask_r]) / delta[mask_r]) + 360) % 360
    mask_g = (max_c == g) & (delta != 0)
    h[mask_g] = 60 * ((b[mask_g] - r[mask_g]) / delta[mask_g]) + 120
    mask_b = (max_c == b) & (delta != 0)
    h[mask_b] = 60 * ((r[mask_b] - g[mask_b]) / delta[mask_b]) + 240

    s = np.zeros_like(max_c)
    s[max_c != 0] = delta[max_c != 0] / max_c[max_c != 0]
    v = max_c

    return np.stack([h, s * 100, v * 100], axis=-1)


def greenness(rgb: np.ndarray) -> np.ndarray:
    """
    Score how chroma-key-green each pixel is (0..1).
    Biased toward true #00FF00; avoids eating yellow/olive subject detail.
    """
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)

    hsv = rgb_to_hsv_array(rgb)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    hue_diff = np.minimum(np.abs(h - 120.0), 360.0 - np.abs(h - 120.0))

    classic = (hue_diff < 40) & (s > 35) & (v > 35)
    g_dom = (g > r + 28) & (g > b + 28) & (g > 55) & (s > 25)
    muddy = (hue_diff < 45) & (s > 22) & (v > 30) & (g > r + 12) & (g > b + 12)

    score = np.zeros(rgb.shape[:2], dtype=np.float32)
    score[classic] = 1.0
    score[g_dom] = np.maximum(score[g_dom], 0.85)
    score[muddy] = np.maximum(score[muddy], 0.7)
    return score


def remove_green_screen(image: Image.Image, dilation_iterations: int = 1) -> Image.Image:
    """Remove green screen with soft keying + light despill on fringe only."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    data = np.array(image).astype(np.float32)
    rgb = data[:, :, :3]
    alpha = data[:, :, 3]

    score = greenness(rgb.astype(np.uint8))
    hard = score >= 0.75
    if dilation_iterations > 0:
        hard = ndimage.binary_dilation(hard, iterations=dilation_iterations)

    alpha[hard] = 0

    # Only soften strongly keyed fringe; leave subject detail alone.
    fringe = (~hard) & (score > 0.45) & (alpha > 0)
    alpha[fringe] *= 1.0 - np.clip((score[fringe] - 0.45) / 0.55, 0, 1)

    # Despill only on remaining near-key pixels, not the whole subject.
    spill = (~hard) & (alpha > 0) & (score > 0.4)
    if np.any(spill):
        max_rb = np.maximum(rgb[:, :, 0], rgb[:, :, 2])
        rgb[spill, 1] = np.minimum(rgb[spill, 1], max_rb[spill] + 12)

    data[:, :, :3] = rgb
    data[:, :, 3] = alpha
    return Image.fromarray(np.clip(data, 0, 255).astype(np.uint8))


def remove_small_components(
    image: Image.Image,
    min_area_abs: int = 18,
) -> Image.Image:
    """Drop only tiny speck leftovers; keep all meaningful subject pieces."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    data = np.array(image)
    alpha = data[:, :, 3]
    foreground = alpha > 16
    if not np.any(foreground):
        return image

    labeled, count = ndimage.label(foreground)
    if count <= 1:
        return image

    areas = ndimage.sum(foreground, labeled, index=range(1, count + 1))
    keep = np.zeros(count + 1, dtype=bool)
    for i, area in enumerate(areas, start=1):
        if area >= min_area_abs:
            keep[i] = True

    keep[int(np.argmax(areas)) + 1] = True
    mask = keep[labeled]
    data[~mask, 3] = 0
    return Image.fromarray(data)


def remove_edge_spill_components(
    image: Image.Image,
    edge_margin: int = 30,
    max_spill_area: int = 500,
) -> Image.Image:
    """
    Drop neighbor-cell overflow: fragments confined to a strip along one edge.

    Generated sprites often draw slightly across the 6x4 grid lines. Those
    leftovers sit in a thin border band and are much smaller than the real icon.
    """
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    data = np.array(image)
    alpha = data[:, :, 3]
    foreground = alpha > 16
    if not np.any(foreground):
        return image

    h, w = foreground.shape
    labeled, count = ndimage.label(foreground)
    if count == 0:
        return image

    keep = np.ones(count + 1, dtype=bool)
    keep[0] = False

    for i in range(1, count + 1):
        ys, xs = np.where(labeled == i)
        area = int(ys.size)
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())

        in_left = x1 < edge_margin
        in_right = x0 > w - 1 - edge_margin
        in_top = y1 < edge_margin
        in_bottom = y0 > h - 1 - edge_margin
        confined_to_edge = in_left or in_right or in_top or in_bottom

        touches_edge = y0 == 0 or y1 == h - 1 or x0 == 0 or x1 == w - 1
        if confined_to_edge and touches_edge and area <= max_spill_area:
            keep[i] = False

    areas = ndimage.sum(foreground, labeled, index=range(1, count + 1))
    keep[int(np.argmax(areas)) + 1] = True

    mask = keep[labeled]
    data[~mask, 3] = 0
    return Image.fromarray(data)


def remove_orphan_border_components(
    image: Image.Image,
    core_box: tuple[int, int, int, int] | None = None,
    core_margin: int = 28,
    min_inside_ratio: float = 0.45,
) -> Image.Image:
    """
    Keep only foreground components that belong to this cell.

    `core_box` is (left, top, right, bottom) in crop-local coordinates — the
    original grid cell inside an expanded crop. A component is kept if it
    intersects the inner core AND most of its area lies inside the cell.
    That drops neighbor overflow (e.g. a plug tip) while preserving our icon's
    own overflow into the expanded margin.
    """
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    data = np.array(image)
    alpha = data[:, :, 3]
    foreground = alpha > 16
    if not np.any(foreground):
        return image

    h, w = foreground.shape
    cell_mask = np.zeros_like(foreground)
    core = np.zeros_like(foreground)

    if core_box is not None:
        left, top, right, bottom = core_box
        cell_left = max(0, min(w, left))
        cell_top = max(0, min(h, top))
        cell_right = max(0, min(w, right))
        cell_bottom = max(0, min(h, bottom))
        if cell_right > cell_left and cell_bottom > cell_top:
            cell_mask[cell_top:cell_bottom, cell_left:cell_right] = True

        core_left = max(0, min(w, left + core_margin))
        core_top = max(0, min(h, top + core_margin))
        core_right = max(0, min(w, right - core_margin))
        core_bottom = max(0, min(h, bottom - core_margin))
        if core_right > core_left and core_bottom > core_top:
            core[core_top:core_bottom, core_left:core_right] = True
    else:
        margin = min(core_margin, h // 4, w // 4)
        if margin > 0:
            core[margin : h - margin, margin : w - margin] = True
            cell_mask[:, :] = True

    if not np.any(core):
        return image

    labeled, count = ndimage.label(foreground)
    if count == 0:
        return image

    areas = ndimage.sum(foreground, labeled, index=range(1, count + 1))
    inside_areas = ndimage.sum(cell_mask, labeled, index=range(1, count + 1))
    core_hit = np.unique(labeled[core & foreground])

    keep = np.zeros(count + 1, dtype=bool)
    for i in range(1, count + 1):
        area = float(areas[i - 1])
        inside = float(inside_areas[i - 1])
        ratio = inside / area if area > 0 else 0.0
        if i in core_hit and ratio >= min_inside_ratio:
            keep[i] = True

    if not np.any(keep[1:]):
        keep[int(np.argmax(areas)) + 1] = True

    mask = keep[labeled]
    data[~mask, 3] = 0
    return Image.fromarray(data)


def cleanup_edges(image: Image.Image, threshold: int = 48) -> Image.Image:
    """Clean up only very faint semi-transparent edge pixels."""
    if image.mode != "RGBA":
        return image

    data = np.array(image)
    alpha = data[:, :, 3]
    alpha[alpha < threshold] = 0
    data[:, :, 3] = alpha
    return Image.fromarray(data)


def trim_transparent(image: Image.Image, padding: int = 5) -> Image.Image:
    """Trim transparent edges and add consistent padding."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    data = np.array(image)
    alpha = data[:, :, 3]

    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)

    if not np.any(rows) or not np.any(cols):
        return image

    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]

    cropped = image.crop((cmin, rmin, cmax + 1, rmax + 1))

    new_width = cropped.width + 2 * padding
    new_height = cropped.height + 2 * padding
    padded = Image.new("RGBA", (new_width, new_height), (0, 0, 0, 0))
    padded.paste(cropped, (padding, padding))
    return padded


def extract_icons(sprite_path: str, output_dir: str):
    """Extract all icons from the sprite sheet."""
    print(f"Loading sprite: {sprite_path}")
    sprite = Image.open(sprite_path)
    width, height = sprite.size
    print(f"Sprite size: {width}x{height}")

    cell_width = width // COLS
    cell_height = height // ROWS
    print(
        f"Cell size: {cell_width}x{cell_height} "
        f"(expand {CELL_EXPAND_PX}px, core margin {CORE_MARGIN_PX}px)"
    )

    os.makedirs(output_dir, exist_ok=True)
    print(f"Output directory: {output_dir}")

    for idx, (code, name) in enumerate(ICON_MAPPING):
        col = idx % COLS
        row = idx // COLS

        cell_left = col * cell_width
        cell_top = row * cell_height
        cell_right = (col + 1) * cell_width
        cell_bottom = (row + 1) * cell_height

        crop_left = max(0, cell_left - CELL_EXPAND_PX)
        crop_top = max(0, cell_top - CELL_EXPAND_PX)
        crop_right = min(width, cell_right + CELL_EXPAND_PX)
        crop_bottom = min(height, cell_bottom + CELL_EXPAND_PX)

        # Original cell rectangle in crop-local coordinates.
        core_box = (
            cell_left - crop_left,
            cell_top - crop_top,
            cell_right - crop_left,
            cell_bottom - crop_top,
        )

        cell = sprite.crop((crop_left, crop_top, crop_right, crop_bottom))
        transparent = remove_green_screen(cell, dilation_iterations=1)
        cleaned = cleanup_edges(transparent, threshold=48)
        filtered = remove_small_components(cleaned, min_area_abs=18)
        despilled = remove_edge_spill_components(filtered, edge_margin=32, max_spill_area=600)
        core_kept = remove_orphan_border_components(
            despilled, core_box=core_box, core_margin=CORE_MARGIN_PX
        )
        trimmed = trim_transparent(core_kept, padding=8)

        filename = f"{code}.png"
        output_path = os.path.join(output_dir, filename)
        trimmed.save(output_path, "PNG")
        print(f"  [{idx + 1:2d}/24] Saved: {filename} ({name})")

    print(f"\nDone! Extracted {len(ICON_MAPPING)} icons to {output_dir}")


if __name__ == "__main__":
    extract_icons(SPRITE_PATH, OUTPUT_DIR)
