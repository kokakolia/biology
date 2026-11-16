"""Export uncut BodyParts3D skin and selected bones in the organs' coordinates."""

import argparse
import re
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

import numpy as np

from bake_organ_trial import Glb
from prepare_torso import read_mesh


ROOT = Path(__file__).resolve().parents[1]
LAYER_NAMES = {
    "skin": re.compile("skin"),
    "rib-cage": re.compile("rib cage"),
    "spine": re.compile(r"atlas|axis|\w+ (?:cervical|thoracic) vertebra"),
    "arms": re.compile(
        r"skeleton of (?:left|right) (?:pectoral girdle|hand proper)"
        r"|(?:left|right) (?:humerus|radius|ulna|scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate)"
        r"|(?:proximal|middle|distal) phalanx of (?:left|right) (?:thumb|(?:index|middle|ring|little) finger)"
    ),
}


def select_parts(catalog):
    layers = defaultdict(set)
    for line in catalog.read_text(encoding="utf-8-sig").splitlines():
        row = line.split("\t")
        if len(row) == 3:
            _, term, part = row
            for name, pattern in LAYER_NAMES.items():
                if pattern.fullmatch(term):
                    layers[name].add(part)
    if set(layers) != set(LAYER_NAMES) or layers["skin"] != {"FJ2810"}:
        raise ValueError("Expected the BodyParts3D 4.0 PART-OF element catalog")
    return {name: sorted(layers[name]) for name in LAYER_NAMES}


def export_mesh(glb, archive, entries, name, part_ids):
    positions, normals, indices = [], [], []
    offset = 0
    for part in part_ids:
        p, n, faces = read_mesh(archive.read(entries[part]))
        corners, index = np.unique(np.asarray(faces).reshape(-1, 2), axis=0, return_inverse=True)
        positions.append(np.asarray(p)[corners[:, 0]])
        normals.append(np.asarray(n)[corners[:, 1]])
        indices.append(index + offset)
        offset += len(corners)

    positions = np.concatenate(positions)
    normals = np.concatenate(normals)
    index = np.concatenate(indices)
    dtype, component = ("<u2", 5123) if len(positions) <= 65535 else ("<u4", 5125)
    index_accessor = glb.append("accessors", {
        "bufferView": glb.view(index.astype(dtype).tobytes(), target=34963),
        "componentType": component, "count": len(index), "type": "SCALAR",
    })
    attrs = {"POSITION": glb.attribute(positions, bounds=True), "NORMAL": glb.attribute(normals)}
    mesh = glb.append("meshes", {"name": name, "primitives": [{"attributes": attrs, "indices": index_accessor}]})
    node = glb.append("nodes", {"name": name, "mesh": mesh, "extras": {"sourceParts": part_ids}})
    glb.doc["scenes"][0]["nodes"].append(node)
    print(f"{name}: {len(part_ids)} parts, {len(index) // 3} triangles; {positions.min(0)} to {positions.max(0)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="partof_BP3D_4.0_obj_99.zip")
    parser.add_argument("catalog", type=Path, help="partof_element_parts.txt")
    args = parser.parse_args()

    glb = Glb()
    glb.doc["asset"]["generator"] = "IzNutri body context"
    for key in ("images", "textures", "materials", "samplers"):
        del glb.doc[key]
    with ZipFile(args.archive) as archive:
        entries = {Path(entry).stem: entry for entry in archive.namelist() if entry.endswith(".obj")}
        for name, parts in select_parts(args.catalog).items():
            export_mesh(glb, archive, entries, name, parts)
    glb.save(ROOT / "assets" / "body-context.glb")


if __name__ == "__main__":
    main()
