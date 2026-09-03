---
name: diagram
description: Draw a diagram on the team whiteboard so the founder can see it. Turns any idea, flow, architecture, plan, or process into a clean Excalidraw diagram and pins it to the channel's board — it shows on the desk and at the top of the channel, and clicking opens the full editable whiteboard. Use whenever a picture explains it better than words: system diagrams, user/signup flows, org charts, roadmaps, decision trees, before/after, or sketching a plan for the founder.
---

# Diagram — draw it on the team whiteboard

Every cabin, desk, and channel in the office has a whiteboard. This skill draws a real
[Excalidraw](https://github.com/excalidraw/excalidraw) diagram (MIT, opens on excalidraw.com
too) and pins it to the channel's board. The founder sees a preview on the desk + a pinned
strip at the top of the channel; clicking it opens the full editable whiteboard.

**Two jobs, two skills — do them in order:**

## 1. AUTHOR the diagram with the `excalidraw-diagram` skill

Do **not** hand-write raw JSON blindly, and do **not** use a coordinate-generator script —
that produces clipped labels, overlaps, and lopsided layouts. Instead follow the
**`excalidraw-diagram`** skill (`~/.claude/skills/excalidraw-diagram/SKILL.md`). It carries
the design methodology AND a mandatory **render-and-fix loop** that catches exactly the
"diagram doesn't look right" problems:

1. Read `~/.claude/skills/excalidraw-diagram/SKILL.md` and follow its Design Process.
2. Craft the `.excalidraw` JSON by hand with descriptive ids and containers sized to their
   text (this is why labels stop getting clipped).
3. **Render & validate (mandatory):**
   ```bash
   cd ~/.claude/skills/excalidraw-diagram/references
   uv run python render_excalidraw.py /path/to/board.excalidraw
   ```
   Then **Read** the resulting PNG and fix anything wrong — clipped text, overlaps, arrows
   into empty space, uneven spacing. Re-render. Repeat until it genuinely looks right
   (usually 2–4 passes). First run only: `uv sync && uv run playwright install chromium`.

**Office house style:** set `roughness: 1` on shapes/arrows so the board keeps the
hand-drawn Excalidraw look the founder asked for (the base skill defaults to `0`; override
it). Keep `fontFamily` as the hand-drawn family. Colors: use
`~/.claude/skills/excalidraw-diagram/references/color-palette.md`.

## 2. PIN it to the office board

Once the `.excalidraw` file passes the render check, pin it so the founder sees it:

```bash
node ~/.claude/skills/diagram/scripts/pin.js /path/to/board.excalidraw --title "Signup flow"
```

- Auto-detects which channel this cabin is. To target a specific one: `--sid <sessionId>`.
- Office must be running (default `http://localhost:4517`). On success it prints
  "Pinned to channel board" and the board updates on the desk + channel top instantly.
- If the office isn't running, the `.excalidraw` file is still a real deliverable — the
  founder can open it on excalidraw.com.

## Reporting back to the founder (non-negotiable)

You work for a non-technical founder. After drawing, say — in plain English — what the
picture shows and why it matters. No JSON, no file paths, no code in what you tell them.

> "I sketched how a shortened link gets created and then followed — it's pinned to the top
> of this channel. The cache in front of the database is what keeps popular links fast."
