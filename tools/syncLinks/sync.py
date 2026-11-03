#!/usr/bin/env python3
"""
Create / repair / audit the links listed in links.json (repo root).

For every entry in links.json: expands ${vars}, then ensures `link` points at `target`.
- missing link        -> created (parent folders created)
- wrong-target link   -> removed (link only) and recreated
- empty real folder   -> removed and replaced by the link
- non-empty real path -> warning, left alone
- target missing      -> warning, skipped

mode "perFile" links each item of `target` matching `include` (and not `exclude`)
into the `link` folder.

Never recurses into links. Stale links are reported by --check only if they are
declared; extras are ignored.

On Windows, junctions are used for directories (no admin needed).
Symlinks require an elevated shell or Developer Mode on Windows.
"""

import argparse
import fnmatch
import json
import os
import stat
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_config(config_path: Path) -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


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


def ensure_perfile(
    link_dir: Path,
    target_dir: Path,
    include_patterns: list[str],
    exclude_patterns: list[str],
    link_type: str,
    *,
    check_only: bool = False,
    dry_run: bool = False,
) -> list[bool]:
    """Ensure per-file links in link_dir from target_dir."""
    if not target_dir.exists():
        print(f"WARNING: target dir missing: {target_dir}")
        return [False]

    results: list[bool] = []
    for item in target_dir.iterdir():
        name = item.name

        if include_patterns and not any(
            fnmatch.fnmatch(name, p) for p in include_patterns
        ):
            continue
        if exclude_patterns and any(
            fnmatch.fnmatch(name, p) for p in exclude_patterns
        ):
            continue

        link_path = link_dir / name
        results.append(
            ensure_link(link_path, item, link_type, check_only=check_only, dry_run=dry_run)
        )

    return results


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
            print("Copy links.example.json to links.json and customize it for your machine.")
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
            link_type = link_entry.get("type", "symlink")

            link = Path(expand_vars(link_raw, expanded_vars))
            target = Path(expand_vars(target_raw, expanded_vars))

            mode = link_entry.get("mode", "link")
            if mode == "perFile":
                include = link_entry.get("include", ["*"])
                exclude = link_entry.get("exclude", [])
                results = ensure_perfile(
                    link,
                    target,
                    include,
                    exclude,
                    link_type,
                    check_only=args.check,
                    dry_run=args.dry_run,
                )
                bad_count += sum(1 for r in results if not r)
            else:
                if not ensure_link(
                    link, target, link_type, check_only=args.check, dry_run=args.dry_run
                ):
                    bad_count += 1

    if bad_count > 0:
        print(f"\033[33m{bad_count} link(s) not in desired state\033[0m")
        if args.check:
            return 1
    else:
        print("\033[32mall links ok\033[0m")

    return 0


if __name__ == "__main__":
    sys.exit(main())
