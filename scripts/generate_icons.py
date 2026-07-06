#!/usr/bin/env python3
"""Generate the extension's raster icons (a rounded yellow tile with a house).

No external assets — draws with Pillow. Re-run after tweaking colors/shape:
    python3 scripts/generate_icons.py
"""
import os
from PIL import Image, ImageDraw

YELLOW = (255, 232, 0, 255)
INK = (26, 26, 26, 255)
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "icons")


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_icon(size):
    # supersample for smooth edges
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=YELLOW)

    # simple house: roof triangle + body
    cx = s / 2
    roof_top = s * 0.24
    roof_bottom = s * 0.48
    half_w = s * 0.26
    d.polygon(
        [(cx, roof_top), (cx - half_w, roof_bottom), (cx + half_w, roof_bottom)],
        fill=INK,
    )
    body_w = s * 0.36
    body = [cx - body_w / 2, roof_bottom, cx + body_w / 2, s * 0.74]
    d.rectangle(body, fill=INK)
    # door (punch out with yellow)
    door_w = s * 0.10
    d.rectangle(
        [cx - door_w / 2, s * 0.58, cx + door_w / 2, s * 0.74], fill=YELLOW
    )

    img = img.resize((size, size), Image.LANCZOS)
    # re-apply rounded alpha after resize
    img.putalpha(rounded_mask(size, int(size * 0.22)))
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 48, 128):
        icon = draw_icon(size)
        path = os.path.join(OUT, f"icon{size}.png")
        icon.save(path)
        print("wrote", os.path.normpath(path))


if __name__ == "__main__":
    main()
