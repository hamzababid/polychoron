"""Hand-seeds the Phase 1 minimal regulatory corpus — per
specs/suites/bfsi/features/aml-detection/regulatory-corpus-manifest.md's
"Phase 1 (demo) — minimal hand-seeded set": just enough chunks to make
citation visibly work for the two seed scenarios, not a complete
corpus.

IMPORTANT — content honesty note: the chunk text below is a paraphrased
summary of what these AMLA 2010 sections and FMU red-flag categories
are about, written from general knowledge, NOT a verbatim extract of
the official gazetted text. Before any real (non-demo) use, replace
these with actual verbatim text sourced from the official SBP/FMU
publication, per the manifest's "Source format" note (PDF/text
extraction of the official published document, with a retained
source_url). Presenting paraphrased text as demo content, clearly
labeled as such here, is consistent with constitution rule 10's
demo-data-honesty requirement; presenting it as authoritative legal
text would not be.

Usage:
    python scripts/seed_regulatory_corpus.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.platform.regulatory.repository import ingest_chunk, ingest_document, publish_document
from app.platform.regulatory.types import RegulatorySourceType

FEATURE_CODE = "aml_detection"
INGESTED_BY = "demo-mlro-1"  # same accountability level as a typology promotion

AMLA_CHUNKS = [
    (
        "Section 7 (Currency Transaction Reporting)",
        "Reporting entities, including banks, must report currency transactions exceeding the "
        "threshold prescribed by the Federal Government to the Financial Monitoring Unit (FMU), "
        "in the manner and format the FMU prescribes.",
    ),
    (
        "Section 7A (Customer Due Diligence)",
        "Reporting entities must conduct customer due diligence — verifying customer identity, "
        "understanding the purpose of the business relationship, and conducting ongoing monitoring "
        "of transactions to ensure they remain consistent with the customer's known profile and "
        "declared source of funds.",
    ),
    (
        "Section 34 (Confidentiality / Tipping-off)",
        "No person may disclose that a suspicious transaction report or related information has "
        "been furnished to the FMU, or that a money laundering investigation is being or may be "
        "conducted, to the customer or any third party — the tipping-off prohibition.",
    ),
]

FMU_RED_FLAG_CHUNKS = [
    (
        "Red Flag: Structuring — sub-threshold clustering",
        "Multiple cash deposits or withdrawals conducted in amounts just below the reporting "
        "threshold, particularly when conducted on the same day or within a short period across "
        "one or more branches or accounts, may indicate an attempt to evade currency transaction "
        "reporting requirements.",
    ),
    (
        "Red Flag: Structuring — linked accounts",
        "Use of multiple accounts, including accounts held by family members or associates, to "
        "conduct transactions that in aggregate would otherwise trigger a reporting obligation, "
        "especially where the accounts share a common address, signatory, or beneficial owner.",
    ),
    (
        "Red Flag: High-velocity / account-behavior — unexplained increase",
        "A sudden and unexplained increase in the frequency or volume of cash transactions in an "
        "account, inconsistent with the customer's declared occupation, business activity, or "
        "historical transaction pattern, without a plausible and verifiable business explanation.",
    ),
    (
        "Red Flag: High-velocity / account-behavior — dormant reactivation",
        "Reactivation of a dormant account followed by a sharp increase in transaction activity, "
        "particularly high-value cash deposits, without a corresponding change in the customer's "
        "declared profile.",
    ),
]


def main() -> None:
    amla_id = ingest_document(
        feature_code=FEATURE_CODE,
        title="AMLA 2010",
        source_type=RegulatorySourceType.STATUTE,
        issuing_authority="Government of Pakistan",
        version_label="Phase 1 demo excerpt (paraphrased, not verbatim)",
        ingested_by=INGESTED_BY,
    )
    for section_reference, chunk_text in AMLA_CHUNKS:
        ingest_chunk(document_id=amla_id, section_reference=section_reference, chunk_text=chunk_text)
    publish_document(document_id=amla_id, published_by=INGESTED_BY)
    print(f"Ingested AMLA 2010 ({len(AMLA_CHUNKS)} chunks)")

    fmu_id = ingest_document(
        feature_code=FEATURE_CODE,
        title="FMU Red Flags for Banks",
        source_type=RegulatorySourceType.GUIDANCE,
        issuing_authority="FMU",
        version_label="Phase 1 demo excerpt (paraphrased, not verbatim) — structuring + high-velocity categories only",
        ingested_by=INGESTED_BY,
    )
    for section_reference, chunk_text in FMU_RED_FLAG_CHUNKS:
        ingest_chunk(document_id=fmu_id, section_reference=section_reference, chunk_text=chunk_text)
    publish_document(document_id=fmu_id, published_by=INGESTED_BY)
    print(f"Ingested FMU Red Flags for Banks ({len(FMU_RED_FLAG_CHUNKS)} chunks)")


if __name__ == "__main__":
    main()
