"""Bake the local material trial into a self-contained GLB (NumPy + Pillow).

The OBJ positions, face winding and normals are copied in BodyParts3D space.
Three.js applies its existing shared torso transform when it loads the file.
"""

import io
import json
import math
import struct
from functools import partial
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
TILE, PAD = 24, 4
ESOPHAGUS_COLOR = (217, 136, 206)
STOMACH_COLOR = (228, 129, 151)
PANCREAS_COLOR = (232, 169, 78)
LIVER_COLOR = (177, 97, 65)
COLON_COLOR = (150, 146, 228)
SMALL_INTESTINE_COLOR = (246, 153, 117)


def unit(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def display_color(palette):
    return "#" + "".join(f"{channel:02x}" for channel in palette)


def read_obj(filename, *, indexed=False):
    positions, normals, faces = [], [], []
    for line in filename.read_text().splitlines():
        if line.startswith("v "):
            positions.append(list(map(float, line.split()[1:])))
        elif line.startswith("vn "):
            normals.append(list(map(float, line.split()[1:])))
        elif line.startswith("f "):
            face = [token.split("/") for token in line.split()[1:]]
            if len(face) != 3 or any(len(corner) != 3 or not corner[2] for corner in face):
                raise ValueError(f"Expected triangles with normals in {filename}")
            faces.append([[int(corner[0]) - 1, int(corner[2]) - 1] for corner in face])
    indices = np.asarray(faces)
    if indexed:
        corners, faces = np.unique(indices.reshape(-1, 2), axis=0, return_inverse=True)
        return np.asarray(positions)[corners[:, 0]], np.asarray(normals)[corners[:, 1]], faces
    return np.asarray(positions)[indices[..., 0]], np.asarray(normals)[indices[..., 1]]


def noise(p, scale, grid, gradient=False):
    """Smooth value noise in model space, optionally with its analytic gradient."""
    point = p / scale
    cell = np.floor(point).astype(np.int32)
    t = point - cell
    w = t * t * (3 - 2 * t)
    d = 6 * t * (1 - t) / scale
    wx, wy, wz = np.moveaxis(w, -1, 0)
    gx, gy, gz = np.moveaxis(cell & 63, -1, 0)
    value = np.zeros_like(wx)
    slope = np.zeros_like(p) if gradient else None
    for dx, dy, dz in np.ndindex(2, 2, 2):
        v = grid[(gx + dx) & 63, (gy + dy) & 63, (gz + dz) & 63]
        x, y, z = wx if dx else 1 - wx, wy if dy else 1 - wy, wz if dz else 1 - wz
        value += v * x * y * z
        if gradient:
            slope[..., 0] += v * (2 * dx - 1) * d[..., 0] * y * z
            slope[..., 1] += v * x * (2 * dy - 1) * d[..., 1] * z
            slope[..., 2] += v * x * y * (2 * dz - 1) * d[..., 2]
    return (value, slope) if gradient else value


def sample_soft_tissue(p, grids, palette, *, gland):
    # Stretch the stomach's relief along the wall; use rounded pockets on the gland.
    stretch = np.ones(3) if gland else np.array([0.58, 0.88, 1.22])
    broad = noise(p, 29 if gland else 44, grids[0])
    detail, d_detail = noise(p * stretch, 8.5 if gland else 13, grids[1], True)
    fine, d_fine = noise(p * stretch, 3.8 if gland else 5.7, grids[2], True)
    gloss = noise(p, 18, grids[3])
    if gland:
        # Round the crests and keep the grooves shallow.
        relief = np.tanh(1.35 * (detail + 0.18))
        d_detail *= (1.35 * (1 - relief * relief))[..., None]
        detail = relief

    rgb = (np.asarray(palette) + broad[..., None] * ([19, 23, 17] if gland else [15, 25, 21])
           + detail[..., None] * ([17, 21, 15] if gland else [10, 14, 11])
           + fine[..., None] * ([7, 6, 5] if gland else [5, 6, 5]))
    slope = ((2.05 if gland else 2.7) * d_detail + (0.40 if gland else 0.48) * d_fine) * stretch
    rough = (0.64 if gland else 0.51) + 0.105 * gloss - 0.055 * detail
    return rgb, slope, rough


def sample_esophagus(p, grids, palette):
    # In BodyParts3D the esophagus runs mainly along Z. Stretch small details
    # in that direction so the wall reads as fibrous rather than ringed.
    stretch = np.array([1.0, 1.0, 0.14])
    tint = noise(p, 39, grids[0])
    fibers, fiber_slope = noise(p * stretch, 5.6, grids[1], True)
    fine, fine_slope = noise(p * stretch, 2.7, grids[2], True)
    sheen = noise(p, 15, grids[3])
    rgb = np.asarray(palette) + tint[..., None] * [12, 19, 13] + fibers[..., None] * [20, 25, 18]
    slope = (1.4 * fiber_slope + 0.26 * fine_slope) * stretch
    rough = 0.54 + 0.09 * sheen - 0.07 * fibers + 0.02 * fine
    return rgb, slope, rough


def bake(positions, normals, palette, sample, seed):
    count = len(positions)
    cols = math.ceil(math.sqrt(count))
    rows = math.ceil(count / cols)
    tile_x, tile_y = np.arange(count) % cols * TILE, np.arange(count) // cols * TILE
    width, height = cols * TILE, rows * TILE
    extent = TILE - 2 * PAD - 1
    uv = (np.stack((tile_x, tile_y), axis=-1)[:, None, :] + PAD + 0.5
          + extent * np.array([[0, 0], [1, 0], [0, 1]])) / [width, height]

    x, y = np.meshgrid(*[(np.arange(TILE) - PAD) / extent] * 2)
    x, y = np.maximum(x, 0), np.maximum(y, 0)
    # Fill the gutters by extending the surface field from each triangle's boundary.
    x, y = x / np.maximum(1, x + y), y / np.maximum(1, x + y)
    weights = np.stack([1 - x - y, x, y], axis=-1)
    grids = np.random.default_rng(seed).uniform(-1, 1, (4, 64, 64, 64)).astype("f")
    color = np.full((height, width, 3), palette, dtype=np.uint8)
    normal_map = np.full_like(color, [128, 128, 255])
    roughness = np.full_like(color, [255, 165, 0])

    edge = positions[:, 1] - positions[:, 0]
    edge2 = positions[:, 2] - positions[:, 0]
    tangent = unit(edge[:, None] - np.sum(edge[:, None] * normals, axis=-1, keepdims=True) * normals)
    sign = np.sign(np.sum(np.cross(normals, tangent) * edge2[:, None], axis=-1, keepdims=True))
    tangents = np.concatenate([tangent, sign], axis=-1)

    def bytes_rgb(a):
        return np.clip(np.rint(a), 0, 255).astype(np.uint8)

    for first in range(0, count, 64):
        stop = min(first + 64, count)
        batch = slice(first, stop)
        p = np.einsum("ijv,nvk->nijk", weights, positions[batch])
        n = unit(np.einsum("ijv,nvk->nijk", weights, normals[batch]))
        t = np.einsum("ijv,nvk->nijk", weights, tangent[batch])
        t = unit(t - n * np.sum(t * n, axis=-1, keepdims=True))
        b = np.cross(n, t) * sign[batch, :1, None, :]
        rgb, slope, rough = sample(p, grids, palette)
        nmap = unit(np.stack([-np.sum(slope * t, axis=-1), -np.sum(slope * b, axis=-1),
                              np.ones(p.shape[:-1])], axis=-1))
        for local, i in enumerate(range(first, stop)):
            tile = np.s_[tile_y[i]:tile_y[i] + TILE, tile_x[i]:tile_x[i] + TILE]
            color[tile] = bytes_rgb(rgb[local])
            normal_map[tile] = bytes_rgb((nmap[local] + 1) * 127.5)
            roughness[tile][..., 1] = bytes_rgb(rough[local] * 255)
    return uv, tangents, (color, normal_map, roughness)


def sample_liver(positions, _normals, _faces, palette):
    grids = np.random.default_rng(711).uniform(-1, 1, (4, 64, 64, 64))
    broad = noise(positions, 55, grids[0])
    detail, detail_slope = noise(positions, 19, grids[1], True)
    fine, fine_slope = noise(positions, 8, grids[2], True)
    sheen = noise(positions, 29, grids[3])
    rgb = (np.array(palette) + broad[:, None] * [21, 17, 13]
           + detail[:, None] * [12, 9, 7] + fine[:, None] * [5, 4, 4])
    return rgb, 2.45 * detail_slope + 0.55 * fine_slope, 0.50 + 0.11 * sheen - 0.06 * detail


def sample_colon(positions, normals, faces, palette):
    grids = np.random.default_rng(197).uniform(-1, 1, (4, 64, 64, 64))
    tint = noise(positions, 38, grids[0])
    wall, wall_slope = noise(positions, 12, grids[1], True)
    grain, grain_slope = noise(positions, 4.8, grids[2], True)
    sheen = noise(positions, 22, grids[3])

    # Estimate signed curvature from changes of the source normals along edges.
    # Darken the existing valleys between haustra without painting new bands.
    triangles = faces.reshape(-1, 3)
    start, end = triangles.ravel(), np.roll(triangles, -1, axis=1).ravel()
    edge = positions[end] - positions[start]
    length_squared = np.einsum("ij,ij->i", edge, edge)
    normal_change = normals[end] - normals[start]
    curvature = np.clip(np.einsum("ij,ij->i", normal_change, edge) / np.maximum(length_squared, 1e-7), -0.15, 0.15)
    corners = np.concatenate((start, end))
    weight = np.bincount(corners, minlength=len(positions))
    total = np.bincount(corners, weights=np.tile(curvature, 2), minlength=len(positions))
    grooves = np.clip((-total / np.maximum(weight, 1) - 0.008) * 25, 0, 1)

    rgb = (np.array(palette) + tint[:, None] * [22, 21, 13] + wall[:, None] * [11, 9, 8]
           + grain[:, None] * [5, 4, 3] - grooves[:, None] * [17, 19, 11])
    slope = 1.85 * wall_slope + 0.48 * grain_slope
    roughness = 0.49 + 0.095 * sheen - 0.05 * wall + 0.08 * grooves
    return rgb, slope, roughness


def sample_small_intestine(positions, _normals, _faces, palette):
    grids = np.random.default_rng(619).uniform(-1, 1, (4, 64, 64, 64))
    tint = noise(positions, 31, grids[0])
    wall, wall_slope = noise(positions, 13, grids[1], True)
    grain, grain_slope = noise(positions, 5.2, grids[2], True)
    sheen = noise(positions, 21, grids[3])
    # Shallow variation on the outside of the loops, with soft highlights.
    rgb = (np.array(palette) + tint[:, None] * [9, 23, 21] + wall[:, None] * [7, 13, 12]
           + grain[:, None] * [3, 5, 5])
    slope = 1.95 * wall_slope + 0.42 * grain_slope
    roughness = 0.48 + 0.085 * sheen - 0.055 * wall
    return rgb, slope, roughness


def bake_dense(rgb, normals, slope, roughness):
    """Encode surface shading as vertex colors and small lookup textures."""
    srgb = np.clip(rgb, 0, 255) / 255
    colors = ((srgb + 0.055) / 1.055) ** 2.4

    n = unit(normals)
    direction = unit(np.array([1.0, 2.0, 3.0]))
    t = np.cross(direction, n)
    length = np.linalg.norm(t, axis=-1)
    poles = length < 1e-8
    t[poles] = np.cross([0, 1, 0], n[poles])
    t = unit(t)
    b = np.cross(n, t)
    tangents = np.column_stack((t, np.ones(len(t))))
    # Fade the perturbation near the two poles of the tangent frame.
    slope = slope * np.minimum(1, length * 6)[:, None]
    offsets = -np.column_stack((np.sum(slope * t, axis=-1), np.sum(slope * b, axis=-1)))

    # Each texel encodes a shading value. This avoids a large UV atlas for the
    # dense source mesh, whose triangles already sample the surface field closely.
    size = 128
    limit = 0.25
    axis = np.linspace(-limit, limit, size)
    x, y = np.meshgrid(axis, axis)
    normal_pixels = np.rint((unit(np.stack((x, y, np.ones_like(x)), axis=-1)) + 1) * 127.5).astype(np.uint8)
    normal_uv = (np.clip(offsets / (2 * limit) + 0.5, 0, 1) * (size - 1) + 0.5) / size
    rough_pixels = np.full((2, 256, 3), [255, 0, 0], dtype=np.uint8)
    rough_pixels[..., 1] = np.arange(256, dtype=np.uint8)
    rough_uv = np.column_stack(((roughness * 255 + 0.5) / 256, np.full(len(roughness), 0.5)))
    return colors, tangents, normal_uv, rough_uv, normal_pixels, rough_pixels


class Glb:
    def __init__(self):
        self.binary = bytearray()
        self.doc = {
            "asset": {"version": "2.0", "generator": "IzNutri local material trial",
                      "copyright": "BodyParts3D, © The Database Center for Life Science, CC BY 4.0",
                      "extras": {"coordinateSystem": "Source BodyParts3D: Z up, negative Y anterior; no transforms",
                                 "source": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html"}},
            "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "accessors": [],
            "bufferViews": [], "images": [], "textures": [], "materials": [],
            "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        }

    def append(self, key, value):
        items = self.doc[key]
        items.append(value)
        return len(items) - 1

    def view(self, data, **kwargs):
        self.binary.extend(bytes(-len(self.binary) % 4))
        i = self.append("bufferViews", dict(buffer=0, byteOffset=len(self.binary), byteLength=len(data), **kwargs))
        self.binary.extend(data)
        return i

    def attribute(self, values, bounds=False):
        a = values.astype("<f4").reshape(-1, values.shape[-1])
        options = {"min": a.min(0).tolist(), "max": a.max(0).tolist()} if bounds else {}
        return self.append("accessors", dict(bufferView=self.view(a.tobytes(), target=34962),
                                             componentType=5126, count=len(a), type=f"VEC{a.shape[-1]}", **options))

    def texture(self, pixels, name):
        stream = io.BytesIO()
        Image.fromarray(pixels).save(stream, format="PNG", optimize=True)
        source = self.append("images", {"name": name, "mimeType": "image/png", "bufferView": self.view(stream.getvalue())})
        return {"index": self.append("textures", {"source": source, "sampler": 0})}

    def add_organ(self, name, obj, attributes, material, **primitive):
        mesh = self.append("meshes", {"name": name, "primitives": [
            {"attributes": attributes, "material": material, **primitive},
        ]})
        node = self.append("nodes", {"name": name, "mesh": mesh, "extras": {"sourceOBJ": obj + ".obj"}})
        self.doc["scenes"][0]["nodes"].append(node)

    def organ(self, name, obj, palette, sample, seed):
        p, n = read_obj(ROOT / "assets" / f"{obj}.obj")
        uv, tangent, (color, normal, rough) = bake(p, n, palette, sample, seed)
        material = self.append("materials", {"name": f"{name} · satin",
            "extras": {"displayColor": display_color(palette)},
            "pbrMetallicRoughness": {
                "baseColorTexture": self.texture(color, f"{name} base color"), "metallicFactor": 0,
                "roughnessFactor": 1, "metallicRoughnessTexture": self.texture(rough, f"{name} roughness"),
            }, "normalTexture": self.texture(normal, f"{name} normal"),
        })
        attributes = {"POSITION": self.attribute(p, bounds=True), "NORMAL": self.attribute(n),
                      "TEXCOORD_0": self.attribute(uv), "TANGENT": self.attribute(tangent)}
        self.add_organ(name, obj, attributes, material)

    def dense_organ(self, name, palette, sample):
        p, n, faces = read_obj(ROOT / "assets" / f"{name}.obj", indexed=True)
        rgb, slope, roughness = sample(p, n, faces, palette)
        colors, tangents, normal_uv, rough_uv, normal, rough = bake_dense(rgb, n, slope, roughness)
        material = self.append("materials", {"name": f"{name} · satin",
            "extras": {"displayColor": display_color(palette)},
            "pbrMetallicRoughness": {
                "metallicFactor": 0, "roughnessFactor": 1,
                "metallicRoughnessTexture": {**self.texture(rough, f"{name} roughness"), "texCoord": 1},
            }, "normalTexture": self.texture(normal, f"{name} normal"),
        })
        attributes = {"POSITION": self.attribute(p, bounds=True), "NORMAL": self.attribute(n),
                      "COLOR_0": self.attribute(colors), "TANGENT": self.attribute(tangents),
                      "TEXCOORD_0": self.attribute(normal_uv), "TEXCOORD_1": self.attribute(rough_uv)}
        # In glTF the highest value of an index component is reserved.
        dtype, component = ("<u2", 5123) if len(p) <= 65535 else ("<u4", 5125)
        indices = self.append("accessors", dict(bufferView=self.view(faces.astype(dtype).tobytes(), target=34963),
                                               componentType=component, count=faces.size, type="SCALAR"))
        self.add_organ(name, name, attributes, material, indices=indices)

    def save(self, path):
        self.binary.extend(bytes(-len(self.binary) % 4))
        self.doc["buffers"] = [{"byteLength": len(self.binary)}]
        data = json.dumps(self.doc, ensure_ascii=False, separators=(",", ":")).encode()
        data += b" " * (-len(data) % 4)
        header = struct.pack("<4sII", b"glTF", 2, 28 + len(data) + len(self.binary))
        path.write_bytes(header + struct.pack("<I4s", len(data), b"JSON") + data
                         + struct.pack("<I4s", len(self.binary), b"BIN\0") + self.binary)


if __name__ == "__main__":
    glb = Glb()
    glb.organ("stomach", "FJ2564", STOMACH_COLOR, partial(sample_soft_tissue, gland=False), seed=859)
    glb.organ("pancreas", "FJ2629", PANCREAS_COLOR, partial(sample_soft_tissue, gland=True), seed=247)
    glb.dense_organ("liver", LIVER_COLOR, sample_liver)
    glb.organ("esophagus", "FJ2563", ESOPHAGUS_COLOR, sample_esophagus, seed=503)
    glb.dense_organ("large-intestine", COLON_COLOR, sample_colon)
    glb.dense_organ("small-intestine", SMALL_INTESTINE_COLOR, sample_small_intestine)
    glb.save(ROOT / "assets" / "organ-material-trial.glb")
