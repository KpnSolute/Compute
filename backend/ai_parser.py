import json
import os

from ollamafreeapi import OllamaFreeAPI

AI_MODEL = os.getenv('AI_MODEL', 'llama3.2:3b')

client = OllamaFreeAPI()


def _build_catalog_text(items: list) -> str:
    lines = ['id | sku | description | unit_price']
    for i in items:
        sid = i.get('item_id', i.get('id', ''))
        sku = i.get('sku') or ''
        desc = i.get('description', '')
        price = i.get('unit_price', 0)
        lines.append(f'{sid} | {sku} | {desc} | {price}')
    return '\n'.join(lines)


def _build_prompt(catalog_text: str) -> str:
    return f'''You are an inventory assistant for Miami Job Corps Cafeteria.
Parse the invoice and match each line item to the catalog below.
Match by SKU first, then by description (fuzzy match is OK).
Return ONLY a JSON array, no markdown, no preamble, no code fences.

Format: [{{"itemId":"...","matchedDesc":"...","qty":N,"unitPrice":N.NN}}]

Rules:
- itemId: the catalog id of the best match, or "NEW" if no match
- matchedDesc: the matched catalog description (or original description for NEW items)
- qty: the quantity ordered (numeric)
- unitPrice: the unit price from the catalog, not the invoice
- If multiple items match, pick the closest one
- For "NEW" items, include the original description in matchedDesc

Catalog (id | sku | description | unit_price):
{catalog_text}'''


def _clean_response(raw: str) -> str:
    raw = raw.strip()
    raw = raw.removeprefix('```json').removeprefix('```').removesuffix('```').strip()
    return raw


def parse_invoice_text(items: list, invoice_text: str) -> list:
    catalog = _build_catalog_text(items)
    prompt = _build_prompt(catalog)

    resp = client.chat(
        model=AI_MODEL,
        prompt=f'{prompt}\n\nInvoice:\n{invoice_text}',
        temperature=0.1,
    )
    raw = _clean_response(resp)
    return json.loads(raw)
