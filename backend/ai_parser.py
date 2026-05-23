import os
import json
import base64
import google.generativeai as genai

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
MODEL_NAME = 'gemini-2.0-flash'

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


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


def parse_invoice_text(items: list, invoice_text: str) -> list:
    if not GEMINI_API_KEY:
        raise RuntimeError('GEMINI_API_KEY not configured')

    catalog = _build_catalog_text(items)
    prompt = _build_prompt(catalog)

    model = genai.GenerativeModel(MODEL_NAME)
    resp = model.generate_content([prompt, invoice_text])
    raw = resp.text.strip()

    raw = raw.removeprefix('```json').removeprefix('```').removesuffix('```').strip()
    return json.loads(raw)


def parse_invoice_image(items: list, image_data: str) -> list:
    if not GEMINI_API_KEY:
        raise RuntimeError('GEMINI_API_KEY not configured')

    catalog = _build_catalog_text(items)
    prompt = _build_prompt(catalog)

    if image_data.startswith('data:'):
        header, encoded = image_data.split(',', 1)
        mime = header.split(';')[0].split(':')[1]
    else:
        encoded = image_data
        mime = 'image/jpeg'

    image_bytes = base64.b64decode(encoded)
    image_part = {
        'inline_data': {
            'mime_type': mime,
            'data': image_bytes,
        }
    }

    model = genai.GenerativeModel(MODEL_NAME)
    resp = model.generate_content([prompt, image_part])
    raw = resp.text.strip()

    raw = raw.removeprefix('```json').removeprefix('```').removesuffix('```').strip()
    return json.loads(raw)
