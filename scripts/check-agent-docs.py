#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
DOC_ROOT = REPO_ROOT / "agents"


REQUIRED_FILES = [
    "agents/README.md",
    "agents/ROUTING.md",
    "agents/implementation/INDEX.md",
    "agents/implementation/PLAN_TEMPLATE.md",
    "agents/implementation/archives/INDEX.md",
    "agents/requirements/INDEX.md",
    "agents/requirements/ui/INDEX.md",
    "agents/roadmaps/INDEX.md",
]

STATUS_ALLOWED = {"Active", "Complete"}

PLACEHOLDER_PATTERNS = [
    re.compile(r"_NN\b"),
    re.compile(r"_NN_[a-z0-9_-]+\.md$", re.IGNORECASE),
    re.compile(r"/plan_XX\.md$"),
    re.compile(r"<[^>]+>"),
]


def rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


def parse_backtick_paths(text: str) -> list[str]:
    candidates = re.findall(r"`([^`]+)`", text)
    out: list[str] = []
    for c in candidates:
        c = c.strip()
        if c.startswith(("agents/", "tests/", "debug/")):
            out.append(c.rstrip(".,:;"))
    return out


def check_required_files(errors: list[str]) -> None:
    for rel_path in REQUIRED_FILES:
        p = REPO_ROOT / rel_path
        if not p.exists():
            errors.append(f"Missing required doc: {rel_path}")


def check_doc_links(errors: list[str]) -> None:
    # Keep this strict for active policy/routing docs but skip deep archive history.
    scan_paths = [
        REPO_ROOT / "agents/README.md",
        REPO_ROOT / "agents/ROUTING.md",
        REPO_ROOT / "agents/implementation_planning.md",
        REPO_ROOT / "agents/implementation/INDEX.md",
        REPO_ROOT / "agents/implementation/PLAN_TEMPLATE.md",
        REPO_ROOT / "agents/implementation/archives/INDEX.md",
        REPO_ROOT / "agents/policies/docs.md",
        REPO_ROOT / "agents/policies/implementation.md",
        REPO_ROOT / "agents/policies/testing.md",
        REPO_ROOT / "agents/policies/observability.md",
        REPO_ROOT / "agents/tools/debugging.md",
        REPO_ROOT / "agents/requirements/INDEX.md",
        REPO_ROOT / "agents/requirements/ui/INDEX.md",
        REPO_ROOT / "agents/features/INDEX.md",
        REPO_ROOT / "agents/analytics/README.md",
        REPO_ROOT / "agents/roadmaps/INDEX.md",
    ]
    for md in scan_paths:
        if not md.exists():
            continue
        text = md.read_text(encoding="utf-8")
        for ref in parse_backtick_paths(text):
            # allow wildcards
            if "*" in ref:
                continue
            if any(p.search(ref) for p in PLACEHOLDER_PATTERNS):
                continue
            p = REPO_ROOT / ref
            if not p.exists():
                errors.append(f"Broken reference in {rel(md)} -> {ref}")


def check_plan_status(errors: list[str]) -> None:
    for plan in (REPO_ROOT / "agents/implementation").glob("plan_*.md"):
        text = plan.read_text(encoding="utf-8")
        m = re.search(r"^Status:\s*(.+?)\s*$", text, flags=re.MULTILINE)
        if not m:
            errors.append(f"Missing Status header: {rel(plan)}")
            continue
        status = m.group(1).strip()
        if status not in STATUS_ALLOWED:
            errors.append(f"Invalid Status '{status}' in {rel(plan)}")


def main() -> int:
    errors: list[str] = []
    check_required_files(errors)
    check_doc_links(errors)
    check_plan_status(errors)

    if errors:
        print("Agent docs check: FAIL")
        for e in errors:
            print(f"- {e}")
        return 1

    print("Agent docs check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
