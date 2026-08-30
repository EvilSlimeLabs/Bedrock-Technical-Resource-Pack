"""Render the pack identity mark and composite it over the slime lab background.

The mark is the vanilla bedrock block drawn in 2:1 isometric with the corner
nearest the viewer cut away, exposing three interior surfaces that carry the
things this pack draws in game: a chunk grid, a radius ring, and stacked layer
lines.

Everything is rasterised as per-texel quads at integer coordinates, so the
output is crisp pixel art with no resampling anywhere. Nothing here runs as part
of `npm run release`; it needs Pillow and, the first time, the network.

    python branding/make_icon.py

Outputs (see OUTPUTS at the bottom):
    branding/identity_bedrock_cutaway.png   the mark alone, transparent
    branding/pack_icon_1024.png             the mark over the background
    branding/pack_icon_256.png              preview copy of what the game shows
    pack_icon.png                           the icon the pack ships
"""

import math
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, "cache")

# Mojang's published vanilla resource pack; the same source the audit baseline
# is generated from.
BEDROCK_URL = (
    "https://raw.githubusercontent.com/Mojang/bedrock-samples/main"
    "/resource_pack/textures/blocks/bedrock.png"
)

# --- geometry -----------------------------------------------------------------
#
# The block is a 16x16x16 texel volume. X runs right-and-down the screen, Y runs
# left-and-down, Z runs up. In true isometric the hidden back-bottom corner
# projects onto the same point as the near top corner, which is why a cube this
# size lands in a square bounding box.

T = 26                      # screen pixels per texel along one axis
MARGIN = 32                 # transparent border around the cube
SIZE = 32 * T + 2 * MARGIN  # canvas edge; the cube is 32*T of it
ORIGIN = (SIZE // 2, MARGIN)                 # screen position of the top corner
CUT = 8                     # texel where the corner cut starts, on all three axes

# T must stay even: the projection halves T * (x + y), and an odd T would put
# alternate texel corners half a pixel off the lattice, leaving seams.
assert T % 2 == 0, "texel size must be even"

# Line weights follow the texel size so the mark looks the same at any T.
LINE = max(2, round(T * 3 / 14))
BLOOM = T / 2.0

# --- palette ------------------------------------------------------------------
#
# Greens sampled from background_slimelab.png so the mark and the background
# read as one image.

SLIME_DIM = (47, 110, 53)
SLIME = (85, 190, 95)
SLIME_HOT = (170, 250, 170)
INK = (6, 10, 9)

FACE_LIGHT = {"top": 1.0, "left": 0.78, "right": 0.58}


def texel_to_screen(x, y, z):
    """Project texel-space (x, y, z) to integer screen pixels."""
    sx = ORIGIN[0] + T * (x - y)
    sy = ORIGIN[1] + (T * (x + y)) // 2 + T * (16 - z)
    return sx, sy


def shade(rgb, factor):
    """Multiply a colour, keeping it in range."""
    return tuple(min(255, max(0, int(c * factor))) for c in rgb)


def mix(a, b, t):
    """Linear blend from a to b."""
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def load_bedrock_texture():
    """The vanilla bedrock texture, fetched once and cached outside git."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "bedrock.png")
    if not os.path.exists(path):
        with urllib.request.urlopen(BEDROCK_URL, timeout=30) as response:
            with open(path, "wb") as handle:
                handle.write(response.read())
    return Image.open(path).convert("RGB")


# --- interior surfaces --------------------------------------------------------
#
# Each exposed interior surface is an 8x8 texel patch. The patterns are built in
# texel space, so the isometric projection carries them onto the plane for free:
# floor lines converge the way the block's own edges do.

INNER = 16 - CUT            # 8 texels on a side


def inner_floor(u, v):
    """Chunk grid on the horizontal cut face.

    The radius ring that sits on top of this is drawn as a projected circle
    rather than out of texels; at eight texels a side, a rasterised circle reads
    as a blob.
    """
    base = mix(INK, SLIME_DIM, 0.22)
    if u % 2 == 0 or v % 2 == 0:
        return mix(base, SLIME, 0.38)
    return base


def inner_wall_x(u, v):
    """Layer lines and a tick column, on the wall facing screen-right.

    `u` runs along Y (into the block), `v` runs down from the top of the notch.
    """
    base = mix(INK, SLIME_DIM, 0.12)
    if v in (2, 5):
        return mix(base, SLIME, 0.65)           # stacked layers
    if u == INNER - 1 and v % 2 == 1:
        return SLIME_HOT                        # measurement ticks up the edge
    return base


def inner_wall_y(u, v):
    """A column trace, on the wall facing screen-left."""
    base = mix(INK, SLIME_DIM, 0.12)
    if u == 3:
        return mix(base, SLIME, 0.70)           # the column
    if u in (1, 6) and v % 2 == 0:
        return mix(base, SLIME, 0.28)
    return base


def texel_to_screen_f(x, y, z):
    """Projection without the rounding, for curves drawn across texels."""
    sx = ORIGIN[0] + T * (x - y)
    sy = ORIGIN[1] + T * (x + y) / 2.0 + T * (16 - z)
    return sx, sy


def floor_ring(radius, steps=96):
    """A circle on the interior floor plane, in screen coordinates.

    Projected rather than rasterised in texel space, so it reads as a ring at
    icon size instead of a cross.
    """
    centre = (16 + CUT) / 2.0
    return [
        texel_to_screen_f(
            centre + radius * math.cos(2 * math.pi * i / steps),
            centre + radius * math.sin(2 * math.pi * i / steps),
            CUT,
        )
        for i in range(steps)
    ]


def draw_quad(draw, corners, colour):
    """Fill one texel-sized quad. Integer corners keep the edges hard."""
    draw.polygon(corners, fill=colour + (255,))


def render_mark():
    """Draw the cut-away bedrock block onto a transparent canvas."""
    texture = load_bedrock_texture()
    pixels = texture.load()

    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Outer faces, each notched by the corner cut.
    for a in range(16):
        for b in range(16):
            # Top face, Z = 16.
            if not (a >= CUT and b >= CUT):
                quad = [
                    texel_to_screen(a, b, 16),
                    texel_to_screen(a + 1, b, 16),
                    texel_to_screen(a + 1, b + 1, 16),
                    texel_to_screen(a, b + 1, 16),
                ]
                draw_quad(draw, quad, shade(pixels[a, b], FACE_LIGHT["top"]))

            # Right face, X = 16. `a` runs along Y, `b` runs down from the top.
            z = 15 - b
            if not (a >= CUT and z >= CUT):
                quad = [
                    texel_to_screen(16, a, z + 1),
                    texel_to_screen(16, a + 1, z + 1),
                    texel_to_screen(16, a + 1, z),
                    texel_to_screen(16, a, z),
                ]
                draw_quad(draw, quad, shade(pixels[a, b], FACE_LIGHT["right"]))

            # Left face, Y = 16. `a` runs along X.
            if not (a >= CUT and z >= CUT):
                quad = [
                    texel_to_screen(a, 16, z + 1),
                    texel_to_screen(a + 1, 16, z + 1),
                    texel_to_screen(a + 1, 16, z),
                    texel_to_screen(a, 16, z),
                ]
                draw_quad(draw, quad, shade(pixels[15 - a, b], FACE_LIGHT["left"]))

    # Interior of the cut: floor at Z = CUT, walls at X = CUT and Y = CUT.
    for u in range(INNER):
        for v in range(INNER):
            x, y = CUT + u, CUT + v
            quad = [
                texel_to_screen(x, y, CUT),
                texel_to_screen(x + 1, y, CUT),
                texel_to_screen(x + 1, y + 1, CUT),
                texel_to_screen(x, y + 1, CUT),
            ]
            draw_quad(draw, quad, inner_floor(u, v))

            z = 15 - v
            y2 = CUT + u
            quad = [
                texel_to_screen(CUT, y2, z + 1),
                texel_to_screen(CUT, y2 + 1, z + 1),
                texel_to_screen(CUT, y2 + 1, z),
                texel_to_screen(CUT, y2, z),
            ]
            draw_quad(draw, quad, inner_wall_x(u, v))

            x2 = CUT + u
            quad = [
                texel_to_screen(x2, CUT, z + 1),
                texel_to_screen(x2 + 1, CUT, z + 1),
                texel_to_screen(x2 + 1, CUT, z),
                texel_to_screen(x2, CUT, z),
            ]
            draw_quad(draw, quad, inner_wall_y(u, v))

    # The radius indicator sitting on the grid, and its centre mark.
    ring = floor_ring(2.9)
    draw.line(ring + [ring[0]], fill=SLIME_HOT + (255,), width=LINE)
    centre = (16 + CUT) / 2.0
    draw.polygon(
        [
            texel_to_screen_f(centre - 0.6, centre - 0.6, CUT),
            texel_to_screen_f(centre + 0.6, centre - 0.6, CUT),
            texel_to_screen_f(centre + 0.6, centre + 0.6, CUT),
            texel_to_screen_f(centre - 0.6, centre + 0.6, CUT),
        ],
        fill=SLIME_HOT + (255,),
    )

    return canvas


def cut_edges():
    """The six edges where the cut meets the outside of the block."""
    p = texel_to_screen
    return [
        # Lip of the notch on the top face.
        (p(CUT, CUT, 16), p(16, CUT, 16)),
        (p(CUT, CUT, 16), p(CUT, 16, 16)),
        # Where each interior wall meets its outer face.
        (p(16, CUT, 16), p(16, CUT, CUT)),
        (p(CUT, 16, 16), p(CUT, 16, CUT)),
        # The two inner corners of the floor.
        (p(CUT, CUT, CUT), p(16, CUT, CUT)),
        (p(CUT, CUT, CUT), p(CUT, 16, CUT)),
    ]


def add_rim_light(mark):
    """Trace the cut edges in slime green, with a soft bloom behind them."""
    lines = Image.new("RGBA", mark.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(lines)
    for start, end in cut_edges():
        draw.line([start, end], fill=SLIME_HOT + (255,), width=LINE)

    bloom = lines.filter(ImageFilter.GaussianBlur(BLOOM))
    bloom.putalpha(bloom.getchannel("A").point(lambda a: int(a * 0.85)))

    out = mark.copy()
    out.alpha_composite(bloom)
    out.alpha_composite(lines)
    return out


def add_outline(mark, colour=INK, width=None):
    """Ring the silhouette so the mark holds together on a busy background."""
    width = LINE if width is None else width
    alpha = mark.getchannel("A").point(lambda a: 255 if a > 8 else 0)
    grown = alpha.filter(ImageFilter.MaxFilter(width * 2 + 1))
    outline = Image.new("RGBA", mark.size, colour + (255,))
    outline.putalpha(grown)
    outline.alpha_composite(mark)
    return outline


def add_underlight(mark):
    """Green bounce from below, as if the block were lit by the slime pool."""
    width, height = mark.size
    light = Image.new("RGBA", mark.size, (0, 0, 0, 0))
    pixels = light.load()
    for y in range(height):
        # Strongest at the bottom, gone by the middle of the block.
        t = max(0.0, (y - height * 0.58) / (height * 0.42))
        a = int(70 * t * t)
        if a == 0:
            continue
        for x in range(width):
            pixels[x, y] = SLIME + (a,)
    light.putalpha(
        Image.composite(light.getchannel("A"), Image.new("L", mark.size, 0), mark.getchannel("A"))
    )
    out = mark.copy()
    out.alpha_composite(light)
    return out


def build_identity():
    """The mark on its own, ready to drop onto anything."""
    mark = render_mark()
    mark = add_underlight(mark)
    mark = add_rim_light(mark)
    return add_outline(mark)


def build_composite(identity, background_path):
    """The mark seated in the slime pool of the lab background."""
    background = Image.open(background_path).convert("RGBA")
    scene = background.copy()

    # The mark is rendered at the size it is pasted at, so nothing is resampled
    # and the texel edges stay hard. The block is the subject; the lab behind it
    # is a backdrop, so it fills most of the frame.
    size = identity.width
    left = (scene.width - size) // 2
    top = 56

    # Where the cube itself sits inside its transparent border.
    cube_left = left + MARGIN
    cube_right = left + size - MARGIN
    cube_bottom = top + size - MARGIN

    # Slime light pooling around the base of the block.
    glow = Image.new("RGBA", scene.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [cube_left + 40, cube_bottom - 190, cube_right - 40, cube_bottom + 60],
        fill=SLIME + (95,),
    )
    scene.alpha_composite(glow.filter(ImageFilter.GaussianBlur(46)))

    scene.alpha_composite(identity, (left, top))
    return scene


OUTPUTS = {
    "identity": os.path.join(HERE, "identity_bedrock_cutaway.png"),
    "composite": os.path.join(HERE, "pack_icon_1024.png"),
    # Kept alongside the other renders so the shipped icon can be previewed at
    # the size the game actually draws it, without opening the pack root.
    "preview": os.path.join(HERE, "pack_icon_256.png"),
    "pack_icon": os.path.join(ROOT, "pack_icon.png"),
}


def main():
    identity = build_identity()
    identity.save(OUTPUTS["identity"])

    composite = build_composite(identity, os.path.join(HERE, "background_slimelab.png"))
    composite.save(OUTPUTS["composite"])

    # The game shows the icon small; an exact 4:1 box reduction keeps the
    # pixel art from shimmering. The same image is written twice: once where the
    # pack ships it from, once in branding/ as a preview.
    icon = composite.resize((256, 256), Image.BOX).convert("RGBA")
    icon.save(OUTPUTS["pack_icon"])
    icon.save(OUTPUTS["preview"])

    for name, path in OUTPUTS.items():
        print(f"{name}: {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
