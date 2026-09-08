#!/usr/bin/env python3
"""Generates Lectio.rbxlx — a Roblox place replicating enjoyhim.org (Lectio)."""
import math
import xml.sax.saxutils as sx
from pathlib import Path

ROOT = Path(__file__).parent

MATERIALS = {
    "Plastic": 256,
    "SmoothPlastic": 272,
    "Neon": 288,
    "Wood": 512,
    "WoodPlanks": 528,
    "Marble": 784,
    "Slate": 800,
    "Concrete": 816,
    "Granite": 832,
    "Brick": 848,
    "Cobblestone": 880,
    "Metal": 1088,
    "Grass": 1280,
    "Sand": 1296,
    "Glass": 1568,
}
SHAPES = {"Ball": 0, "Block": 1, "Cylinder": 2}

# Morning sanctuary colors, shared visually with ReadingTheme.lua and the site.
PALETTE = {
    "parchment": (245, 239, 226),
    "cream": (252, 248, 236),
    "wash": (236, 228, 208),
    "line": (221, 209, 180),
    "olive": (102, 116, 74),
    "olive_light": (168, 172, 132),
    "gold": (150, 119, 46),
    "gold_soft": (181, 154, 94),
    "terracotta": (160, 85, 47),
    "ink": (58, 52, 42),
}

_refs = [0]


def ref():
    _refs[0] += 1
    return f"RBX{_refs[0]}"


def c3uint(rgb):
    r, g, b = rgb
    return (255 << 24) | (r << 16) | (g << 8) | b


def esc(s):
    return sx.escape(s)


def yaw_pitch_matrix(yaw=0.0, pitch=0.0):
    cy, sy = math.cos(yaw), math.sin(yaw)
    cx, sx_ = math.cos(pitch), math.sin(pitch)
    # R = Ry(yaw) * Rx(pitch)
    r00, r01, r02 = cy, sx_ * sy, cx * sy
    r10, r11, r12 = 0.0, cx, -sx_
    r20, r21, r22 = -sy, sx_ * cy, cx * cy
    return r00, r01, r02, r10, r11, r12, r20, r21, r22


def part(
    name,
    size,
    pos,
    rgb,
    mat="Plastic",
    yaw=0.0,
    pitch=0.0,
    shape="Block",
    transparency=0.0,
    cancollide=True,
    light=None,
    parent_tag="WS",
):
    r00, r01, r02, r10, r11, r12, r20, r21, r22 = yaw_pitch_matrix(yaw, pitch)
    x, y, z = pos
    sx_, sy_, sz_ = size
    lines = [
        f'<Item class="Part" referent="{ref()}">',
        "<Properties>",
        f'<string name="Name">{esc(name)}</string>',
        f'<bool name="Anchored">true</bool>',
        f'<bool name="CanCollide">{str(cancollide).lower()}</bool>',
        f'<bool name="CastShadow">true</bool>',
        f'<float name="Transparency">{transparency}</float>',
        f'<float name="Reflectance">0</float>',
        f'<token name="Material">{MATERIALS[mat]}</token>',
        f'<token name="shape">{SHAPES[shape]}</token>',
        f'<Color3uint8 name="Color3uint8">{c3uint(rgb)}</Color3uint8>',
        f'<Vector3 name="size"><X>{sx_}</X><Y>{sy_}</Y><Z>{sz_}</Z></Vector3>',
        (
            f'<CoordinateFrame name="CFrame"><X>{x}</X><Y>{y}</Y><Z>{z}</Z>'
            f"<R00>{r00}</R00><R01>{r01}</R01><R02>{r02}</R02>"
            f"<R10>{r10}</R10><R11>{r11}</R11><R12>{r12}</R12>"
            f"<R20>{r20}</R20><R21>{r21}</R21><R22>{r22}</R22></CoordinateFrame>"
        ),
        '<token name="TopSurface">0</token>',
        '<token name="BottomSurface">0</token>',
        "</Properties>",
    ]
    if light:
        br, rg, lrgb = light
        lines += [
            f'<Item class="PointLight" referent="{ref()}">',
            "<Properties>",
            f'<bool name="Enabled">true</bool>',
            f'<float name="Brightness">{br}</float>',
            f'<float name="Range">{rg}</float>',
            f'<Color3 name="Color"><R>{lrgb[0]}</R><G>{lrgb[1]}</G><B>{lrgb[2]}</B></Color3>',
            "</Properties>",
            "</Item>",
        ]
    lines.append("</Item>")
    return lines


def script_item(class_name, name, source, extra_props=None):
    lines = [
        f'<Item class="{class_name}" referent="{ref()}">',
        "<Properties>",
        f'<string name="Name">{esc(name)}</string>',
    ]
    if extra_props:
        lines += extra_props
    lines += [
        f'<ProtectedString name="Source">{esc(source)}</ProtectedString>',
        "</Properties>",
        "</Item>",
    ]
    return lines


def attributes_blob(attrs):
    """Roblox AttributesSerialize payload (rbx-dom spec): a little-endian u32
    attribute count, then per attribute a length-prefixed name, a type byte
    (0x02 = String) and a length-prefixed string value. No version byte."""
    import struct

    def string(value):
        raw = value.encode("utf-8")
        return struct.pack("<I", len(raw)) + raw

    blob = struct.pack("<I", len(attrs))
    for key, value in attrs.items():
        blob += string(key) + b"\x02" + string(value)
    return blob


def base64_blob(attrs):
    import base64

    return base64.b64encode(attributes_blob(attrs)).decode("ascii")


def load_api_key():
    """The shared secret for /api/roblox/*, read from the environment or a
    local .env so the secret never lands in the repository."""
    import os

    key = os.environ.get("ROBLOX_API_KEY", "")
    if key:
        return key
    for candidate in (ROOT.parent.parent / ".env", ROOT / ".env"):
        if candidate.is_file():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                if line.startswith("ROBLOX_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return ""


def services():
    lighting = f'''<Item class="Lighting" referent="{ref()}">
<Properties>
<string name="Name">Lighting</string>
<float name="Brightness">2.5</float>
<float name="ClockTime">9.5</float>
<bool name="GlobalShadows">true</bool>
<float name="EnvironmentDiffuseScale">0.5</float>
<float name="EnvironmentSpecularScale">0.4</float>
<float name="ExposureCompensation">0.1</float>
<Color3 name="Ambient"><R>0.52</R><G>0.47</G><B>0.37</B></Color3>
<Color3 name="OutdoorAmbient"><R>0.64</R><G>0.60</G><B>0.49</B></Color3>
<Color3 name="ColorShift_Bottom"><R>0</R><G>0</G><B>0</B></Color3>
<Color3 name="ColorShift_Top"><R>0.07</R><G>0.04</G><B>0.01</B></Color3>
</Properties>
<Item class="Atmosphere" referent="{ref()}">
<Properties>
<string name="Name">Atmosphere</string>
<float name="Density">0.26</float>
<float name="Offset">0.6</float>
<float name="Glare">0.2</float>
<float name="Haze">1.6</float>
<Color3 name="Color"><R>0.90</R><G>0.85</G><B>0.73</B></Color3>
<Color3 name="Decay"><R>0.58</R><G>0.53</G><B>0.42</B></Color3>
</Properties>
</Item>
</Item>'''
    return lighting


def bible_cover(name, x, title):
    """A physical cover with surface lettering, visible without client scripts."""
    cover = part(name, (2.2, 0.14, 3.2), (x, 5.53, -49), PALETTE["terracotta"], cancollide=False)
    label = wrap(
        "TextLabel",
        "CoverTitle",
        "",
        extra=f"""
<UDim2 name="Size"><XS>1</XS><XO>0</XO><YS>1</YS><YO>0</YO></UDim2>
<float name="BackgroundTransparency">1</float>
<bool name="TextScaled">true</bool><bool name="TextWrapped">true</bool>
<Color3 name="TextColor3"><R>0.90</R><G>0.75</G><B>0.39</B></Color3>
<string name="Text">{esc(title)}</string>""",
    )
    surface = wrap(
        "SurfaceGui",
        "CoverLettering",
        label,
        extra="""
<token name="Face">1</token><bool name="AlwaysOnTop">false</bool>
<float name="LightInfluence">0</float>
<Vector2 name="CanvasSize"><X>320</X><Y>480</Y></Vector2>""",
    )
    cover.insert(-1, surface)
    return cover


def movement_plaque(name, x, title, invitation, color):
    """Inward-facing chapel lettering, visible before any client script runs."""
    plaque = part(name, (6.0, 3.4, 0.3), (x, 6.7, -55.95), color, yaw=math.pi)
    text = wrap(
        "TextLabel", "MovementLettering", "",
        extra=f"""
<UDim2 name="Position"><XS>0.06</XS><XO>0</XO><YS>0.08</YS><YO>0</YO></UDim2>
<UDim2 name="Size"><XS>0.88</XS><XO>0</XO><YS>0.84</YS><YO>0</YO></UDim2>
<float name="BackgroundTransparency">1</float>
<bool name="TextScaled">true</bool><bool name="TextWrapped">true</bool>
<Color3 name="TextColor3"><R>0.99</R><G>0.97</G><B>0.93</B></Color3>
<string name="Text">{esc(title + chr(10) + chr(10) + invitation)}</string>""",
    )
    plaque.insert(-1, wrap(
        "SurfaceGui", "MovementSign", text,
        extra="""
<token name="Face">5</token><bool name="AlwaysOnTop">false</bool>
<float name="LightInfluence">0</float>
<Vector2 name="CanvasSize"><X>600</X><Y>340</Y></Vector2>""",
    ))
    return plaque


def build_world():
    items = []
    P = part

    # ground & plaza
    items += P("Ground", (600, 2, 600), (0, -1, 0), PALETTE["olive_light"], "Grass")
    items += P("Plaza", (110, 1, 130), (0, 0.5, 5), PALETTE["wash"], "Concrete")
    items += P("ChapelFloor", (36, 1.6, 32), (0, 1.0, -40), PALETTE["parchment"], "Marble")
    items += P("ChapelStep", (14, 0.4, 4), (0, 1.2, -26.5), PALETTE["line"], "Marble")

    # colonnade + roof
    for x in (-13, 13):
        for z in (-27, -53):
            items += P(
                f"Column{x}_{z}", (3, 16, 3), (x, 9.8, z), PALETTE["cream"], "Marble"
            )
    items += P("Roof", (38, 1.6, 36), (0, 18.6, -40), PALETTE["terracotta"], "Wood")
    items += P("RoofTrim", (40, 0.8, 3), (0, 19.8, -40), PALETTE["gold_soft"], "Metal")

    # back wall + stained glass
    items += P("BackWall", (36, 14, 2), (0, 9.4, -57.5), PALETTE["parchment"], "Marble")
    glass_colors = [
        (196, 158, 138),
        PALETTE["olive_light"],
        (214, 178, 116),
        PALETTE["olive_light"],
        (196, 158, 138),
    ]
    for i, gx in enumerate((-12, -6, 0, 6, 12)):
        items += P(
            f"Glass{i}", (4.5, 8, 0.6), (gx, 10.4, -56.3), glass_colors[i], "Glass", transparency=0.12
        )

    # altar + open bible
    items += P("Altar", (9, 3, 3.5), (0, 3.3, -49), PALETTE["cream"], "Marble")
    items += P(
        "AltarBible",
        (4.4, 0.35, 3.1),
        (0, 5.15, -49),
        (124, 64, 52),
        transparency=1,
        cancollide=False,
    )
    book = []
    book += bible_cover("CoverLeft", -1.1, "✝\n\nLECTIO")
    book += bible_cover("CoverRight", 1.1, "HOLY\nBIBLE\n\n圣经")
    book += P(
        "BackCover", (4.5, 0.13, 3.25), (0, 5.05, -49), (132, 69, 31), cancollide=False
    )
    book += P(
        "PageBlock",
        (4.1, 0.30, 2.95),
        (0, 5.28, -49),
        PALETTE["cream"],
        cancollide=False,
    )
    book += P(
        "Spine", (0.16, 0.46, 3.2), (0, 5.30, -49), PALETTE["gold"], cancollide=False
    )
    for index, y in enumerate((5.19, 5.27, 5.35)):
        book += P(
            f"GiltPageEdge{index}",
            (4.12, 0.012, 2.97),
            (0, y, -49),
            PALETTE["gold_soft"],
            cancollide=False,
        )
    for name, x, color in (
        ("RibbonToday", -1.65, PALETTE["olive"]),
        ("RibbonDaily", -0.55, PALETTE["gold_soft"]),
        ("RibbonDivina", 0.55, PALETTE["terracotta"]),
        ("RibbonDeep", 1.65, PALETTE["ink"]),
    ):
        book += P(name, (0.45, 0.06, 1.1), (x, 5.4, -47.55), color, cancollide=False)
    items.append(wrap("Model", "BibleVisual", "\n".join(book)))
    items += P(
        "Contact",
        (0.15, 0.15, 0.15),
        (0.8, 5.75, -47.8),
        (255, 255, 255),
        transparency=1,
        cancollide=False,
    )
    items += P(
        "PageDestination",
        (0.15, 0.15, 0.15),
        (0, 7.5, -46.8),
        (255, 255, 255),
        transparency=1,
        cancollide=False,
    )

    # Public welcome sits on the chapel's inward face, ahead of the back wall.
    items += P("BoardTrim", (17, 6.4, 0.4), (0, 12.0, -55.8), PALETTE["gold_soft"], "Metal")
    items += P(
        "VerseBoard", (16.4, 5.8, 0.35), (0, 12.0, -55.5), PALETTE["ink"], "Wood", yaw=math.pi
    )
    for name, x, title, invitation, color in (
        ("MovementRead", -11.4, "LECTIO · Read · 诵读", "Read slowly.\n慢慢地读。", PALETTE["olive"]),
        ("MovementReflect", -3.8, "MEDITATIO · Reflect · 默想", "Let a word touch your day.\n让经文触到你的生活。", PALETTE["terracotta"]),
        ("MovementRespond", 3.8, "ORATIO · Respond · 祈祷", "Answer in your own words.\n用自己的话回应。", PALETTE["gold"]),
        ("MovementRest", 11.4, "CONTEMPLATIO · Rest · 默观", "Be still. Rest here.\n安静下来，在此安歇。", PALETTE["olive"]),
    ):
        items += movement_plaque(name, x, title, invitation, color)

    # candelights
    for x in (-6, 6):
        items += P(
            f"CandlePole{x}", (0.5, 6, 0.5), (x, 4.8, -44), (120, 90, 64), "Wood"
        )
        items += P(
            f"CandleFlame{x}",
            (0.7, 0.7, 0.7),
            (x, 8.2, -44),
            (255, 214, 140),
            "Neon",
            light=(1.4, 22, (1.0, 0.84, 0.6)),
        )

    # spawn
    items += [
        f'<Item class="SpawnLocation" referent="{ref()}">',
        "<Properties>",
        '<string name="Name">SpawnLocation</string>',
        '<bool name="Anchored">true</bool>',
        '<bool name="Neutral">true</bool>',
        '<float name="Duration">0</float>',
        '<Color3uint8 name="Color3uint8">'
        + str(c3uint((205, 199, 186)))
        + "</Color3uint8>",
        '<float name="Transparency">1</float>',
        '<bool name="CanCollide">false</bool>',
        '<Vector3 name="size"><X>4</X><Y>0.2</Y><Z>4</Z></Vector3>',
        '<CoordinateFrame name="CFrame"><X>0</X><Y>2</Y><Z>-45</Z>'
        "<R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12>"
        "<R20>0</R20><R21>0</R21><R22>1</R22></CoordinateFrame>",
        '<token name="TopSurface">0</token>',
        '<token name="BottomSurface">0</token>',
        "</Properties>",
        "</Item>",
    ]

    # stone path
    z = 42
    i = 0
    while z >= 10:
        items += P(
            f"Path{i}", (5, 0.35, 3.4), (0, 1.05, z), PALETTE["line"], "Cobblestone"
        )
        z -= 5
        i += 1

    # lanterns
    for lx, lz in ((-6.5, 34), (6.5, 34), (-6.5, 14), (6.5, 14)):
        items += P(
            f"LanternPost{lx}_{lz}",
            (0.7, 4.5, 0.7),
            (lx, 2.75, lz),
            (110, 80, 58),
            "Wood",
        )
        items += P(
            f"LanternGlow{lx}_{lz}",
            (1.1, 1.1, 1.1),
            (lx, 5.5, lz),
            (255, 214, 140),
            "Neon",
            light=(1.6, 24, (1.0, 0.85, 0.62)),
        )

    # pond
    items += P("PondBed", (20, 0.6, 17), (42, 0.8, 30), PALETTE["line"], "Sand")
    items += P(
        "PondWater",
        (19, 1.2, 16),
        (42, 1.05, 30),
        (139, 157, 140),
        "Glass",
        transparency=0.45,
        cancollide=False,
    )

    # trees
    trees = [
        (-40, 30),
        (-55, -5),
        (-35, -35),
        (45, -20),
        (35, 55),
        (-45, 55),
        (60, 10),
        (55, 42),
        (-60, 20),
    ]
    for i, (tx, tz) in enumerate(trees):
        items += P(f"TreeTrunk{i}", (1.8, 8, 1.8), (tx, 4.5, tz), (90, 60, 45), "Wood")
        items += P(
            f"TreeTop{i}",
            (10, 10, 10),
            (tx, 11, tz),
            PALETTE["olive"],
            "Grass",
            shape="Ball",
        )
        items += P(
            f"TreeTop2{i}",
            (6.5, 6.5, 6.5),
            (tx + 1.5, 14.5, tz + 0.5),
            (131, 143, 101),
            "Grass",
            shape="Ball",
        )

    # benches inside the chapel
    for bx in (-10, 10):
        items += P(
            f"BenchSeat{bx}",
            (4.5, 0.5, 1.6),
            (bx, 1.75, -18),
            (146, 108, 74),
            "WoodPlanks",
        )
        items += P(
            f"BenchBack{bx}",
            (4.5, 1.4, 0.4),
            (bx, 2.6, -18.9),
            (146, 108, 74),
            "WoodPlanks",
        )
        items += P(
            f"BenchLegL{bx}",
            (0.4, 0.75, 1.4),
            (bx - 1.8, 1.35, -18),
            (120, 88, 60),
            "Wood",
        )
        items += P(
            f"BenchLegR{bx}",
            (0.4, 0.75, 1.4),
            (bx + 1.8, 1.35, -18),
            (120, 88, 60),
            "Wood",
        )

    # rolling hills at the horizon
    hills = [
        (180, 180),
        (-180, 180),
        (180, -180),
        (-180, -180),
        (0, -240),
        (240, 0),
        (-240, 0),
        (0, 250),
    ]
    for i, (hx, hz) in enumerate(hills):
        d = 110 if abs(hx) < 10 or abs(hz) < 10 else 80
        items += P(
            f"Hill{i}",
            (d, d, d),
            (hx, -d / 2 + 14, hz),
            (142, 153, 111),
            "Grass",
            shape="Ball",
        )

    # register desk
    items += P("RegisterDesk", (7, 3.6, 3), (14, 2.8, 26), (110, 82, 58), "Wood")
    items += P("RegisterTop", (7.4, 0.4, 3.4), (14, 4.8, 26), PALETTE["cream"], "Marble")
    items += P(
        "RegisterSign", (3.4, 1.6, 0.3), (14, 6.2, 26), PALETTE["gold_soft"], "SmoothPlastic"
    )

    # assistant statue
    items += P(
        "AssistantPedestal", (2.4, 1.2, 2.4), (-16, 1.6, 26), PALETTE["wash"], "Marble"
    )
    items += P(
        "AssistantRobe", (1.8, 3.4, 1.8), (-16, 3.9, 26), PALETTE["cream"], "Marble"
    )
    items += P(
        "AssistantHead",
        (1.6, 1.6, 1.6),
        (-16, 6.1, 26),
        (232, 214, 190),
        "SmoothPlastic",
        shape="Ball",
    )
    items += P(
        "AssistantNPC",
        (0.9, 0.9, 0.9),
        (-16, 7.7, 26),
        (255, 222, 130),
        "Neon",
        light=(1.2, 16, (1.0, 0.9, 0.7)),
    )

    # verse library shelf
    items += P("LibraryWall", (11, 7.5, 1.8), (16, 4.75, 44), (104, 76, 52), "Wood")
    book_colors = [
        PALETTE["terracotta"],
        PALETTE["olive"],
        PALETTE["gold_soft"],
        PALETTE["olive_light"],
        PALETTE["ink"],
        (125, 116, 98),
        (196, 158, 138),
        PALETTE["parchment"],
        PALETTE["gold"],
    ]
    for i, bx in enumerate([12.3, 13.4, 14.5, 15.6, 16.7, 17.8, 18.9, 20.0]):
        items += P(
            f"Book{i}",
            (0.85, 4.6, 0.5),
            (bx, 4.4, 43.1),
            book_colors[i],
            "SmoothPlastic",
        )

    # floating light motes above the altar
    items += [
        f'<Item class="Part" referent="{ref()}">',
        "<Properties>",
        '<string name="Name">Motes</string>',
        '<bool name="Anchored">true</bool>',
        '<bool name="CanCollide">false</bool>',
        '<float name="Transparency">1</float>',
        '<token name="Material">256</token>',
        '<token name="shape">1</token>',
        '<Color3uint8 name="Color3uint8">'
        + str(c3uint((255, 255, 255)))
        + "</Color3uint8>",
        '<Vector3 name="size"><X>1</X><Y>1</Y><Z>1</Z></Vector3>',
        '<CoordinateFrame name="CFrame"><X>0</X><Y>9</Y><Z>-44</Z>'
        "<R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12>"
        "<R20>0</R20><R21>0</R21><R22>1</R22></CoordinateFrame>",
        "</Properties>",
        f'<Item class="ParticleEmitter" referent="{ref()}">',
        "<Properties>",
        '<string name="Name">MotesEmitter</string>',
        '<float name="Rate">5</float>',
        '<float name="Speed">1.5</float>',
        '<NumberRange name="Lifetime">2 5</NumberRange>',
        '<NumberRange name="Rotation">0 360</NumberRange>',
        '<NumberRange name="RotSpeed">-20 20</NumberRange>',
        '<bool name="Enabled">true</bool>',
        '<float name="LightEmission">1</float>',
        '<float name="LightInfluence">0</float>',
        "</Properties>",
        "</Item>",
        "</Item>",
    ]

    return items


def wrap(class_name, name, children, extra=""):
    return f'''<Item class="{class_name}" referent="{ref()}">
<Properties>
<string name="Name">{esc(name)}</string>
{extra}
</Properties>
{children}
</Item>'''


def build_document(embed_key=False, include_tests=False):
    _refs[0] = 0
    (ROOT / "src_verse_data.lua").read_text(encoding="utf-8")
    verse_data = (ROOT / "src_verse_data.lua").read_text(encoding="utf-8")
    server = (ROOT / "src_server.lua").read_text(encoding="utf-8")
    client = (ROOT / "src_client.lua").read_text(encoding="utf-8")

    ws_children = "\n".join(build_world())
    workspace = wrap(
        "Workspace",
        "Workspace",
        ws_children,
        extra='<float name="Gravity">196.2</float>',
    )

    api_key = load_api_key() if embed_key else ""
    server_extra = None
    if api_key:
        server_extra = [
            f'<BinaryString name="AttributesSerialize">{base64_blob({"LectioApiKey": api_key})}</BinaryString>'
        ]
    modules = []
    server_modules = []
    for path in sorted((ROOT / "modules").glob("*.lua")):
        target = server_modules if path.stem == "DrawRequests" else modules
        target += script_item(
            "ModuleScript", path.stem, path.read_text(encoding="utf-8")
        )
    rstorage = wrap(
        "ReplicatedStorage",
        "ReplicatedStorage",
        "\n".join(script_item("ModuleScript", "VerseData", verse_data))
        + wrap("Folder", "LectioModules", "\n".join(modules)),
    )
    if include_tests:
        server_modules += script_item(
            "Script",
            "NativeTests",
            (ROOT / "tests/run.lua").read_text(encoding="utf-8"),
        )
    sss = wrap(
        "ServerScriptService",
        "ServerScriptService",
        "\n".join(
            script_item("Script", "LectioServer", server, extra_props=server_extra)
            + server_modules
        ),
    )
    sps = wrap(
        "StarterPlayerScripts",
        "StarterPlayerScripts",
        "\n".join(script_item("LocalScript", "LectioClient", client)),
    )
    starter_player = wrap("StarterPlayer", "StarterPlayer", sps)
    http_service = (
        wrap(
            "HttpService",
            "HttpService",
            "",
            extra='<bool name="HttpEnabled">true</bool>',
        )
        if api_key
        else ""
    )

    doc = f"""<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
{services()}
{http_service}
{workspace}
{rstorage}
{sss}
{starter_player}
</roblox>"""
    return doc


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--embed-api-key",
        action="store_true",
        help="Private local builds only; never commit this output",
    )
    parser.add_argument("--include-tests", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "Lectio.rbxlx")
    args = parser.parse_args()
    doc = build_document(args.embed_api_key, args.include_tests)

    out = args.output
    out.write_text(doc, encoding="utf-8")

    import xml.dom.minidom

    xml.dom.minidom.parse(str(out))
    print(f"Wrote {out} ({out.stat().st_size} bytes), XML well-formed")


if __name__ == "__main__":
    main()
