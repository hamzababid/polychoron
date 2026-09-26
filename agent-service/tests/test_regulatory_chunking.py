"""specs/platform/10-regulatory-knowledge-base-spec.md, "Phase 2
addendum" — chunking.py is pure, so these need no DB, worker, or LLM."""

from __future__ import annotations

import pytest

from app.platform.regulatory.chunking import (
    ChunkingError,
    annotate_warnings,
    chunk_text,
    count_heading_matches,
    normalize_text,
    strip_headers_footers,
)
from app.platform.regulatory.types import ChunkingConfig, ChunkingStrategy

STATUTE = """ANTI-MONEY LAUNDERING ACT (demo fixture)

An Act to provide for prevention of money laundering.

7. Procedure for reporting suspicious transactions
Every reporting entity shall file with the FMU a report of any conducted or attempted transaction which it knows,
suspects or has reason to suspect involves funds derived from illegal activity, promptly and without delay.

7A. Customer due diligence
Every reporting entity shall conduct customer due diligence and shall not open or maintain anonymous accounts or
accounts in obviously fictitious names, and shall verify the identity of the beneficial owner.

34. Disclosure of information
Any director, officer or employee of a reporting entity shall not disclose to any person the fact that a
suspicious transaction report is being or has been filed with the FMU.
"""

RED_FLAGS = """FMU red flag indicators (demo fixture)

Structuring. Multiple cash deposits made just below the currency transaction reporting threshold, across branches or
days, with no apparent business reason.

Linked accounts. Funds deposited into several related accounts and then consolidated into a single account shortly
afterwards.

Dormant reactivation. A long-dormant account suddenly receives frequent high-value transactions inconsistent with the
customer's profile.
"""


def _config(**overrides) -> ChunkingConfig:
    base = {"strategy": ChunkingStrategy.HEADING_PATTERN, "heading_pattern": r"^\d+[A-Z]?\.\s", "min_chunk_chars": 50}
    base.update(overrides)
    return ChunkingConfig(**base)


def _squash(text: str) -> str:
    return " ".join(text.split())


def test_heading_pattern_splits_statute_by_section_with_heading_references():
    chunks = chunk_text(STATUTE, _config(), title="AMLA")

    refs = [c.section_reference for c in chunks]
    assert refs == [
        "Preamble",
        "7. Procedure for reporting suspicious transactions",
        "7A. Customer due diligence",
        "34. Disclosure of information",
    ]
    assert chunks[2].text.startswith("7A. Customer due diligence")


def test_heading_pattern_preserves_all_text():
    chunks = chunk_text(STATUTE, _config(overlap_chars=0), title="AMLA")
    assert _squash(" ".join(c.text for c in chunks)) == _squash(STATUTE)


def test_paragraph_strategy_packs_paragraphs_and_preserves_text():
    config = ChunkingConfig(strategy=ChunkingStrategy.PARAGRAPH, target_chunk_chars=300, overlap_chars=0, min_chunk_chars=0)
    chunks = chunk_text(RED_FLAGS, config, title="FMU Red Flags")

    assert len(chunks) >= 2
    assert all(len(c.text) <= 600 for c in chunks)
    assert chunks[0].section_reference == "FMU Red Flags ¶1"
    assert _squash(" ".join(c.text for c in chunks)) == _squash(RED_FLAGS)


def test_fixed_size_splits_with_overlap_at_word_boundaries():
    wall = " ".join(f"word{i}" for i in range(600))  # ~4.8k chars, no headings
    config = ChunkingConfig(strategy=ChunkingStrategy.FIXED_SIZE, target_chunk_chars=1000, overlap_chars=100, min_chunk_chars=0)
    chunks = chunk_text(wall, config, title="Wall")

    assert len(chunks) >= 5
    for c in chunks:
        assert len(c.text) <= 1000
        assert not c.text.startswith("ord")  # never cut mid-word
    # Consecutive chunks overlap.
    first_tail = chunks[0].text.split()[-1]
    assert first_tail in chunks[1].text.split()[:30]


def test_oversize_heading_section_is_split_into_parts():
    long_section = "5. Long section\n" + " ".join(["obligation"] * 400)
    chunks = chunk_text(long_section, _config(target_chunk_chars=800, max_chunk_chars=1000, overlap_chars=0))
    assert len(chunks) > 1
    assert chunks[0].section_reference == "5. Long section (part 1)"
    assert chunks[1].section_reference == "5. Long section (part 2)"


def test_small_fragments_merge_into_previous_chunk():
    text = "1. First\n" + "a " * 100 + "\n2. Tiny\nshort\n3. Third\n" + "b " * 100
    chunks = chunk_text(text, _config(min_chunk_chars=60, overlap_chars=0))
    refs = [c.section_reference for c in chunks]
    assert "2. Tiny" not in refs
    assert "short" in chunks[0].text


def test_template_reference_mode():
    chunks = chunk_text(
        STATUTE, _config(section_reference_mode="template", section_reference_template="{title} s.{n}"), title="AMLA"
    )
    assert chunks[1].section_reference == "AMLA s.2"


def test_no_heading_matches_yields_single_section():
    chunks = chunk_text(RED_FLAGS, _config(heading_pattern=r"^NOPE"), title="FMU")
    assert len(chunks) == 1


def test_invalid_regex_and_config_raise_chunking_error():
    with pytest.raises(ChunkingError):
        chunk_text(STATUTE, _config(heading_pattern="("))
    with pytest.raises(ChunkingError):
        chunk_text(STATUTE, _config(heading_pattern=None))
    with pytest.raises(ChunkingError):
        chunk_text(STATUTE, _config(target_chunk_chars=1000, max_chunk_chars=500))
    with pytest.raises(ChunkingError):
        chunk_text(STATUTE, ChunkingConfig(strategy=ChunkingStrategy.MANUAL))


def test_count_heading_matches():
    assert count_heading_matches(STATUTE, r"^\d+[A-Z]?\.\s") == 3


def test_strip_headers_footers_removes_page_numbers_and_running_headers():
    page = "State Bank of Pakistan — AML Regulations\nReal content line {n}\nPage {n} of 3"
    text = "\n".join(page.format(n=n) for n in (1, 2, 3))
    cleaned = strip_headers_footers(text)
    assert "Page" not in cleaned
    assert "State Bank of Pakistan" not in cleaned
    assert "Real content line 2" in cleaned


def test_normalize_text():
    assert normalize_text("a\r\nb c  \n\n\n\nd\f") == "a\nb c\n\nd"


def test_annotate_warnings():
    from app.platform.regulatory.chunking import ChunkDraft

    chunks = annotate_warnings(
        [ChunkDraft("S1", "x" * 10), ChunkDraft("s1", "y" * 500), ChunkDraft("S2", "z" * 3000)], min_chars=50, max_chars=2000
    )
    assert chunks[0].warnings == ["too_short", "duplicate_section_reference"]
    assert chunks[1].warnings == ["duplicate_section_reference"]
    assert chunks[2].warnings == ["too_long"]
