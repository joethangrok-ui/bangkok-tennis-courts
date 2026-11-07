#!/usr/bin/env python3
"""Copy the tracked public site into a Pages artifact directory.

Branch deploys publish the whole repository. This keeps that behavior for
every tracked path except CI metadata, so a tennis refresh cannot drop
other public sections such as opportunity-day/.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_PREFIXES = (".github/",)
SKIP_EXACT = {".gitignore"}


def tracked_public_files(repo: Path) -> list[str]:
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=repo)
    paths: list[str] = []
    for raw in output.split(b"\0"):
        if not raw:
            continue
        path = raw.decode()
        if path in SKIP_EXACT or path.startswith(SKIP_PREFIXES):
            continue
        paths.append(path)
    return paths


def stage_public_site(repo: Path, dest: Path) -> list[str]:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    copied: list[str] = []
    for rel in tracked_public_files(repo):
        source = repo / rel
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied.append(rel)
    return copied


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: stage_public_site.py DEST", file=sys.stderr)
        return 2
    copied = stage_public_site(ROOT, Path(sys.argv[1]).resolve())
    print(f"staged {len(copied)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
