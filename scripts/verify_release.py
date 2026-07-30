from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def classify_version(version: str) -> str:
    match = VERSION_PATTERN.fullmatch(version)
    if not match:
        raise SystemExit(f"VERSION must use x.y.z numeric format; found {version!r}")

    _, minor_text, patch_text = match.groups()
    minor, patch = int(minor_text), int(patch_text)
    if minor == 9 and patch == 9:
        raise SystemExit(
            f"{version} is ambiguous: x.x.9 is prerelease while x.9.x is stable. "
            "Choose a different patch number for the stable release."
        )

    return "prerelease" if patch == 9 else "stable" if minor == 9 else "release"


def version_info() -> tuple[str, str]:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    channel = classify_version(version)
    package = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "frontend" / "package-lock.json").read_text(encoding="utf-8"))
    versions = {
        "frontend/package.json": package.get("version"),
        "frontend/package-lock.json": lock.get("version"),
        "frontend/package-lock.json packages['']": lock.get("packages", {}).get("", {}).get("version"),
    }
    mismatches = [f"{path}={value!r}" for path, value in versions.items() if value != version]
    if mismatches:
        raise SystemExit("Version files disagree with VERSION: " + ", ".join(mismatches))
    return version, channel


def executable(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved and os.name == "nt":
        resolved = shutil.which(f"{name}.cmd")
    if not resolved:
        raise SystemExit(f"Required command is unavailable: {name}")
    return resolved


def run(label: str, command: list[str], cwd: Path = ROOT) -> None:
    print(f"\n==> {label}", flush=True)
    result = subprocess.run(command, cwd=cwd, check=False)
    if result.returncode:
        raise SystemExit(f"{label} failed with exit code {result.returncode}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the MJCC release gate.")
    parser.add_argument(
        "--version-only",
        action="store_true",
        help="Validate and print version metadata without running the test suite.",
    )
    args = parser.parse_args()

    version, channel = version_info()
    print(f"Version v{version} validated as channel={channel}")
    if args.version_only:
        if os.getenv("GITHUB_OUTPUT"):
            with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
                output.write(f"version={version}\nchannel={channel}\n")
        return

    python = sys.executable
    npm = executable("npm")
    run("Backend lint", [python, "-m", "ruff", "check", "backend"])
    run("Backend format check", [python, "-m", "ruff", "format", "--check", "backend"])
    run("Backend tests", [python, "-m", "pytest", "backend/tests", "-q"])
    run(
        "Weekly inventory formula gate",
        [
            python,
            "-m",
            "pytest",
            "backend/tests/test_inventory_calculations.py",
            "backend/tests/test_inventory_value_invariant.py",
            "backend/tests/test_dispatch_total_pulled.py",
            "backend/tests/test_data_entry_week_validation.py",
            "backend/tests/test_valuation_basis_single_source.py",
            "-q",
        ],
    )
    run("Frontend lint", [npm, "run", "lint"], ROOT / "frontend")
    run("Frontend production build", [npm, "run", "build"], ROOT / "frontend")
    print(f"\nAll release checks passed for v{version} ({channel}).")


if __name__ == "__main__":
    main()
