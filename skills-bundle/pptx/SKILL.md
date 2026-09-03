---
name: pptx
description: Create and edit real Microsoft PowerPoint (.pptx) decks — investor pitch decks, sales decks, board updates, kickoff decks. Use whenever the founder needs an editable slide deck they can present or send, not a PDF or a webpage.
---

# PowerPoint (.pptx) Builder

Produce genuine, editable `.pptx` decks. The founder must be able to open the file in PowerPoint/Keynote/Google Slides and edit every element.

## How to build
Use Python `python-pptx` (`pip install python-pptx`).

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
prs = Presentation()  # 4:3 default; use prs.slide_width/height for 16:9
title = prs.slides.add_slide(prs.slide_layouts[0])
title.shapes.title.text = "Company — Seed Round"
title.placeholders[1].text = "One line that says what you do"
prs.save("deck.pptx")
```

## Quality bar (do these every time)
- **16:9** widescreen unless told otherwise (`prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)`).
- **One idea per slide.** Headline states the takeaway ("Revenue tripled in Q3"), not the topic ("Revenue").
- Consistent type scale, generous margins, a restrained 2–3 color palette. No clip-art, no wall-of-bullets.
- For an **investor deck**, follow the canonical order: Problem → Solution → Why now → Market → Product → Traction → Business model → Competition → Team → Ask. Adapt to the founder's real stage and story.
- Charts: build with real numbers; keep them clean (no 3D, no chartjunk). Pair with /dataviz principles for color.
- Save to the working folder and give the founder the exact filename.

## When NOT to use
Spreadsheets → /xlsx. Long-form written docs → /document-generate or /make-pdf. Live web dashboards → an HTML artifact. Slides are for a narrative someone will present.
