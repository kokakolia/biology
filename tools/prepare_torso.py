"""Build the viewer's OBJ assets from the official BodyParts3D PART-OF archive."""

import argparse
from contextlib import contextmanager, nullcontext
from pathlib import Path
from zipfile import ZipFile


GROUPS = {
    "liver": (2409, 2816, *range(2818, 2825)),
    "small-intestine": range(2573, 2629),
    # FJ2599 is listed under both intestines. The model includes it on the ileum side only.
    "large-intestine": range(2566, 2573),
}
HEADER = (
    "# BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.\n"
    "# Geometry adapted for the IzNutri viewer. See ATTRIBUTION.txt.\n"
)


def source_reader(source):
    if source.is_dir():
        return nullcontext(lambda part: (source / f"FJ{part}.obj").read_bytes())
    return archive_reader(source)


@contextmanager
def archive_reader(source):
    with ZipFile(source) as archive:
        entries = {Path(name).stem: name for name in archive.namelist() if name.endswith(".obj")}
        yield lambda part: archive.read(entries[f"FJ{part}"])


def read_mesh(data):
    vertices, normals, faces = [], [], []
    for line in data.decode("utf-8-sig").splitlines():
        if line.startswith("v "):
            vertices.append(tuple(float(value) for value in line.split()[1:4]))
        elif line.startswith("vn "):
            normals.append(tuple(float(value) for value in line.split()[1:4]))
        elif line.startswith("f "):
            pairs = [item.split("/") for item in line.split()[1:]]
            corners = [(int(part[0]) - 1, int(part[2]) - 1) for part in pairs]
            for index in range(1, len(corners) - 1):
                faces.append((corners[0], corners[index], corners[index + 1]))
    return vertices, normals, faces


def write_mesh(stream, vertices, normals):
    for x, y, z in vertices:
        stream.write(f"v {x:.3f} {y:.3f} {z:.3f}\n")
    for x, y, z in normals:
        stream.write(f"vn {x:.5f} {y:.5f} {z:.5f}\n")


def merge_parts(read, name, parts, destination):
    with destination.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(HEADER)
        stream.write(f"# Sources {', '.join(f'FJ{part}' for part in parts)}\no {name}\ns 1\n")
        vertex_offset = normal_offset = 1
        for part in parts:
            vertices, normals, faces = read_mesh(read(part))
            write_mesh(stream, vertices, normals)
            for face in faces:
                corners = " ".join(f"{v + vertex_offset}//{n + normal_offset}" for v, n in face)
                stream.write(f"f {corners}\n")
            vertex_offset += len(vertices)
            normal_offset += len(normals)


def clip_polygon(corners, signed_distance):
    clipped = []
    previous = corners[-1]
    previous_distance = signed_distance(previous)
    for current in corners:
        current_distance = signed_distance(current)
        if (previous_distance < 0) != (current_distance < 0):
            weight = previous_distance / (previous_distance - current_distance)
            clipped.append(tuple(a + (b - a) * weight for a, b in zip(previous, current)))
        if current_distance >= 0:
            clipped.append(current)
        previous, previous_distance = current, current_distance
    return clipped


def torso_half_width(z):
    return 160 + max(0, z - 1110) * 0.15


def crop_torso(data, destination):
    vertices, normals, faces = read_mesh(data)
    cuts = (
        lambda p: p[2] - 745,
        lambda p: 1425 - p[2],
        lambda p: torso_half_width(p[2]) - p[0],
        lambda p: torso_half_width(p[2]) + p[0],
    )
    unique = {}
    output_faces = []
    for face in faces:
        corners = [vertices[v] + normals[n] for v, n in face]
        for cut in cuts:
            if len(corners) < 3:
                break
            corners = clip_polygon(corners, cut)
        if len(corners) < 3:
            continue
        indices = []
        for corner in corners:
            rounded = tuple(round(value, 5) for value in corner)
            indices.append(unique.setdefault(rounded, len(unique) + 1))
        for index in range(1, len(indices) - 1):
            triangle = (indices[0], indices[index], indices[index + 1])
            if len(set(triangle)) == 3:
                output_faces.append(triangle)

    with destination.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(HEADER)
        stream.write("# Source FJ2810 (skin), cropped to the torso.\no torso\ns 1\n")
        write_mesh(stream, (corner[:3] for corner in unique), (corner[3:] for corner in unique))
        for face in output_faces:
            stream.write("f " + " ".join(f"{index}//{index}" for index in face) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Official PART-OF ZIP or directory of its extracted OBJ files")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "assets")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with source_reader(args.source) as read:
        for part in (2563, 2564, 2629):
            (args.output / f"FJ{part}.obj").write_bytes(read(part))
        for name, parts in GROUPS.items():
            merge_parts(read, name, parts, args.output / f"{name}.obj")
        crop_torso(read(2810), args.output / "torso.obj")


if __name__ == "__main__":
    main()
