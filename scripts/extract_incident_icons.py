#!/usr/bin/env python3
"""
Extract incident type icons from sprite sheet and remove green chromakey background.
"""

import os
import numpy as np
from PIL import Image
from scipy import ndimage

# Input/Output paths
SPRITE_PATH = "apps/web/public/assets/generated-sprite.jpeg"
OUTPUT_DIR = "apps/web/public/assets/incident-types"

# Grid configuration: 6 columns x 4 rows
COLS = 6
ROWS = 4

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

    # Hue calculation
    h = np.zeros_like(max_c)
    mask_r = (max_c == r) & (delta != 0)
    h[mask_r] = (60 * ((g[mask_r] - b[mask_r]) / delta[mask_r]) + 360) % 360
    mask_g = (max_c == g) & (delta != 0)
    h[mask_g] = 60 * ((b[mask_g] - r[mask_g]) / delta[mask_g]) + 120
    mask_b = (max_c == b) & (delta != 0)
    h[mask_b] = 60 * ((r[mask_b] - g[mask_b]) / delta[mask_b]) + 240

    # Saturation
    s = np.zeros_like(max_c)
    s[max_c != 0] = delta[max_c != 0] / max_c[max_c != 0]

    # Value
    v = max_c

    return np.stack([h, s * 100, v * 100], axis=-1)


def remove_green_screen(
    image: Image.Image,
    hue_center: float = 120,
    hue_range: float = 35,
    min_saturation: float = 50,
    min_value: float = 50,
    dilation_iterations: int = 2,
) -> Image.Image:
    """Remove green screen using HSV color space detection."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    data = np.array(image)
    rgb = data[:, :, :3]

    # Convert to HSV
    hsv = rgb_to_hsv_array(rgb)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    # Calculate hue distance (circular)
    hue_diff = np.abs(h - hue_center)
    hue_diff = np.minimum(hue_diff, 360 - hue_diff)

    # Create mask for green pixels
    green_mask = (hue_diff < hue_range) & (s > min_saturation) & (v > min_value)

    # Dilate mask to catch anti-aliased edges
    if dilation_iterations > 0:
        green_mask = ndimage.binary_dilation(green_mask, iterations=dilation_iterations)

    # Apply transparency
    alpha = data[:, :, 3].copy()
    alpha[green_mask] = 0
    data[:, :, 3] = alpha

    return Image.fromarray(data)


def cleanup_edges(image: Image.Image, threshold: int = 128) -> Image.Image:
    """Clean up semi-transparent edge pixels."""
    if image.mode != "RGBA":
        return image

    data = np.array(image)
    alpha = data[:, :, 3]
    alpha[alpha < threshold] = 0
    alpha[alpha >= threshold] = 255
    data[:, :, 3] = alpha

    return Image.fromarray(data)


def trim_transparent(image: Image.Image, padding: int = 5) -> Image.Image:
    """Trim transparent edges and add consistent padding."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    data = np.array(image)
    alpha = data[:, :, 3]

    # Find bounding box of non-transparent pixels
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)

    if not np.any(rows) or not np.any(cols):
        return image

    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]

    # Crop to content
    cropped = image.crop((cmin, rmin, cmax + 1, rmax + 1))

    # Add padding
    new_width = cropped.width + 2 * padding
    new_height = cropped.height + 2 * padding
    padded = Image.new("RGBA", (new_width, new_height), (0, 0, 0, 0))
    padded.paste(cropped, (padding, padding))

    return padded


def extract_icons(sprite_path: str, output_dir: str):
    """Extract all icons from the sprite sheet."""
    # Load sprite
    print(f"Loading sprite: {sprite_path}")
    sprite = Image.open(sprite_path)
    width, height = sprite.size
    print(f"Sprite size: {width}x{height}")

    # Calculate cell dimensions
    cell_width = width // COLS
    cell_height = height // ROWS
    print(f"Cell size: {cell_width}x{cell_height}")

    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    print(f"Output directory: {output_dir}")

    # Extract each icon
    for idx, (code, name) in enumerate(ICON_MAPPING):
        col = idx % COLS
        row = idx // COLS

        # Calculate bounding box
        left = col * cell_width
        top = row * cell_height
        right = left + cell_width
        bottom = top + cell_height

        # Extract cell
        cell = sprite.crop((left, top, right, bottom))

        # Remove green background
        transparent = remove_green_screen(cell)

        # Clean up edges
        cleaned = cleanup_edges(transparent, threshold=64)

        # Trim and add padding
        trimmed = trim_transparent(cleaned, padding=10)

        # Save as PNG
        filename = f"{code}.png"
        output_path = os.path.join(output_dir, filename)
        trimmed.save(output_path, "PNG")
        print(f"  [{idx + 1:2d}/24] Saved: {filename} ({name})")

    print(f"\nDone! Extracted {len(ICON_MAPPING)} icons to {output_dir}")


if __name__ == "__main__":
    extract_icons(SPRITE_PATH, OUTPUT_DIR)
