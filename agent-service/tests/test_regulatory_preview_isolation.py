"""specs/platform/10-regulatory-knowledge-base-spec.md — "Retrieval
contract changes": preview.py is the only code path that can rank a
*draft* document's chunks. No agent code may import it, so a draft can
never reach an agent prompt by construction."""

from __future__ import annotations

import ast
from pathlib import Path

FEATURES_DIR = Path(__file__).parent.parent / "app" / "features"


def test_no_feature_module_imports_the_draft_inclusive_preview():
    offenders = []
    for path in FEATURES_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app.platform.regulatory"):
                if node.module.endswith(".preview") or any(a.name == "preview" for a in node.names):
                    offenders.append(str(path))
            elif isinstance(node, ast.Import) and any(a.name.endswith("regulatory.preview") for a in node.names):
                offenders.append(str(path))
    assert not offenders, f"agent code must not import regulatory.preview: {offenders}"
