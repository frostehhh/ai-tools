#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["json5>=0.9"]
# ///
"""
Create / repair / audit the links and copies listed in links.json (repo root).

Each entry has two independent axes plus one option:
- method   "link" (default) | "copy"      what to make at `link`
- scope    "folder" (default) | "items"   "folder": `link` itself is the unit;
                                          "items": `link` stays a real folder and each
                                          child of `target` matching include/exclude is
                                          the unit
- linkType "symlink" (default) | "junction"  how a link is made (method "link" only)

method "link":
- missing link        -> created (parent folders created)
- wrong-target link   -> removed (link only) and recreated
- empty real folder   -> removed and replaced by the link
- non-empty real path -> warning, left alone
- target missing      -> warning, skipped

method "copy": `link` becomes a real copy of `target`. Differing files are overwritten,
files that only exist in the copy are removed. .DS_Store is ignored. A link in the way is
left alone with a warning.

Legacy keys `type` and `mode` ("link" | "perFile") are still read, with a warning.

links.json may contain comments (JSONC); it is read with the json5 package.

Never recurses into links. Stale links are reported by --check only if they are
declared; extras are ignored.

On Windows, junctions are used for directories (no admin needed).
Symlinks require an elevated shell or Developer Mode on Windows.
"""

import argparse
import fnmatch
import hashlib
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

try:
    import json5
except ImportError:
    sys.exit(
        "ERROR: the json5 package is required to read links.json.\n"
        "Run this tool with `uv run tools/syncLinks/sync.py ...`, or install it with\n"
        "`pip install -r tools/syncLinks/requirements.txt`."
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_config(config_path: Path) -> dict:
    """Read links.json. json5 accepts comments (JSONC) and is a superset of JSON."""
    with open(config_path, "r", encoding="utf-8") as f:
        return json5.load(f)


def expand_vars(s: str, vars_dict: dict, max_depth: int = 5) -> str:
    """Expand ${var} references with nesting support."""
    for _ in range(max_depth):
        changed = False
        for key, value in vars_dict.items():
            placeholder = "${" + key + "}"
            if placeholder in s:
                s = s.replace(placeholder, value)
                changed = True
        if not changed:
            break
    return s


def normalize_path(p: Path) -> str:
    """Normalize path for comparison (case-insensitive on Windows)."""
    return os.path.normcase(str(p.resolve()))


def is_link(path: Path) -> bool:
    """Check if path is a symlink or junction."""
    if path.is_symlink():
        return True
    if os.name == "nt" and path.exists():
        try:
            st = os.lstat(path)
            if hasattr(st, "st_file_attributes"):
                return (
                    bool(st.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)
                    and path.is_dir()
                )
        except (OSError, AttributeError):
            pass
    return False


def read_link_target(path: Path) -> Path | None:
    """Read the target of a symlink or junction."""
    if path.is_symlink():
        return Path(os.readlink(path))
    if os.name == "nt":
        try:
            return Path(os.readlink(path))
        except OSError:
            pass
    return None


def remove_link(path: Path) -> None:
    """Remove a symlink or junction without affecting the target."""
    if path.is_symlink():
        os.unlink(path)
    elif os.name == "nt" and path.is_dir():
        # Junction
        os.rmdir(path)
    else:
        (os.unlink if path.is_file() else os.rmdir)(path)


def create_symlink(link: Path, target: Path) -> None:
    """Create a symbolic link."""
    link.parent.mkdir(parents=True, exist_ok=True)
    os.symlink(target, link, target_is_directory=target.is_dir())


def create_junction_windows(link: Path, target: Path) -> None:
    """Create a Windows directory junction using cmd /c mklink /J."""
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.exists() or link.is_symlink():
        remove_link(link)
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to create junction: {result.stderr.strip()}")


def ensure_link(
    link: Path,
    target: Path,
    link_type: str,
    *,
    check_only: bool = False,
    dry_run: bool = False,
) -> bool:
    """
    Ensure a link points to the correct target.
    Returns True if correct, False otherwise.
    """
    if not target.exists():
        print(f"WARNING: target missing, skipped: {link} -> {target}")
        return False

    # Determine current state
    is_correct = False
    state = "missing"
    extra = ""

    if is_link(link):
        current_target = read_link_target(link)
        if current_target is not None:
            if normalize_path(current_target) == normalize_path(target):
                is_correct = True
                state = "ok"
            else:
                state = "wrong"
                extra = f"-> {current_target} (want {target})"
        else:
            state = "wrong"
            extra = f"(cannot read target, want {target})"
    elif link.exists():
        if link.is_dir():
            try:
                next(link.iterdir())
                print(f"WARNING: real path in the way, left alone: {link}")
                return False
            except StopIteration:
                state = "empty"
                extra = "(real empty folder, will be replaced)"
        else:
            print(f"WARNING: real path in the way, left alone: {link}")
            return False

    if state == "ok":
        print(f"\033[90mok       {link}\033[0m")
        return True

    print(f"{state:<8} {link} {extra}".strip())

    if check_only or dry_run:
        return False

    # Remove existing path
    if link.exists() or link.is_symlink():
        if state == "empty":
            os.rmdir(link)
        else:
            remove_link(link)

    # Create new link
    try:
        if os.name == "nt" and link_type == "junction" and target.is_dir():
            create_junction_windows(link, target)
        else:
            create_symlink(link, target)
        print(f"\033[32mcreated  {link}\033[0m")
    except Exception as e:
        print(f"WARNING: failed to create {link}: {e}")
        return False

    return True


COPY_IGNORE = {".DS_Store"}
VALID_METHODS = ("link", "copy")
VALID_SCOPES = ("folder", "items")
VALID_LINK_TYPES = ("symlink", "junction")


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def tree_digest(root: Path) -> dict[str, str]:
    """Map relative file path -> sha256 for every file under root (ignoring COPY_IGNORE)."""
    result: dict[str, str] = {}
    if root.is_file():
        return {"": file_digest(root)}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in COPY_IGNORE]
        for name in filenames:
            if name in COPY_IGNORE:
                continue
            full = Path(dirpath) / name
            result[str(full.relative_to(root))] = file_digest(full)
    return result


def ensure_copy(
    link: Path,
    target: Path,
    *,
    check_only: bool = False,
    dry_run: bool = False,
) -> bool:
    """
    Ensure `link` is a real copy of `target`. Returns True if already identical.
    Only files inside `link` are touched; a link in the way is never followed or removed.
    """
    if not target.exists():
        print(f"WARNING: target missing, skipped: {link} -> {target}")
        return False
    if is_link(link):
        print(f"WARNING: link in the way of a copy, left alone: {link}")
        return False
    if link.exists() and link.is_dir() != target.is_dir():
        print(f"WARNING: file/folder mismatch, left alone: {link}")
        return False

    src = tree_digest(target)
    dst = tree_digest(link) if link.exists() else {}

    to_copy = [k for k, v in src.items() if dst.get(k) != v]
    to_delete = [k for k in dst if k not in src]

    if not link.exists():
        state = "missing"
    elif to_copy or to_delete:
        state = "drift"
    else:
        print(f"\033[90mok       {link}\033[0m")
        return True

    detail = f"({len(to_copy)} to copy, {len(to_delete)} to remove)" if state == "drift" else ""
    print(f"{state:<8} {link} {detail}".strip())

    if check_only or dry_run:
        return False

    try:
        if target.is_file():
            link.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, link)
        else:
            link.mkdir(parents=True, exist_ok=True)
            for rel in to_copy:
                dest = link / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target / rel, dest)
            for rel in to_delete:
                (link / rel).unlink()
            # Remove empty directories that no longer exist in the source
            for dirpath, _dirs, _files in os.walk(link, topdown=False):
                d = Path(dirpath)
                if d != link and not any(d.iterdir()) and not (target / d.relative_to(link)).exists():
                    d.rmdir()
        print(f"\033[32mcopied   {link}\033[0m")
    except Exception as e:
        print(f"WARNING: failed to copy {link}: {e}")
        return False
    return True


def resolve_entry(entry: dict) -> tuple[str, str, str] | None:
    """Return (method, scope, link_type) with defaults applied, or None if invalid."""
    where = entry.get("link", "?")
    method = entry.get("method")
    scope = entry.get("scope")
    link_type = entry.get("linkType")

    # Legacy keys
    if "type" in entry:
        print(f"WARNING: 'type' is deprecated, use 'linkType': {where}")
        link_type = link_type or entry["type"]
    if "mode" in entry:
        print(f"WARNING: 'mode' is deprecated, use 'method' and 'scope': {where}")
        legacy = entry["mode"]
        if legacy == "perFile":
            scope = scope or "items"
        elif legacy != "link":
            print(f"ERROR: unknown mode '{legacy}': {where}")
            return None

    method = method or "link"
    scope = scope or "folder"
    if method not in VALID_METHODS:
        print(f"ERROR: method must be one of {VALID_METHODS}, got '{method}': {where}")
        return None
    if scope not in VALID_SCOPES:
        print(f"ERROR: scope must be one of {VALID_SCOPES}, got '{scope}': {where}")
        return None
    if link_type is not None and link_type not in VALID_LINK_TYPES:
        print(f"ERROR: linkType must be one of {VALID_LINK_TYPES}, got '{link_type}': {where}")
        return None
    if method == "copy" and link_type is not None:
        print(f"WARNING: linkType is ignored with method 'copy': {where}")
    if scope == "folder" and ("include" in entry or "exclude" in entry):
        print(f"WARNING: include/exclude are ignored with scope 'folder': {where}")
    return method, scope, link_type or "symlink"


def expand_items(
    link: Path,
    target: Path,
    include_patterns: list[str],
    exclude_patterns: list[str],
) -> list[tuple[Path, Path]] | None:
    """(link, target) pairs for scope 'items'. None if target dir is missing."""
    if not target.exists():
        print(f"WARNING: target dir missing: {target}")
        return None
    pairs = []
    for item in sorted(target.iterdir()):
        name = item.name
        if include_patterns and not any(fnmatch.fnmatch(name, p) for p in include_patterns):
            continue
        if exclude_patterns and any(fnmatch.fnmatch(name, p) for p in exclude_patterns):
            continue
        pairs.append((link / name, item))
    return pairs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create / repair / audit links from links.json"
    )
    parser.add_argument(
        "--config",
        default="links.json",
        help="Path to links.json (default: links.json in repo root)",
    )
    parser.add_argument(
        "--group",
        action="append",
        help="Process only specific group(s) (can be used multiple times)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Audit only: change nothing, exit 1 if anything is off",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without changing anything",
    )
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        # Try relative to repo root (script is at tools/syncLinks/)
        script_dir = Path(__file__).parent
        repo_root = script_dir.parent.parent
        config_path = repo_root / args.config
        if not config_path.exists():
            print(f"ERROR: Config file not found: {args.config}")
            print("Copy links.example.jsonc to links.json and customize it for your machine.")
            return 1

    cfg = load_config(config_path)
    vars_dict: dict[str, str] = {}
    for key, value in cfg.get("vars", {}).items():
        vars_dict[key] = value

    # Built-in variables
    config_dir = config_path.parent.resolve()
    vars_dict["self"] = str(config_dir)
    vars_dict["home"] = str(Path.home())

    # Expand all vars
    expanded_vars = {k: expand_vars(v, vars_dict) for k, v in vars_dict.items()}

    bad_count = 0

    for group_name, group_data in cfg.get("groups", {}).items():
        if args.group and group_name not in args.group:
            continue

        print(f"\033[36m== {group_name}\033[0m")

        for link_entry in group_data.get("links", []):
            link_raw = link_entry["link"]
            target_raw = link_entry["target"]

            resolved = resolve_entry(link_entry)
            if resolved is None:
                bad_count += 1
                continue
            method, scope, link_type = resolved

            link = Path(expand_vars(link_raw, expanded_vars))
            target = Path(expand_vars(target_raw, expanded_vars))

            if scope == "items":
                pairs = expand_items(
                    link,
                    target,
                    link_entry.get("include", ["*"]),
                    link_entry.get("exclude", []),
                )
                if pairs is None:
                    bad_count += 1
                    continue
            else:
                pairs = [(link, target)]

            for pair_link, pair_target in pairs:
                if method == "copy":
                    ok = ensure_copy(
                        pair_link, pair_target, check_only=args.check, dry_run=args.dry_run
                    )
                else:
                    ok = ensure_link(
                        pair_link,
                        pair_target,
                        link_type,
                        check_only=args.check,
                        dry_run=args.dry_run,
                    )
                if not ok:
                    bad_count += 1

    if bad_count > 0:
        print(f"\033[33m{bad_count} item(s) not in desired state\033[0m")
        if args.check:
            return 1
    else:
        print("\033[32mall links and copies ok\033[0m")

    return 0


if __name__ == "__main__":
    sys.exit(main())
