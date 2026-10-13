# Polychoron AI: launch video plan (for approval)

## Answers
- **What it is:** an agentic compliance platform; the first capability is AML Detection & Filing for banks.
- **Who it's for:** CCOs, MLROs, risk and audit executives. Also investors, and the regulators and examiners who will judge it on rigor.
- **What it does for them:**
  - AI agents investigate the alerts their monitoring system raises: they assemble the evidence, cite the regulation and draft the narrative.
  - A named officer decides and files.
- **What sets it apart:** its accountability is visible. You can see which content is AI-authored and which the officer wrote. Every claim is cited. The MLRO owns the detection logic. Nothing is filed automatically.
- **Strongest claim:** "Every recommendation comes with its source."
- **Visual hook:** the product's own visual language.
  - AI-authored content sits on a hatched navy band; officer content is solid.
  - That contrast *is* the story of human-in-the-loop, so it's used as the video's motif.
- **Share caption:** "The agent assembles. Your officer decides. Polychoron AI — AML Detection & Filing for banks."

## Angle
**"Show your work."** Regulated finance doesn't need AI that is faster; it needs AI it can defend to an examiner. Every scene proves one trust claim with the real product doing the real thing. The video never talks about how it's built.

## Tone
- Polished and restrained: long holds, soft cuts, no hype words.
- Pacing is set by camera moves across real screens: slow pushes and focus pulls onto the proving detail.

## Visual identity (taken from the product)
- **Type:** Barlow Condensed 600 for headlines, Barlow for body (the product's own fonts).
- **Colour:**
  - deep navy #0c1837 for title cards;
  - paper #f2f2f3 for the product;
  - accent #2c4278;
  - alert red #8d3325, used once, on the locked Submit button.
- **Motif:** the diagonal "AI-drafted" hatch.
  - It wipes on for AI claims.
  - A solid navy "officer" bar wipes on for human decisions.
- **Captions:** one line each, lower-left, on a navy bar in the product's heading style.

## Duration: about 48 seconds
This is longer than brag's usual 20s cap on purpose: seven positioning points for this audience can't land in 20s without flashing text. A 20-second cut for social comes free from the same build (scenes 1, 4, 7 and 9).

## Storyboard

| # | Time | Scene (real screen) | On screen / caption | Motion | Sound |
|---|---|---|---|---|---|
| 1 | 0:00–0:04 | **Hook**, navy title card | "AI can investigate." (hatched band wipes under it) → "Only a person can file." (solid officer bar) | Two lines type in; the hatch and solid bars meet in the middle | Low sustained pad; one soft piano note on "file" |
| 2 | 0:04–0:08 | **Reveal**: the platform shell (suite nav: Banking, Financial Services & Insurance › AML Detection & Filing) | **Polychoron AI** / AML Detection & Filing | Pull back from the wordmark to the whole shell, so the platform is visibly more than one tool | Pad opens up; light pulse starts |
| 3 | 0:08–0:13 | **Alert Queue**: populated queue, newest first | "Every alert triaged, risk-scored, with the agent's confidence shown." | Rows cascade in; the camera glides along the Risk → Recommendation → Confidence columns | Soft ticks as rows land, under the music |
| 4 | 0:13–0:21 | **Case Workspace**: structuring case, evidence left, AI-drafted panel right | "Every recommendation comes with its source." then the chip "AI-cited · AML/CFT Regulations" | Camera pushes from the transaction timeline (three deposits just under PKR 2M) to the **AI-cited regulation passage** beside it; the hatched AI band pulses once | Music gains its second layer |
| 5 | 0:21–0:26 | **Typology Console**: the MLRO editing an indicator threshold, then the promotion checklist | "Your compliance team owns the detection logic." / "No change goes live without passing the benchmark." | The value is typed; the checklist item "Golden-dataset regression passed (required)" is highlighted | A soft key-tap texture |
| 6 | 0:26–0:32 | **Guardrails**: four quick real-UI details, each held 1.2s | "Safety built in, not bolted on." Chips: *Injection flag* · *Evidence incomplete* · *Kill switch* · *Override reason required* | A 2×2 grid; each tile focus-pulls in turn | One muted tone per tile |
| 7 | 0:32–0:40 | **Filing Console: the trust beat** | "Nothing is filed automatically." then "A named officer attests." | Submit is locked (red note: "Submission is locked"); the three tipping-off checks tick one by one; the attestation with the officer's name is signed; the button unlocks; "Submitted to goAML" | Music drops to near silence; three soft ticks; a warm low "seal" chord on submit |
| 8 | 0:40–0:45 | **Model Governance & Audit** | "Evidence your regulator can inspect." | The agreement-trend line draws in; pan to consistency by branch, then version & change history; the "as of" stamp is visible | Music resolves |
| 9 | 0:45–0:48 | **Outro**, navy card | "The agent assembles. Your officer decides." / **Polychoron AI** / AML Detection & Filing | The hatched and solid bars lock together under the wordmark | Final chord, then a clean tail |

**How each positioning point is covered:**
- Knowledge Base → scene 4
- Typology Console → 5
- Guardrails & Evals → 6 and 7
- Model Governance → 8
- Real-time visibility and evidence assembly → 3 and 4
- Risk scoring and confidence → 3
- Human-in-the-loop → 1, 7 and 9

## Guardrails on content
- No code, API, infrastructure or tooling names appear anywhere. Screens are cropped to exclude URLs, dev tooling and browser chrome.
- On-screen text is the product's real UI copy plus the captions above. No invented metrics, customers or testimonials.
- **Confidence routing:** the product shows the agent's confidence on every case, but automatic routing by confidence isn't built yet. The video says "with the agent's confidence shown" and doesn't claim routing.
- **Model Governance needs data:** the current demo data is two cases, so the governance charts would be nearly empty. For capture I'd load the populated demo set (about 70 synthetic cases) plus a few months of sampling reviews. That's illustrative data, disclosed on screen (see below).

## Decisions needed from you
1. **On-screen names:** the demo data carries "(Demo Customer)" suffixes, as the project rules require. For a launch video I recommend clean fictitious names, plus a small footer, "Illustrative data. Product shown in a simulated environment." The alternative is to keep the suffixes as they are.
2. **Length:** 48s main cut, plus a free 20s social cutdown. Or 20s only.
3. **Music:** an original, restrained ambient-piano bed built for the video. Or no music.
