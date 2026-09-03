# Build Ledger — format

The factual base for the whole assessment. Everything in the buyer/seller briefs and the synthesis must trace back to a line here. Build it from what you actually read — code, schema, routes, configs, specs, docs — not from the marketing.

## Required sections

**What it is** — one honest sentence. No adjectives.

**ICP / who it's actually for** — the buyer and the user (often different people). Note who genuinely feels the pain vs. who the pitch targets.

**Domain / industry** — the market this competes in. Drives persona casting.

**Built & working (the real value prop)** — list each capability that genuinely functions, with where you saw it (file/route/feature). One line each.

**Claimed but not real** — anything that is:
- mock data / hardcoded / seeded
- a stub or scaffold (UI with no backend, a connector that only stores credentials, billing fields with no payment integration)
- spec-only / roadmap / "coming soon"
- referenced in docs but absent in code
Flag each and say how you know.

**Headline-vs-build gap** — the most important section. The product's central promise (the thing the pitch leads with) vs. what the code/feature actually delivers. If the headline isn't built, say so in one blunt line.

**External dependencies / integrations** — what it relies on (APIs, data sources, third parties). Note which are live vs. wired-but-off.

**Maturity read** — prototype / early / production, and the evidence.

## Rules
- Distinguish *built* from *claimed* on every line. This distinction is the whole point.
- Cite where each fact came from so the briefs can be challenged.
- Do not editorialize here — the ledger is facts; judgment happens in the briefs and synthesis.
- For multi-app or large targets, build one ledger per app/subsystem (fan out with parallel readers), then keep them side by side.
