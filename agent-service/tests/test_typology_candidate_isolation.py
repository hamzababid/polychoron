"""screens/06-typology-rules-console.md — "The agent reads only the
promoted version". A candidate (draft-inclusive) catalog may only ever
be built and passed by the Typology Console's regression workflow; no
production path can hand one to the Pattern Matching node."""

from __future__ import annotations

import ast
from pathlib import Path

APP_DIR = Path(__file__).parent.parent / "app"

# The only modules allowed to build or pass a candidate catalog.
ALLOWED = {
    APP_DIR / "features" / "aml_detection" / "typology_regression.py",
    APP_DIR / "platform" / "evals" / "regression_runner.py",
}


def _python_files():
    return [p for p in APP_DIR.rglob("*.py") if p.resolve() not in {a.resolve() for a in ALLOWED}]


def test_only_the_regression_workflow_imports_the_candidate_catalog():
    offenders = []
    for path in _python_files():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                modules = [node.module or ""]
            elif isinstance(node, ast.Import):
                modules = [a.name for a in node.names]
            else:
                continue
            if any(m.endswith("typology_candidate") for m in modules):
                offenders.append(str(path))
    assert not offenders, f"only typology_regression.py may import typology_candidate: {offenders}"


def test_no_production_call_passes_a_catalog_override():
    offenders = []
    for path in _python_files():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and any(k.arg == "catalog_override" for k in node.keywords):
                offenders.append(f"{path}:{node.lineno}")
    assert not offenders, f"catalog_override is for the regression runner only: {offenders}"
