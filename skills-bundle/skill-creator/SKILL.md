---
name: skill-creator
description: Build a new, well-formed Claude Code skill on demand — the office growing its own capabilities. Use when a repeatable capability is missing and should become a permanent /skill, or when a role needs a specialized playbook that doesn't exist yet (e.g. a SOW kit, an onboarding runbook, a domain checklist).
---

# Skill Creator

Turn a repeatable task into a permanent, invocable `/skill`. This is how the office extends itself instead of re-solving the same problem.

## When to make a skill
Make one when a capability is (1) repeatable, (2) worth standardizing, and (3) not already covered by an existing skill. Do NOT create a skill that mirrors one that exists — check the skills list first. Avoid overfitting: one crisp skill beats five overlapping ones.

## Anatomy of a skill
A skill is a folder at `~/.claude/skills/<name>/` containing `SKILL.md`:

```
---
name: <kebab-case-name>
description: <one line — what it does AND when to use it; this is what triggers it>
---

# <Title>
<Concise, imperative instructions. Steps, quality bar, when-not-to-use.>
```

Optional supporting files in the same folder: `reference.md`, templates, `bin/` scripts. Reference them from SKILL.md by relative path.

## How to build one
1. **Name it** in kebab-case; pick a name that reads well as `/name`.
2. **Write the description** so it states both *what* and *when* — the description is the trigger the model matches against. Be specific.
3. **Write the body**: imperative steps, a concrete example, an explicit quality bar, and a "when NOT to use" so it stays in its lane.
4. **Save** to `~/.claude/skills/<name>/SKILL.md`. Also vendor a copy to `references/` as source-of-record.
5. **Attach it to a role** (optional): add `'/<name>'` to that role's `skills[]` in `fleet-office/founders.js`, then re-run `node generate-skills.js` and `node generate-agents.js`.

## Quality bar
Tight scope, real example, explicit triggers, no overlap with existing skills. A skill nobody can tell when to use is a skill nobody uses.
