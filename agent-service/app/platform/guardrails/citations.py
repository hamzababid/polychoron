"""Guardrail G3 — citation-fabrication check.
specs/platform/11-evals-and-guardrails-framework.md.

The Pattern Matching Agent must never persist a RegulatoryCitation
whose chunk_id wasn't actually present in that specific call's
retrieve_regulatory_context() result. validate_citations() is the
enforcement point, called immediately after the LLM's output is
parsed and before TypologyMatch is persisted (see nodes/pattern_matching.py)."""

from __future__ import annotations

from app.platform.regulatory.types import RegulatoryCitation


def validate_citations(
    claimed_chunk_ids: list[str],
    actually_retrieved: list[RegulatoryCitation],
) -> tuple[list[RegulatoryCitation], list[str]]:
    """Returns (valid_citations, fabricated_chunk_ids). valid_citations
    is the subset of actually_retrieved whose chunk_id the model
    claimed to rely on — never anything the model asserted that wasn't
    actually retrieved, since actually_retrieved is the only source of
    truth for what a citation could legitimately contain. Any claimed
    chunk_id with no match in actually_retrieved is fabricated and
    reported back for the caller to log as a GuardrailViolation."""
    retrieved_by_id = {str(c.chunk_id): c for c in actually_retrieved}

    valid: list[RegulatoryCitation] = []
    fabricated: list[str] = []
    for claimed_id in claimed_chunk_ids:
        match = retrieved_by_id.get(claimed_id)
        if match is not None:
            valid.append(match)
        else:
            fabricated.append(claimed_id)

    return valid, fabricated
