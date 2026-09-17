"""Portable gallery storage. Standard library only; also shipped standalone."""
from __future__ import annotations

import copy
import datetime as dt
import json
import math
import os
import re
import shutil
import time
import zipfile
from contextlib import contextmanager
from pathlib import Path

PREFIX = "window.ORBIT_GALLERY = "
SCHEMA = "orbit-portable-gallery/1"
STATIC_FILES = ("index.html", "app.js", "updates.js", "style.css", "gallery-data.js")
FAILED = {"error", "timeout", "cancelled", "model_required", "stale", "unreadable"}
STATUSES = FAILED | {"read", "review", "not_run", "pending", "no_target", "needs_baseline"}


def _finite(v):
    return isinstance(v, (float, int)) and not isinstance(v, bool) and math.isfinite(v)


def _text(v, limit=500):
    return v[:limit] if isinstance(v, str) else None


def _scalar(v):
    return v is None or isinstance(v, (str, bool)) or _finite(v)


def _encoded(data):
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    for character, replacement in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        encoded = encoded.replace(character, replacement)
    return PREFIX + encoded + ";\n"


def load_gallery(folder):
    folder = Path(folder).expanduser().resolve()
    source = (folder / "gallery-data.js").read_text(encoding="utf-8-sig").strip()
    if not source.startswith(PREFIX) or not source.endswith(";"):
        raise ValueError("Choose the extracted Orbit_Local_Gallery folder")
    data = json.loads(source[len(PREFIX):-1])
    if data.get("schema") != SCHEMA or not isinstance(data.get("images"), list):
        raise ValueError("Unrecognized local gallery")
    shas = [im.get("image_sha256") for im in data["images"]]
    if len(shas) != len(set(shas)) or not all(isinstance(s, str) and re.fullmatch("[0-9a-f]{64}", s) for s in shas):
        raise ValueError("Gallery photo identities are invalid")
    return data


@contextmanager
def _lock(folder):
    path = folder / ".gallery-write.lock"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError("Another gallery update is in progress. Try again after it finishes.")
    try:
        os.close(fd)
        yield
    finally:
        path.unlink(missing_ok=True)


def save_gallery(folder, data, *, backup=True):
    folder = Path(folder)
    text = _encoded(data)  # Validate all numbers before making any changes.
    path = folder / "gallery-data.js"
    if backup and path.exists():
        backups = folder / "backups"
        backups.mkdir(exist_ok=True)
        shutil.copyfile(path, backups / (str(time.time_ns()) + ".js"))
        for old in sorted(backups.glob("*.js"))[:-5]:
            old.unlink()
    temporary = path.with_suffix(".js.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def _point(value, size):
    return isinstance(value, list) and len(value) == size and all(_finite(x) and 0 <= x <= 1000 for x in value)


def _row(row):
    if not isinstance(row, dict):
        raise ValueError("Each reading must be an object")
    clean = {key: (value[:1000] if isinstance(value, str) else value)
             for key in ("label", "object", "position", "value", "text", "unit", "state", "change",
                         "status", "value_kind", "method", "uncertainty")
             if _scalar(value := row.get(key)) and key in row}
    box = row.get("box")
    if _point(box, 4) and box[2] >= box[0] and box[3] >= box[1]:
        clean["box"] = box
    clean["lines"] = []
    for line in row.get("lines", [])[:10]:
        pts = line.get("points") if isinstance(line, dict) else None
        if isinstance(pts, list) and len(pts) == 2 and all(_point(p, 2) for p in pts):
            clean["lines"].append({"kind": _text(line.get("kind"), 30), "points": pts})
    return clean


def _timestamp(value):
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.timestamp()
    except (ValueError, TypeError, OverflowError):
        return None


def clean_result(result):
    if not isinstance(result, dict) or result.get("status") not in STATUSES:
        raise ValueError("Unrecognized result status")
    clean = {k: _text(result.get(k)) for k in ("image_sha256", "image_name", "cvid", "family", "status",
        "created_at", "engine_version", "reader", "backend", "model", "analysis_mode", "mission_name",
        "run_uuid", "capture_uuid", "capture_time", "action_name", "robot_name", "scope", "mode", "source_digest")}
    for key in ("total_seconds", "inference_seconds", "download_seconds"):
        value = result.get(key)
        clean[key] = value if _finite(value) and value >= 0 else None
    for key in ("cached", "prior_values_used"):
        clean[key] = result.get(key) if isinstance(result.get(key), bool) else None
    for collection in ("readings", "lights", "changes"):
        rows = result.get(collection, [])
        if not isinstance(rows, list) or len(rows) > 80:
            raise ValueError("Invalid number of readings")
        clean[collection] = [] if result["status"] in FAILED | {"not_run"} else [_row(r) for r in rows]
    clean["issues"] = [str(x)[:500] for x in result.get("issues", [])[:20]]
    return clean


def _metrics(metrics, selected, attempted):
    """Export measured scalar fields, not arbitrary metadata or private paths."""
    if not isinstance(metrics, dict):
        metrics = {}
    result = {"selected_images": selected, "attempted_images": attempted,
              "not_run_images": selected - attempted}
    result["timing"] = {k: metrics.get("timing", {}).get(k) for k in (
        "timed_attempts", "mean_seconds", "p50_seconds", "p95_seconds", "max_seconds")
        if _finite(metrics.get("timing", {}).get(k))}
    a = metrics.get("accuracy")
    result["accuracy"] = None
    if isinstance(a, dict):
        result["accuracy"] = {k: a.get(k) for k in ("reference_images", "matched_reference_images",
            "unreferenced_unique_images", "reference_targets", "correct_targets", "returned_targets",
            "accuracy_all_targets") if _finite(a.get(k))}
        result["accuracy"]["split"] = _text(a.get("split"), 60) or "unspecified"
    return result


def merge_update(data, payload):
    if not isinstance(payload, dict) or payload.get("schema") != "orbit-gallery-update/1":
        raise ValueError("Choose gallery_update.json produced by the pipeline")
    rows = payload.get("results")
    if not isinstance(rows, list) or not rows or len(rows) > 10000:
        raise ValueError("The update must contain 1–10000 results")
    # Work on a copy; validation failures leave the live gallery untouched.
    updated = copy.deepcopy(data)
    known = {im["image_sha256"]: im for im in updated["images"]}
    seen = set()
    info = dict(updated=0, older=0, unmatched=0, skipped_not_run=0, attempted=0)
    for raw in rows:
        result = clean_result(raw)
        sha = result["image_sha256"]
        if not isinstance(sha, str) or not re.fullmatch("[0-9a-f]{64}", sha):
            raise ValueError("Every result needs its original photo SHA-256")
        if sha in seen:
            raise ValueError("Duplicate photo in results file; export one result per original photo")
        seen.add(sha)
        attempted = result["total_seconds"] is not None and result["status"] != "not_run"
        info["attempted"] += int(attempted)
        if sha not in known:
            info["unmatched"] += 1
            continue
        image = known[sha]
        if result["status"] == "not_run" or (result["status"] == "cancelled" and not attempted):
            # No new reading was attempted. Keep any older result, with its own
            # visible time/provenance, and mark it as skipped by this run.
            info["skipped_not_run"] += 1
            image["latest_attempt"] = {"status": "not_run", "run_id": _text(payload.get("run_id")),
                                       "created_at": _text(payload.get("created_at"))}
            continue
        previous = image.get("result") or {}
        old_time, new_time = _timestamp(previous.get("created_at")), _timestamp(result.get("created_at"))
        if old_time is not None and (new_time is None or new_time < old_time):
            info["older"] += 1
            continue
        image["result"] = result  # Actual failed reruns clear stale numbers.
        image["validation"] = None
        image.pop("latest_attempt", None)
        info["updated"] += 1
    if not info["updated"] and len(known.keys() & seen) == 0:
        raise ValueError("None of these results match photos in this gallery")
    last = updated.get("last_run") or {}
    old_time, new_time = _timestamp(last.get("created_at")), _timestamp(payload.get("created_at"))
    if old_time is None or (new_time is not None and new_time >= old_time):
        updated["last_run"] = {"run_id": _text(payload.get("run_id")), "created_at": _text(payload.get("created_at")),
            **_metrics(payload.get("metrics"), len(rows), info["attempted"])}
    updated["generated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    return updated, info


def update_gallery(folder, payload):
    folder = Path(folder).expanduser().resolve()
    with _lock(folder):
        data = load_gallery(folder)
        updated, info = merge_update(data, payload)
        save_gallery(folder, updated)
    return info


def static_paths(folder):
    folder = Path(folder).resolve()
    data = load_gallery(folder)
    names = set(STATIC_FILES)
    for image in data["images"]:
        for key in ("image", "thumb"):
            name = image[key]
            if not re.fullmatch(r"images/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)", name):
                raise ValueError("Invalid gallery photo path")
            names.add(name)
    for name in sorted(names):
        path = (folder / name).resolve()
        if folder not in path.parents or not path.is_file():
            raise ValueError("A gallery asset is missing: " + name)
        yield path, name


def export_hosting(folder, destination):
    """Only website assets enter this ZIP. No updater, backups or credentials."""
    destination = Path(destination)
    paths = list(static_paths(folder))
    temporary = destination.with_suffix(".zip.tmp")
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, name in paths:
            archive.write(path, name)
    temporary.replace(destination)
    return {"files": len(paths), "bytes": destination.stat().st_size, "path": str(destination.resolve())}
