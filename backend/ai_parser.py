import json
import logging
import os
import re

logger = logging.getLogger(__name__)

AI_PROVIDER = os.getenv('AI_PROVIDER', 'gemini')
AI_MODEL = os.getenv('AI_MODEL', 'gemini-2.0-flash')
AI_API_KEY = os.getenv('GEMINI_API_KEY', os.getenv('GROQ_API_KEY', ''))
OLLAMA_BASE_URL = os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434')


SYSTEM_PROMPT = """You are an expert at parsing food service invoices and matching items to an inventory catalog.

Given an invoice text and a catalog of items, extract each line item from the invoice and match it to the
closest catalog item. Return a JSON array of matches.

Each match must have:
- catalog_item_id: the item_id from the catalog (string)
- sku: the catalog item SKU
- description: the catalog item description
- invoice_description: what was written on the invoice
- quantity: numeric quantity from invoice
- unit_price: unit price from invoice (or null if not found)
- confidence: 0.0 to 1.0 (how confident you are in the match)
- matched: true/false

Return ONLY a JSON array, no markdown, no explanation."""


def _build_prompt(catalog_items: list, invoice_text: str) -> str:
    catalog_lines = []
    for item in catalog_items[:100]:  # cap to avoid token limits
        catalog_lines.append(f'  - id={item["item_id"]} sku={item["sku"]} desc="{item["description"]}" price=${item.get("unit_price", 0)}')
    catalog_str = '\n'.join(catalog_lines)

    return f"""CATALOG ({len(catalog_items)} items):
{catalog_str}

INVOICE TEXT:
{invoice_text}

Match each invoice line to the catalog. Return JSON array only."""


def _parse_response(text: str) -> list:
    text = text.strip()
    # Strip markdown fences
    text = re.sub(r'^```(?:json)?\n?', '', text)
    text = re.sub(r'\n?```$', '', text)
    text = text.strip()

    parsed = json.loads(text)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict) and 'matches' in parsed:
        return parsed['matches']
    return []


def _parse_with_gemini(catalog_items: list, invoice_text: str) -> list:
    import google.generativeai as genai

    api_key = AI_API_KEY or os.getenv('GEMINI_API_KEY', '')
    if not api_key:
        raise RuntimeError('GEMINI_API_KEY not set')

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(AI_MODEL or 'gemini-2.0-flash')
    prompt = _build_prompt(catalog_items, invoice_text)
    response = model.generate_content(f'{SYSTEM_PROMPT}\n\n{prompt}')
    return _parse_response(response.text)


def _parse_with_groq(catalog_items: list, invoice_text: str) -> list:
    from groq import Groq

    api_key = AI_API_KEY or os.getenv('GROQ_API_KEY', '')
    if not api_key:
        raise RuntimeError('GROQ_API_KEY not set')

    client = Groq(api_key=api_key)
    prompt = _build_prompt(catalog_items, invoice_text)
    response = client.chat.completions.create(
        model=AI_MODEL or 'llama3-8b-8192',
        messages=[
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': prompt},
        ],
        temperature=0.1,
    )
    return _parse_response(response.choices[0].message.content)


def _parse_with_ollama(catalog_items: list, invoice_text: str) -> list:
    import urllib.request

    prompt = _build_prompt(catalog_items, invoice_text)
    payload = json.dumps({
        'model': AI_MODEL or 'llama3.2:3b',
        'prompt': f'{SYSTEM_PROMPT}\n\n{prompt}',
        'stream': False,
    }).encode()

    req = urllib.request.Request(
        f'{OLLAMA_BASE_URL}/api/generate',
        data=payload,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
        return _parse_response(result.get('response', '[]'))


def parse_invoice_text(catalog_items: list, invoice_text: str) -> dict:
    provider = AI_PROVIDER.lower()
    logger.info(f'Parsing invoice with provider={provider}')

    try:
        if provider == 'gemini':
            matches = _parse_with_gemini(catalog_items, invoice_text)
        elif provider == 'groq':
            matches = _parse_with_groq(catalog_items, invoice_text)
        elif provider == 'ollama':
            matches = _parse_with_ollama(catalog_items, invoice_text)
        else:
            raise ValueError(f'Unknown AI provider: {provider}')

        return {
            'matches': matches,
            'provider': provider,
            'match_count': len(matches),
        }
    except Exception as e:
        logger.exception(f'AI parsing failed with {provider}: {e}')
        raise
