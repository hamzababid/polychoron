"""Bulk-populates AML Detection with a large, varied set of synthetic
cases so every screen has enough volume to look and feel like a real
production queue, not a 2-row fixture set.

This is deliberately separate from the two real seed scenarios
(mock_bank/seed_data.py, injected via inject_demo_alert.py) — those
stay untouched, since they're the only cases validated end-to-end
through the real agent chain and are what the "watch it happen live"
demo moment uses. Everything this script creates is written directly
to the database (no LLM calls, no mock-bank HTTP calls) — it exists
purely to populate the UI, not to re-test agent reasoning.

All customer names, CNICs, addresses, and narratives are obviously
synthetic (constitution rule 10, demo-data honesty) — sequential/
repeated-digit CNICs, "(Demo Customer)" suffixes, and narrative text
that reads as generated filler, following the same convention already
used in mock_bank/seed_data.py.

Idempotent: every row this script creates carries a `source_alert_id`
prefixed "SEED-BULK-", and re-running first deletes anything with that
prefix before regenerating — safe to re-run any time, and easy to
strip back out with --reset-only.

Usage:
    python scripts/seed_bulk_demo_data.py               # ~68 cases
    python scripts/seed_bulk_demo_data.py --count 150    # bigger
    python scripts/seed_bulk_demo_data.py --reset-only   # just delete

Before an investor demo, don't run this on its own — use
`reset_demo_environment.py --populated` instead, which resets to the
clean two-scenario state first and then calls this script, so you
never end up with bulk data mixed into an otherwise-unreset
environment. Run `reset_demo_environment.py` with no flags right
before the actual investor walkthrough to strip this back out.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text

from app.db import get_connection
from scripts.seed_platform_registry import DEMO_TENANT_ID

ALERT_ID_PREFIX = "SEED-BULK-"
DEMO_NOW = datetime(2026, 9, 21, tzinfo=timezone.utc)

OFFICER_IDS = ["demo-analyst-1", "demo-compliance-officer-1", "demo-mlro-1"]
FILING_OFFICER_IDS = ["demo-compliance-officer-1", "demo-mlro-1"]

BRANCHES = [f"BR-{i:03d}" for i in range(1, 17)]  # BR-001..BR-016

FIRST_NAMES = [
    "Ahmed", "Fatima", "Bilal", "Sadia", "Usman", "Nadia", "Kamran", "Zainab",
    "Farhan", "Sana", "Imran", "Ayesha", "Waqas", "Hina", "Rashid", "Mehwish",
    "Adnan", "Sobia", "Tariq", "Rabia",
]
LAST_NAMES = [
    "Khan", "Malik", "Sheikh", "Butt", "Chaudhry", "Qureshi", "Baig", "Raza",
    "Iqbal", "Farooq", "Mirza", "Abbasi", "Siddiqui", "Anwar", "Zaidi",
]
OCCUPATIONS = [
    "Retail Shopkeeper", "Wholesale Trader — Dry Goods", "Textile Exporter",
    "Freelance IT Consultant", "Restaurant Owner", "Construction Contractor",
    "Poultry Farm Owner", "Auto Parts Dealer", "Pharmacy Owner",
    "Real Estate Agent", "Salaried — Bank Officer", "Salaried — Teacher",
]
CHANNELS = ["cash_deposit", "cash_withdrawal", "online_transfer", "cheque_deposit"]

TYPOLOGY_ARCHETYPES = [
    {
        "code": "structuring_subthreshold",
        "label": "Structuring — sub-threshold cash deposits",
        "risk_range": (70, 96),
        "recommendation": "recommend_str",
        "conf_range": (0.75, 0.97),
        "indicator": ("STR-IND-01", "Multiple cash deposits clustered just under the CTR threshold"),
    },
    {
        "code": "deposit_velocity_shift",
        "label": "Deposit velocity shift",
        "risk_range": (45, 76),
        "recommendation": "escalate",
        "conf_range": (0.5, 0.76),
        "indicator": ("VEL-IND-01", "Unexplained increase in deposit frequency inconsistent with declared profile"),
    },
    {
        "code": "no_significant_pattern",
        "label": "No significant pattern",
        "risk_range": (4, 28),
        "recommendation": "clear",
        "conf_range": (0.6, 0.92),
        "indicator": ("CLR-IND-01", "Transaction pattern consistent with declared occupation and turnover"),
    },
    {
        "code": "rapid_fund_transfer_out",
        "label": "Rapid inbound-then-outbound fund transfer",
        "risk_range": (55, 84),
        "recommendation": "recommend_ctr",
        "conf_range": (0.55, 0.85),
        "indicator": ("CTR-IND-01", "Large inbound transfer moved out again within a short window"),
    },
]

# (status, disposition_type or None, count)
STATUS_PLAN: list[tuple[str, str | None, int]] = [
    ("open", None, 15),
    ("claimed", None, 10),
    ("investigating", "enhanced_monitoring", 8),
    ("escalated", "escalate_senior", 8),
    ("cleared", "clear", 12),
    ("pending_filing", "file_str", 5),
    ("filed", "file_str", 10),
]

DISPOSITION_NOTES = {
    "enhanced_monitoring": "Pattern noted but not yet conclusive — placing under enhanced monitoring for the next cycle. (Demo data.)",
    "escalate_senior": "Escalating for senior review given the confidence level on the agent's typology match. (Demo data.)",
    "clear": "Reviewed evidence bundle; pattern explained by declared business activity. No further action. (Demo data.)",
    "file_str": "Reviewed and concur with the agent's structuring assessment. Filing STR. (Demo data.)",
}


def _rand_amount() -> float:
    return round(random.uniform(400_000, 2_400_000), 2)


def _rand_cnic(index: int) -> str:
    # Obviously-synthetic, sequential — not a real CNIC checksum format.
    return f"{index:05d}-{index:07d}-{index % 10}"


def _make_customer(index: int) -> dict:
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    return {
        "customer_id": f"CUST-SEED-BULK-{index:04d}",
        "customer_name": f"{first} {last} (Demo Customer)",
        "cnic": _rand_cnic(index),
        "declared_occupation": random.choice(OCCUPATIONS),
        "declared_monthly_turnover": round(random.uniform(80_000, 6_000_000), 2),
        "kyc_risk_rating": random.choice(["low", "medium", "high"]),
        "account_opening_date": (DEMO_NOW - timedelta(days=random.randint(200, 2500))).isoformat(),
        "address": f"House {random.randint(1, 400)}, Sector {random.randint(1, 20)}, "
        f"{random.choice(['Karachi', 'Lahore', 'Islamabad', 'Faisalabad', 'Multan'])} (Demo Address)",
    }


def _make_transactions(branch: str, n: int, end: datetime) -> list[dict]:
    txns = []
    for i in range(n):
        txns.append(
            {
                "txn_ref": f"TXN-SEED-{uuid.uuid4().hex[:8].upper()}",
                "amount": _rand_amount(),
                "currency": "PKR",
                "channel": random.choice(CHANNELS),
                "timestamp": (end - timedelta(hours=random.randint(1, 72) * (i + 1))).isoformat(),
                "counterparty_account": None,
                "branch_code": branch,
            }
        )
    return txns


def clear_bulk_data() -> None:
    with get_connection() as conn:
        case_ids = [
            row[0]
            for row in conn.execute(
                text("SELECT case_id FROM aml_cases WHERE alert->>'source_alert_id' LIKE :prefix"),
                {"prefix": f"{ALERT_ID_PREFIX}%"},
            ).all()
        ]
        if not case_ids:
            print("No existing bulk-seed data to clear.")
            return

        filing_ids = [
            row[0]
            for row in conn.execute(
                text("SELECT filing_id FROM aml_str_filings WHERE case_id = ANY(:ids)"),
                {"ids": case_ids},
            ).all()
        ]
        if filing_ids:
            conn.execute(text("DELETE FROM aml_fmu_followups WHERE filing_id = ANY(:ids)"), {"ids": filing_ids})
        conn.execute(text("DELETE FROM aml_filing_edits WHERE case_id = ANY(:ids)"), {"ids": case_ids})
        conn.execute(text("DELETE FROM aml_str_filings WHERE case_id = ANY(:ids)"), {"ids": case_ids})
        conn.execute(text("DELETE FROM aml_dispositions WHERE case_id = ANY(:ids)"), {"ids": case_ids})
        conn.execute(text("DELETE FROM aml_case_assessments WHERE case_id = ANY(:ids)"), {"ids": case_ids})
        conn.execute(text("DELETE FROM aml_typology_matches WHERE case_id = ANY(:ids)"), {"ids": case_ids})
        conn.execute(text("DELETE FROM aml_evidence_bundles WHERE case_id = ANY(:ids)"), {"ids": case_ids})
        conn.execute(
            text("DELETE FROM platform_agent_activity_log WHERE external_case_ref = ANY(:ids)"),
            {"ids": [str(c) for c in case_ids]},
        )
        conn.execute(text("DELETE FROM aml_cases WHERE case_id = ANY(:ids)"), {"ids": case_ids})
        conn.commit()
    print(f"Cleared {len(case_ids)} existing bulk-seeded cases.")


def _expand_plan(target_count: int) -> list[tuple[str, str | None]]:
    base_total = sum(c for _, _, c in STATUS_PLAN)
    scale = target_count / base_total
    plan: list[tuple[str, str | None]] = []
    for status, disposition, count in STATUS_PLAN:
        scaled = max(1, round(count * scale))
        plan.extend([(status, disposition)] * scaled)
    random.shuffle(plan)
    return plan


def seed_bulk_cases(target_count: int) -> None:
    plan = _expand_plan(target_count)

    with get_connection() as conn:
        for i, (status, disposition_type) in enumerate(plan):
            customer = _make_customer(i)
            archetype = random.choice(TYPOLOGY_ARCHETYPES)
            branch = random.choice(BRANCHES)
            account_id = f"ACC-{customer['customer_id']}"

            # Older created_at for cases further along their lifecycle;
            # recent for a queue that still looks "fresh". A handful of
            # old, high-risk open/claimed cases are left deliberately
            # past their SLA window (computed live from created_at, see
            # app-api/src/features/aml-detection/sla.ts) so the
            # Dashboard's aging-alerts tile isn't always zero.
            if status in ("filed", "cleared"):
                age_days = random.randint(20, 90)
            elif status in ("escalated", "investigating"):
                age_days = random.randint(5, 30)
            else:
                age_days = random.choice([random.randint(0, 3)] * 3 + [random.randint(4, 9)])
            created_at = DEMO_NOW - timedelta(days=age_days, hours=random.randint(0, 23))

            risk_score = random.randint(*archetype["risk_range"])
            confidence = round(random.uniform(*archetype["conf_range"]), 2)
            recommendation = archetype["recommendation"]
            indicator_code, indicator_desc = archetype["indicator"]

            case_id = uuid.uuid4()
            source_alert_id = f"{ALERT_ID_PREFIX}{i:04d}"
            alert = {
                "source_alert_id": source_alert_id,
                "source_system": "CoreTMS-DemoBank",
                "customer_id": customer["customer_id"],
                "account_ids": [account_id],
                "transaction_refs": [],
                "rule_fired": archetype["code"],
                "risk_tier_hint": "high" if risk_score >= 50 else "medium",
                "received_at": created_at.isoformat(),
            }

            assigned_analyst_id = None
            if status != "open":
                assigned_analyst_id = random.choice(OFFICER_IDS)

            closed_at = None
            if status in ("cleared", "filed"):
                closed_at = created_at + timedelta(days=random.randint(1, 8))

            conn.execute(
                text(
                    """
                    INSERT INTO aml_cases (case_id, tenant_id, alert, status, assigned_analyst_id, created_at, closed_at)
                    VALUES (:id, :tenant_id, cast(:alert as jsonb), :status, :analyst, :created_at, :closed_at)
                    """
                ),
                {
                    "id": str(case_id),
                    "tenant_id": DEMO_TENANT_ID,
                    "alert": json.dumps(alert),
                    "status": status,
                    "analyst": assigned_analyst_id,
                    "created_at": created_at,
                    "closed_at": closed_at,
                },
            )

            transactions = _make_transactions(branch, random.randint(2, 4), created_at)
            conn.execute(
                text(
                    """
                    INSERT INTO aml_evidence_bundles (
                        case_id, kyc, transaction_timeline, linked_entities,
                        prior_cases, screening_results, assembled_at, agent_version
                    ) VALUES (
                        :case_id, cast(:kyc as jsonb), cast(:txns as jsonb), '[]'::jsonb,
                        '[]'::jsonb, '[]'::jsonb, :assembled_at, 'v1-seed-bulk'
                    )
                    """
                ),
                {
                    "case_id": str(case_id),
                    "kyc": json.dumps(customer),
                    "txns": json.dumps(transactions),
                    "assembled_at": created_at,
                },
            )

            conn.execute(
                text(
                    """
                    INSERT INTO aml_typology_matches (
                        case_id, typology_code, typology_label, confidence,
                        matched_indicators, plain_language_rationale, matched_at, agent_version
                    ) VALUES (
                        :case_id, :code, :label, :confidence, cast(:indicators as jsonb),
                        :rationale, :matched_at, 'v1-seed-bulk'
                    )
                    """
                ),
                {
                    "case_id": str(case_id),
                    "code": archetype["code"],
                    "label": archetype["label"],
                    "confidence": confidence,
                    "indicators": json.dumps(
                        [{"indicator_code": indicator_code, "indicator_description": indicator_desc, "contributing_evidence": "Synthetic seed evidence (demo data)."}]
                    ),
                    "rationale": f"{indicator_desc}. (Synthetic seed data for demo volume, not a real assessment.)",
                    "matched_at": created_at,
                },
            )

            # Whenever the disposition is a filing action, the case must
            # end up with a real STR draft regardless of which
            # archetype was randomly picked for narrative/risk flavor —
            # otherwise Filing Console / goAML Tracker would 400 for a
            # case whose status implies a filing exists.
            needs_str_draft = recommendation in ("recommend_str", "recommend_ctr") or disposition_type in (
                "file_str",
                "file_ctr",
            )
            str_fields_draft = None
            if needs_str_draft:
                str_fields_draft = {
                    "party_name": customer["customer_name"],
                    "party_cnic": customer["cnic"],
                    "party_address": customer["address"],
                    "party_occupation": customer["declared_occupation"],
                    "account_ids": [account_id],
                    "transaction_refs": [t["txn_ref"] for t in transactions],
                    "total_amount": round(sum(t["amount"] for t in transactions), 2),
                    "currency": "PKR",
                    "typology_tag": archetype["code"],
                    "reporting_entity": "CoreTMS-DemoBank",
                }

            conn.execute(
                text(
                    """
                    INSERT INTO aml_case_assessments (
                        case_id, risk_score, recommendation, recommendation_confidence,
                        draft_narrative, str_fields_draft, assessed_at, agent_version
                    ) VALUES (
                        :case_id, :risk_score, :recommendation, :confidence, :narrative,
                        cast(:draft as jsonb), :assessed_at, 'v1-seed-bulk'
                    )
                    """
                ),
                {
                    "case_id": str(case_id),
                    "risk_score": risk_score,
                    "recommendation": recommendation,
                    "confidence": confidence,
                    "narrative": (
                        f"On {created_at.strftime('%B %d, %Y')}, {customer['customer_name']} conducted activity "
                        f"consistent with {archetype['label'].lower()}. {indicator_desc}. "
                        "(Synthetic seed narrative for demo volume, not a real agent output.)"
                    ),
                    "draft": json.dumps(str_fields_draft) if str_fields_draft else None,
                    "assessed_at": created_at,
                },
            )

            if disposition_type:
                officer_id = random.choice(FILING_OFFICER_IDS if disposition_type in ("file_str", "file_ctr") else OFFICER_IDS)
                is_override = disposition_type == "clear" and recommendation != "clear"
                conn.execute(
                    text(
                        """
                        INSERT INTO aml_dispositions (
                            case_id, officer_id, disposition_type, officer_notes,
                            overrides_agent_recommendation, override_reason, decided_at
                        ) VALUES (
                            :case_id, :officer_id, :disp_type, :notes, :is_override, :override_reason, :decided_at
                        )
                        """
                    ),
                    {
                        "case_id": str(case_id),
                        "officer_id": officer_id,
                        "disp_type": disposition_type,
                        "notes": DISPOSITION_NOTES[disposition_type],
                        "is_override": is_override,
                        "override_reason": "Evidence reviewed does not support the agent's escalation. (Demo data.)" if is_override else None,
                        "decided_at": (closed_at or created_at + timedelta(hours=random.randint(2, 48))),
                    },
                )

            if status == "filed" and str_fields_draft:
                submitted_at = closed_at or (created_at + timedelta(days=3))
                retention_expiry = submitted_at.replace(year=submitted_at.year + 10)
                acknowledged = random.random() < 0.6
                filing_id = uuid.uuid4()
                attestation = {
                    "officer_id": random.choice(FILING_OFFICER_IDS),
                    "officer_name": "Demo Compliance Officer",
                    "officer_role": "senior_officer_l2",
                    "tipping_off_checklist_complete": True,
                    "attestation_confirmed": True,
                    "attested_at": submitted_at.isoformat(),
                }
                conn.execute(
                    text(
                        """
                        INSERT INTO aml_str_filings (
                            filing_id, case_id, report_type, payload, final_narrative, attestation,
                            submission_status, goaml_reference, submitted_at, acknowledged_at, retention_expiry
                        ) VALUES (
                            :filing_id, :case_id, :report_type, cast(:payload as jsonb), :narrative,
                            cast(:attestation as jsonb), :status, :goaml_ref, :submitted_at, :acknowledged_at, :retention_expiry
                        )
                        """
                    ),
                    {
                        "filing_id": str(filing_id),
                        "case_id": str(case_id),
                        "report_type": "str_f" if disposition_type == "file_str" else "ctr",
                        "payload": json.dumps(str_fields_draft),
                        "narrative": f"Final narrative for {customer['customer_name']}'s filing. (Demo data.)",
                        "attestation": json.dumps(attestation),
                        "status": "acknowledged" if acknowledged else "submitted",
                        "goaml_ref": f"GOAML-DEMO-{uuid.uuid4().hex[:8].upper()}",
                        "submitted_at": submitted_at,
                        "acknowledged_at": submitted_at + timedelta(days=random.randint(1, 5)) if acknowledged else None,
                        "retention_expiry": retention_expiry,
                    },
                )
                if random.random() < 0.3:
                    conn.execute(
                        text(
                            """
                            INSERT INTO aml_fmu_followups (filing_id, note, created_by, created_at)
                            VALUES (:filing_id, :note, :created_by, :created_at)
                            """
                        ),
                        {
                            "filing_id": str(filing_id),
                            "note": "FMU requested additional transaction context; provided from case evidence bundle. (Demo data.)",
                            "created_by": random.choice(FILING_OFFICER_IDS),
                            "created_at": submitted_at + timedelta(days=2),
                        },
                    )

        conn.commit()
    print(f"Seeded {len(plan)} bulk demo cases.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=68, help="Approximate number of cases to generate")
    parser.add_argument("--reset-only", action="store_true", help="Only clear previously bulk-seeded data, don't reseed")
    args = parser.parse_args()

    clear_bulk_data()
    if args.reset_only:
        return
    seed_bulk_cases(args.count)


if __name__ == "__main__":
    main()
