---
name: nimish-honest-take
description: Critically evaluate any app, product, codebase, or spec from both a buyer's and a seller's point of view — then stress-test whether it actually solves the buyer's real pain. Scans what is genuinely BUILT (not just claimed) and who the ICP is, casts two seasoned domain-expert personas (one buyer-side, one seller-side), independently writes two executive critical briefs (no yes-man retrofitting), then runs a first-principles value-proposition test that ranks pains by severity and dollar value and loops until the verdict is airtight. Use when asked for an honest/candid take, a product or value-prop teardown, a buyer/seller perspective, to find what's missing, or to pressure-test whether something is worth building or buying.
---

# Nimish Honest Take

A method for producing a brutally honest, value-first assessment of any product or app. It exists to do the opposite of a sales deck: instead of inventing a problem that flatters whatever was built, it grades what was built against the problem the market actually has — from both sides of the table.

> **First principle above all: a well-defined problem statement, derived from first principles, is half the solution itself.** The single highest-leverage output of this skill is not the critique of the build — it is the sharpened, peeled-to-bedrock statement of the buyer's real problem. Get the problem right and the right thing to build becomes almost self-evident; get it wrong and no amount of good execution matters. Spend disproportionate effort here, and never let the product's shape define the problem.

## When to use
- "Give me an honest take on this app / product / repo."
- "Is this actually solving a real problem, or is it a nice-to-have?"
- "What's missing? What would a real buyer / a veteran operator say?"
- "Pressure-test this value proposition."
- Pre-launch, pre-investment, pre-pivot, or post-build reality checks.

## The stance (non-negotiable — read before doing anything)
1. **No yes-man retrofitting.** Never reverse-engineer a tidy problem statement out of whatever the product happens to do. Define the buyer's problem independently, then see if the product hits it. If a stated problem only makes sense *because* the product exists, it is retrofitted — throw it out.
2. **Built ≠ claimed.** Separate what genuinely works from what is mock data, stubs, scaffolding, spec-only, or roadmap. The single most valuable finding is usually the gap between the headline pitch and what the code/feature actually does.
3. **Need-to-have vs. nice-to-have.** Every feature gets graded on whether it kills a top-severity, high-dollar pain — or a peripheral one.
4. **Be true to your knowledge.** Bring real, specific domain expertise: name the actual competitors, the real unit economics, the buying process, the alternatives, the norms. Generic "it depends" analysis is a failure.
5. **Executive, not verbose.** Every artifact is short, blunt, problem-solve driven, value-first. No fluff, no hedging, no adjective stacking. Tables and ranked lists over prose where they're clearer.
6. **Acknowledge what's good.** Credibility requires fairness — name the genuine assets, then be ruthless about priorities.
7. **Problem statement is the deliverable's spine.** A well-defined problem statement, derived from first principles, is half the solution. Do not treat the problem definition as a preamble to the "real" critique — it *is* the core work. The problem statement is not done until it (a) is stated without reference to any product, (b) survives the "so what / why does that hurt / what does it cost" peeling until it stops moving, and (c) would make a veteran in the field nod and say "yes, that's the actual problem." If the verdict's recommendation doesn't fall out almost automatically from the problem statement, the problem statement isn't sharp enough yet — keep peeling.

## Workflow

### Phase 0 — Scan and build the ledger
Identify the target (a path/repo/app passed as an argument, the current directory, a URL, or a doc set). If ambiguous, list the candidates you found and confirm the target before proceeding.

Scan it **in detail** — read code, READMEs, specs, configs, schemas, docs, any `.docx`/PDF (extract text), the actual route/feature surface. For anything large or multi-app, fan out with parallel sub-agents (one per app/subsystem) so you read broadly without drowning; have each return a structured summary.

Produce a **Build Ledger** (your factual base — everything downstream is grounded only in this):
- **What it is** — one honest line.
- **Value prop (built & working)** — features that genuinely function.
- **Claimed but not real** — mock/stub/scaffold/spec-only/roadmap items, flagged explicitly.
- **The headline-vs-build gap** — what the pitch promises that the build does not yet do.
- **ICP** — who it is actually for, and who genuinely has the pain (these can differ).
- **Domain / industry** — used to cast personas next.

See `references/build-ledger.md` for the exact format.

### Phase 1 — Cast the two personas
From the inferred industry, define two **seasoned, skeptical** domain experts — never novices, never cheerleaders. Give each a title, years of experience, what they have personally seen, the alternatives they know, and the lens they judge by. One is the **buyer/ICP** (the person who would actually pay for and live with this). One is the **seller/operator** (a veteran who has built/sold/run businesses in this exact space and knows the market, competition, GTM, and economics). See `references/personas.md` for casting guidance and worked examples across industries.

### Phase 2 — Two independent critical briefs
Generate the two documents **independently** so neither anchors the other: spawn two separate sub-agents (run in parallel), each given only the Build Ledger + its persona brief + the stance above. Each writes one executive, critical, value-first `.md`:
- `<target>-buyer-view.md` — written *as the buyer*: my real job-to-be-done, my pains ranked by severity × dollars, what this actually does for me (built only), where it falls short, would I buy and at what price, the deal-breaker. Template: `references/buyer-view-template.md`.
- `<target>-seller-view.md` — written *as the operator*: what this really is, built-vs-claimed, each component's true purpose and where it falls, need vs. nice, redundancy ("how many products is this really?"), build-vs-buy calls, honest differentiation/moat, what's missing to win and retain. Template: `references/seller-view-template.md`.

Both must distinguish built from claimed, name real competitors/alternatives, and end with a one-line verdict.

### Phase 3 — First-principles synthesis + value stress test
Now combine both briefs into the verdict. Follow `references/synthesis-template.md`:
1. **Restate the problem from first principles** — strip the product away entirely; what does the buyer fundamentally want? Refine it in layers (surface → deeper → bedrock) until it stops moving.
2. **Rank the buyer's pains by severity (1–5) × dollar value attached** → priority order. This ranking is the spine of the verdict.
3. **Map built things → pains.** For each real capability, which ranked pain does it serve, and is that a top pain or a peripheral one?
4. **The inversion check** — is the build aimed at the high-severity/high-dollar pains, or at the easy peripheral ones? State it plainly.
5. **Consolidation** — is this honestly one product, two, or N? Where are the redundancies?
6. **The missing engine** — the load-bearing, unbuilt pieces that would actually win and retain, in priority order.
7. **Focus recommendation** — what to build/buy/cut, in severity × dollar order.

### Phase 4 — Churn until convergence
Run the convergence audit in `references/synthesis-template.md` (the anti-yes-man checklist). If any check fails — retrofitted problem, ungrounded claim, pain-ranking driven by the product instead of the market, missing competitor comparison, softened gap — revise and re-run Phase 3. Repeat until every check passes and the verdict would survive the buyer and seller personas reading it. Only then is it done. Briefly note the loop happened (e.g., "converged after 2 passes; corrected an inverted pain ranking").

### Phase 5 — Deliver
Write the three artifacts to the working directory (or a path the user specifies):
- `<target>-buyer-view.md`
- `<target>-seller-view.md`
- `<target>-honest-take.md` (the synthesis — the headline deliverable)

In your reply, lead with the synthesis verdict, the pain ranking, and the missing pieces — not a file list.

**Optional (only if asked):** render the synthesis as a distraction-free, minimalist page and/or deploy it. Keep it on-brand with the project's existing design system if one exists; otherwise clean editorial defaults. This is not part of the core deliverable.

## Output rules
- Three short documents, each scannable in under two minutes.
- Lead with the verdict; support with ranked tables; cut everything else.
- Ground every claim in the Build Ledger; mark anything inferred as inferred.
- If the honest answer is "this solves a real, severe, expensive pain and is well-aimed," say so plainly — being critical means being accurate, not negative.
