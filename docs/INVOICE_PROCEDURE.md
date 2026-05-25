# Invoice Entry Procedure — MJC Inventory Dashboard

## Supported Invoice Types

- US Foods (primary supplier) — PDF or text
- Multi-Flow Beverages — image or text
- Any supplier — manual text paste

---

## US Foods Invoice — PDF Upload

1. Open dashboard → **Invoice Entry** tab
2. Click **Upload PDF Invoice**
3. Select the US Foods invoice PDF
4. AI extracts all line items automatically
5. Review the match table:
   - ✅ Green = matched to existing inventory item
   - 🟡 Yellow = new item (will be added)
   - ❌ Red = could not match (review manually)
6. Select the correct **Week** (W1 / W2 / W3 / W4)
7. Click **Apply to Inventory**

---

## Multi-Flow Beverage Invoice — Image Upload

1. Open dashboard → **Invoice Entry** tab
2. Take a clear photo of the invoice or scan it
3. Click **Upload Image**
4. AI reads all line items from the image
5. Review and select the correct week
6. Click **Apply to Inventory**

---

## Manual Entry (any supplier)

1. Open dashboard → **Invoice Entry** tab
2. Type or paste invoice text into the text box
3. Format doesn't need to be exact — AI will parse it
4. Click **Parse with AI**
5. Review matches, select week, apply

---

## Price Update Rule

When a new invoice is processed:

- Always update the unit price to the **most current invoice price**
- Weight-based items (Chicken, Beef, Pork) use: `total extended ÷ cases shipped`
- If price changed from prior week, the item price is updated automatically

---

## Week Assignment Reference

| Week   | Approx Dates | Invoice # (May 2026)                                     |
| ------ | ------------ | -------------------------------------------------------- |
| Week 1 | May 1–7      | US Foods #2312098 + Multi-Flow #861848, #864172, #864236 |
| Week 2 | May 8–14     | US Foods #39582                                          |
| Week 3 | May 15–21    | TBD                                                      |
| Week 4 | May 22–31    | TBD                                                      |

---

## VIZIENT Discount Notes

US Foods invoices include VIZIENT contract discounts that are applied at the invoice level, not per item. These will cause a small reconciliation difference between the sum of item prices and the invoice total. This is normal and expected.

- Week 1: −$98.17 + −$117.80 = −$215.97 VIZIENT discount
- Week 2: −$60.64 VIZIENT discount

---

## Common Issues

| Problem            | Solution                                                         |
| ------------------ | ---------------------------------------------------------------- |
| Item not matched   | Manually assign it in the review table                           |
| Wrong week applied | Go to Inventory tab, manually correct the w1r/w2r/w3r/w4r column |
| Quantity doubled   | Check if item was applied twice — remove one via Inventory tab   |
| Price wrong        | Edit price directly in Inventory tab                             |
| PDF won't parse    | Try copying text from PDF and pasting manually                   |
