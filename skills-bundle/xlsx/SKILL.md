---
name: xlsx
description: Create, edit, and analyze real Microsoft Excel (.xlsx) spreadsheets — financial models, board tables, trackers, and data exports. Use whenever the founder needs a genuine spreadsheet file (not a PDF or a markdown table), including cash models, pricing tables, cohort/retention grids, or any deliverable someone will open in Excel or Google Sheets.
---

# Excel (.xlsx) Builder

Produce genuine `.xlsx` files a founder can open, edit, and send. Never fake a spreadsheet as a PDF or markdown table when the deliverable is meant to live in Excel/Sheets.

## How to build
Use Python `openpyxl` (install with `pip install openpyxl` if missing). For heavy data/formulas, `pandas` + `openpyxl` engine works too.

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
wb = Workbook(); ws = wb.active; ws.title = "Model"
ws["A1"] = "Founders Office — Cash Model"
ws["A1"].font = Font(bold=True, size=14)
# headers, formulas ("=SUM(B2:B13)"), number formats ("$#,##0", "0.0%")
wb.save("output.xlsx")
```

## Quality bar (do these every time)
- **Real formulas**, not baked numbers, wherever a value is derived (totals, growth, margins) — so the founder can change an input and watch it flow.
- **Number formats**: currency `"$#,##0"`, percent `"0.0%"`, dates. Never leave raw floats.
- **Frozen header row** (`ws.freeze_panes = "A2"`), bold headers, sensible column widths.
- **One clear input block** (assumptions) visually separated from calculated output, so a non-technical founder knows exactly which cells to edit.
- Add a short `Notes` or `README` sheet when the model isn't self-evident.
- Save to the working folder and tell the founder the exact filename.

## When NOT to use
If the deliverable is a narrative doc → use /document-generate or /make-pdf. If it's slides → use /pptx. Excel is for numbers, grids, and anything the founder will keep editing.
