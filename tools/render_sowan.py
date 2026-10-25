#!/usr/bin/env python3
"""登録済みの双湾展示区から、施設配置を重ねた確認図を描く。"""

import argparse, base64, json, pathlib
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Circle

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("output", type=pathlib.Path)
    a = ap.parse_args()
    d = json.loads((ROOT / "mapdesign/sowan/layout.json").read_text())
    layout = json.loads((ROOT / "mapdesign/sowan/definition.json").read_text())
    step = d["ringCoordinateStep"]
    hx, hz = d["halfExtents"]
    fig, ax = plt.subplots(figsize=(16, 6.8), facecolor="#16252d")
    ax.set_facecolor(d["district"]["unifiedGround"]["color"])

    def decode(r):
        return np.frombuffer(base64.b64decode(r), dtype="<i2").reshape(-1, 2) * step

    for rings in d["river"]["rings"]:
        for i, r in enumerate(rings):
            ax.add_patch(
                Polygon(
                    r, facecolor="#326b84" if i == 0 else "#858f86", edgecolor="none"
                )
            )
    road = d["surfaces"]["tran"]
    pts = (
        np.frombuffer(base64.b64decode(road["points"]), dtype="<i2").reshape(-1, 3)
        * road["step"]
    )
    ids = np.frombuffer(base64.b64decode(road["indices"]), dtype="<u2").reshape(-1, 3)
    from matplotlib.collections import PolyCollection

    ax.add_collection(
        PolyCollection(pts[ids][:, :, [0, 2]], facecolor="#3f4e57", edgecolor="none")
    )
    for k, lo, hi, rings, m in sorted(d["volumes"], key=lambda v: v[2]):
        for i, r in enumerate(rings):
            ax.add_patch(
                Polygon(
                    decode(r),
                    facecolor=(
                        m.get(
                            "landmarkColor",
                            d["district"]["buildingPalette"][m.get("paint", 0)],
                        )
                        if i == 0
                        else "#3f4e57"
                    ),
                    edgecolor="#657277",
                    linewidth=0.15,
                )
            )
    bridge = d["surfaces"]["brid"]
    p = (
        np.frombuffer(base64.b64decode(bridge["points"]), dtype="<i2").reshape(-1, 3)
        * bridge["step"]
    )
    ids = np.frombuffer(base64.b64decode(bridge["indices"]), dtype="<u2").reshape(-1, 3)
    tri = p[ids]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    roofs = tri[
        (n[:, 1] > 0.65 * np.linalg.norm(n, axis=1)) & (tri[:, :, 1].mean(axis=1) > 10)
    ]
    ax.add_collection(
        PolyCollection(
            roofs[:, :, [0, 2]], facecolor="#babaae", edgecolor="#747c7b", linewidth=0.3
        )
    )
    for t, b in layout["bases"].items():
        x, z = b["at"]
        c = "#48b6ff" if t == "B" else "#ff9b47"
        ax.add_patch(Circle((x, z), 32, color=c, alpha=0.7))
        ax.text(
            x,
            z,
            "BLUE" if t == "B" else "ORANGE",
            ha="center",
            va="center",
            color="white",
            fontsize=10,
            weight="bold",
        )
    for ident, x, z, _ in layout["plants"]:
        ax.add_patch(
            Circle((x, z), 18, facecolor="#243b45", edgecolor="#f3dc7e", lw=1.4)
        )
        ax.text(
            x,
            z,
            ident,
            color="#fff0a9",
            ha="center",
            va="center",
            weight="bold",
            fontsize=12,
        )
    cats = [
        {"at": c[:2], "exit": c[2:]}
        for b in layout["bases"].values()
        for c in b["catapults"]
    ] + layout["plantCatapults"]
    for c in cats:
        ax.annotate(
            "",
            xy=c["exit"],
            xytext=c["at"],
            arrowprops={
                "arrowstyle": "->",
                "lw": 0.9,
                "color": "#ffc27b",
                "alpha": 0.9,
            },
        )
        ax.plot(*c["at"], "s", ms=3, color="#b495f2")
    ax.set_xlim(-hx, hx)
    ax.set_ylim(hz, -hz)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title(
        "SOWAN / ODAIBA-ARIAKE    1 : 2    |    1,650 x 625 m",
        color="#eff5f6",
        pad=13,
        fontsize=14,
    )
    for spine in ax.spines.values():
        spine.set_color("#78c5ca")
    fig.text(
        0.06,
        0.075,
        "A-D: plants  |  Squares / arrows: catapults  |  Plant placement does not cut terrain",
        color="#d3dfe3",
        fontsize=10,
    )
    fig.tight_layout(rect=[0.02, 0.1, 0.98, 1])
    a.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        a.output,
        dpi=130,
        facecolor=fig.get_facecolor(),
        bbox_inches="tight",
        pad_inches=0.25,
    )
    plt.close(fig)


if __name__ == "__main__":
    main()
