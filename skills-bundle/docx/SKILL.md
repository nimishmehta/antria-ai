---
name: docx
description: Create and edit real Microsoft Word (.docx) documents — SOPs, offer letters, proposals, DPAs, policies, and any narrative document someone will open and keep editing in Word or Google Docs. Uses Python python-docx to produce genuine, styled, editable files with real headings and structure. Use whenever the founder needs an editable Word document, not a locked PDF, a slide deck, or a spreadsheet.
---

# Word (.docx) Builder

Produce genuine `.docx` files a founder can open, edit, and send. Never fake a document as a PDF or markdown when the deliverable is meant to live in Word/Google Docs and get edited.

## How to build
Use Python `python-docx` (install with `pip install python-docx` if missing).

```python
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
doc.add_heading("Offer of Employment", level=0)          # title
doc.add_heading("Position & Start Date", level=1)        # real heading style
p = doc.add_paragraph("We're delighted to offer you the role of ")
p.add_run("Head of Growth").bold = True                  # inline formatting
doc.add_paragraph("Base salary: $X per year", style="List Bullet")
doc.add_paragraph("Reports to: [Name]", style="List Bullet")

# body text style
normal = doc.styles["Normal"]
normal.font.name = "Calibri"; normal.font.size = Pt(11)

doc.save("offer-letter.docx")
```

## Quality bar (do these every time)
- **Real heading styles** (`add_heading` / named styles), not bold text pretending to be headings — so the document has a navigable structure and a table of contents would work.
- **Editable throughout** — it's a true Word file the founder can change; never a flattened image or PDF.
- Consistent body font/size, sensible spacing, bullet/number lists where they belong, and tables (`add_table`) for anything tabular.
- Fill placeholders like `[Name]`, `[Date]` clearly so the founder knows exactly what to swap.
- For legal-flavored docs (DPA, contract), include the substance but flag that it is a template, not legal advice — route redlines to counsel.
- Save to the working folder and **tell the founder the exact filename.**

## When NOT to use
- A locked, print-perfect PDF to send out → /make-pdf.
- Slides / a deck → /pptx.
- A spreadsheet, model, or grid of numbers → /xlsx.
- A Statement of Work as part of a delivery engagement → /sow-kit (which may then render via this skill).
- A short email body → /email-drafts.
