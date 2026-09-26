"""Deterministic, configurable chunking for the Regulatory Knowledge
Base — specs/platform/10-regulatory-knowledge-base-spec.md, "Phase 2
addendum". Pure functions only (text + ChunkingConfig -> chunks): no
I/O, no LLM, no embeddings. Platform-level, so a second feature's
corpus reuses this unchanged.

Every chunk this produces is a *preview* — the officer can edit, merge,
split, or delete it before anything is embedded."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from app.platform.regulatory.types import ChunkingConfig, ChunkingStrategy

_PAGE_NUMBER_LINE = re.compile(r"^\s*(page\s*)?\d{1,4}(\s*(of|/)\s*\d{1,4})?\s*$", re.IGNORECASE)
_MAX_REFERENCE_CHARS = 120
_DEFAULT_TEMPLATE = "{title} ¶{n}"


class ChunkingError(ValueError):
    """Bad chunking input (e.g. invalid heading regex) — surfaced to the
    officer as a 400, never a crash."""


@dataclass
class ChunkDraft:
    section_reference: str
    text: str
    warnings: list[str] = field(default_factory=list)


def normalize_text(text: str) -> str:
    """Line endings, non-breaking spaces, trailing whitespace, and runs
    of blank lines — the same normalization every source goes through
    before chunking or storage."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ").replace("\f", "\n\n")
    lines = [line.rstrip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def strip_headers_footers(text: str) -> str:
    """Removes bare page-number lines and short lines repeated 3+ times
    (running headers/footers from PDF extraction). Conservative: a line
    longer than 80 chars is never treated as a header."""
    lines = text.split("\n")
    counts = Counter(line.strip() for line in lines if line.strip())
    repeated = {line for line, n in counts.items() if n >= 3 and len(line) <= 80}
    kept = [line for line in lines if not _PAGE_NUMBER_LINE.match(line) and line.strip() not in repeated]
    return normalize_text("\n".join(kept))


def chunk_text(text: str, config: ChunkingConfig, *, title: str = "") -> list[ChunkDraft]:
    if config.strategy == ChunkingStrategy.MANUAL:
        raise ChunkingError("manual chunking has no automatic preview — author chunks directly")
    if config.max_chunk_chars < config.target_chunk_chars:
        raise ChunkingError("max_chunk_chars must be >= target_chunk_chars")
    if config.overlap_chars >= config.target_chunk_chars:
        raise ChunkingError("overlap_chars must be smaller than target_chunk_chars")

    text = normalize_text(text)
    if config.strip_headers_footers:
        text = strip_headers_footers(text)
    if not text:
        return []

    if config.strategy == ChunkingStrategy.HEADING_PATTERN:
        sections = _split_by_heading(text, config)
    elif config.strategy == ChunkingStrategy.PARAGRAPH:
        sections = _pack_paragraphs(text, config.target_chunk_chars)
    else:
        sections = [(None, text)]

    # Oversize sections split further (fixed_size is one oversize section).
    split_limit = config.target_chunk_chars if config.strategy == ChunkingStrategy.FIXED_SIZE else config.max_chunk_chars
    pieces: list[tuple[str | None, str, int | None]] = []
    for heading, body in sections:
        if len(body) > split_limit:
            parts = _split_long(body, config.target_chunk_chars, config.overlap_chars)
            pieces.extend((heading, part, i + 1 if len(parts) > 1 else None) for i, part in enumerate(parts))
        else:
            pieces.append((heading, body, None))

    pieces = _merge_small(pieces, config.min_chunk_chars)

    chunks = []
    for n, (heading, body, part) in enumerate(pieces, start=1):
        reference = _section_reference(config, heading=heading, title=title, n=n)
        if part is not None:
            reference = f"{reference} (part {part})"
        chunks.append(ChunkDraft(section_reference=reference[:_MAX_REFERENCE_CHARS], text=body))
    return annotate_warnings(chunks, min_chars=config.min_chunk_chars, max_chars=config.max_chunk_chars)


def count_heading_matches(text: str, pattern: str) -> int:
    """For the wizard's live "N matches found" counter."""
    return len(_compile_heading(pattern).findall(normalize_text(text)))


def annotate_warnings(chunks: list[ChunkDraft], *, min_chars: int = 120, max_chars: int = 2000) -> list[ChunkDraft]:
    """Warnings shown per chunk in the preview. Advisory only — they
    never block publishing (injection flags are handled separately and
    do require acknowledgement)."""
    references = Counter(c.section_reference.strip().lower() for c in chunks)
    for c in chunks:
        c.warnings = []
        if len(c.text) < min_chars:
            c.warnings.append("too_short")
        if len(c.text) > max_chars:
            c.warnings.append("too_long")
        if references[c.section_reference.strip().lower()] > 1:
            c.warnings.append("duplicate_section_reference")
    return chunks


def _compile_heading(pattern: str) -> re.Pattern[str]:
    try:
        return re.compile(pattern, re.MULTILINE)
    except re.error as exc:
        raise ChunkingError(f"invalid heading pattern: {exc}") from exc


def _split_by_heading(text: str, config: ChunkingConfig) -> list[tuple[str | None, str]]:
    if not config.heading_pattern:
        raise ChunkingError("heading_pattern strategy needs a heading_pattern")
    regex = _compile_heading(config.heading_pattern)

    # A heading is the whole line the pattern matches in.
    starts = sorted({text.rfind("\n", 0, m.start()) + 1 for m in regex.finditer(text)})
    if not starts:
        return [(None, text)]

    sections: list[tuple[str | None, str]] = []
    if starts[0] > 0 and text[: starts[0]].strip():
        sections.append(("Preamble", text[: starts[0]].strip()))
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        body = text[start:end].strip()
        if body:
            heading = body.split("\n", 1)[0].strip()
            sections.append((heading, body))
    return sections


def _pack_paragraphs(text: str, target: int) -> list[tuple[str | None, str]]:
    """Greedily packs consecutive paragraphs up to `target` characters —
    one paragraph per chunk would make most chunks uselessly short."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    packed: list[tuple[str | None, str]] = []
    current: list[str] = []
    size = 0
    for p in paragraphs:
        if current and size + len(p) + 2 > target:
            packed.append((None, "\n\n".join(current)))
            current, size = [], 0
        current.append(p)
        size += len(p) + 2
    if current:
        packed.append((None, "\n\n".join(current)))
    return packed


def _split_long(text: str, target: int, overlap: int) -> list[str]:
    """Splits at whitespace near `target`, carrying `overlap` characters
    (snapped to a word boundary) into the next piece."""
    pieces = []
    start, n = 0, len(text)
    while start < n:
        end = min(start + target, n)
        if end < n:
            boundary = max(text.rfind(" ", start + target // 2, end), text.rfind("\n", start + target // 2, end))
            if boundary > start:
                end = boundary
        piece = text[start:end].strip()
        if piece:
            pieces.append(piece)
        if end >= n:
            break
        next_start = max(end - overlap, start + 1)
        if overlap:
            space = text.find(" ", next_start, end)
            if space != -1:
                next_start = space + 1
        start = next_start
    return pieces


def _merge_small(
    pieces: list[tuple[str | None, str, int | None]], min_chars: int
) -> list[tuple[str | None, str, int | None]]:
    """A fragment shorter than `min_chars` merges into the previous chunk
    (or the next one, if it's first) rather than becoming a useless
    stand-alone passage."""
    merged: list[tuple[str | None, str, int | None]] = []
    carry: str | None = None
    for heading, body, part in pieces:
        if carry is not None:
            body = f"{carry}\n\n{body}"
            carry = None
        if len(body) < min_chars:
            if merged:
                prev_heading, prev_body, prev_part = merged[-1]
                merged[-1] = (prev_heading, f"{prev_body}\n\n{body}", prev_part)
            else:
                carry = body
            continue
        merged.append((heading, body, part))
    if carry is not None:
        merged.append((None, carry, None))
    return merged


def _section_reference(config: ChunkingConfig, *, heading: str | None, title: str, n: int) -> str:
    if config.section_reference_mode == "from_heading" and heading:
        return heading
    template = config.section_reference_template or _DEFAULT_TEMPLATE
    try:
        return template.format(title=title or "Section", n=n, heading=heading or "")
    except (KeyError, IndexError, ValueError) as exc:
        raise ChunkingError(f"invalid section reference template: {exc}") from exc
