"""Generates tests/fixtures/facturas.pdf: a 2-page text PDF with an invoice table and injected anomalies.
Requires: pip install reportlab. The expected anomalies are listed in tests/fixtures/facturas.truth.json."""
import json
import random
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
random.seed(5)

HEADER = ["invoice_number", "customer", "issue_date", "quantity", "unit_price", "subtotal"]
XS = [40, 130, 290, 380, 440, 520]
customers = ["Andes Logistica", "Delta Textiles", "Caribe Agro", "Sabana Muebles", "Nevado Comercial"]

rows = []
for i in range(1, 81):
    qty = random.randint(1, 20)
    price = random.choice([1200, 2500, 4800, 9900, 15000]) + random.randint(0, 90)
    day = random.randint(1, 28)
    month = random.randint(1, 12)
    rows.append([f"FV-{1000 + i}", random.choice(customers), f"{day:02d}/{month:02d}/2025", str(qty), str(price), str(qty * price)])

truth = []
rows[10][5] = str(int(rows[10][5]) * 10)          # impossible_relation (subtotal != qty*price) -> row 10
truth.append({"row": 10, "type": "impossible_relation"})
rows[25][3] = "abc"                                # type_mismatch -> row 25
truth.append({"row": 25, "type": "type_mismatch"})
rows[40][2] = "31/02/2025"                         # impossible_date -> row 40
truth.append({"row": 40, "type": "impossible_date"})
rows[55] = list(rows[54])                          # duplicate_exact -> row 55 (repeats 54)
truth.append({"row": 55, "type": "duplicate_exact"})

c = canvas.Canvas(str(OUT / "facturas.pdf"), pagesize=A4)
W, H = A4
per_page = 40
for p in range(2):
    c.setFont("Helvetica-Bold", 9)
    y = H - 60
    for x, h in zip(XS, HEADER):
        c.drawString(x, y, h)
    c.setFont("Helvetica", 9)
    for r in rows[p * per_page:(p + 1) * per_page]:
        y -= 16
        for x, v in zip(XS, r):
            c.drawString(x, y, v)
    c.showPage()
c.save()
(OUT / "facturas.truth.json").write_text(json.dumps({"rows": len(rows), "truth": truth}, indent=2))
print("wrote", OUT / "facturas.pdf", len(rows), "rows")
