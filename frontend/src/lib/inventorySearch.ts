type PriceFilter = {
  op: '=' | '<' | '<=' | '>' | '>=';
  value: number;
  raw: string;
};

export type InventorySearchQuery = {
  terms: string[];
  skuTerms: string[];
  nameTerms: string[];
  categoryTerms: string[];
  unitTerms: string[];
  priceFilters: PriceFilter[];
};

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function parsePriceToken(token: string): PriceFilter | null {
  const raw = token.trim();
  const match = raw.match(/^(?:price:)?\$?(<=|>=|<|>|=)?\s*(\d+(?:\.\d{1,4})?)$/i);
  if (!match) return null;
  return {
    op: (match[1] || '=') as PriceFilter['op'],
    value: Number(match[2]),
    raw: match[2],
  };
}

export function parseInventoryQuery(input: string): InventorySearchQuery {
  const query: InventorySearchQuery = {
    terms: [],
    skuTerms: [],
    nameTerms: [],
    categoryTerms: [],
    unitTerms: [],
    priceFilters: [],
  };

  for (const part of normalize(input).split(/\s+/).filter(Boolean)) {
    const price = part.startsWith('$') || part.startsWith('price:') ? parsePriceToken(part) : null;
    if (price) {
      query.priceFilters.push(price);
      continue;
    }

    const [prefix, ...rest] = part.split(':');
    const value = rest.join(':');
    if (value) {
      if (prefix === 'sku') query.skuTerms.push(value);
      else if (prefix === 'name' || prefix === 'desc' || prefix === 'item') query.nameTerms.push(value);
      else if (prefix === 'cat' || prefix === 'category') query.categoryTerms.push(value);
      else if (prefix === 'unit') query.unitTerms.push(value);
      else query.terms.push(part);
    } else {
      query.terms.push(part);
    }
  }

  return query;
}

function matchesPrice(price: number, filter: PriceFilter) {
  if (!Number.isFinite(price)) return false;
  if (filter.op === '<') return price < filter.value;
  if (filter.op === '<=') return price <= filter.value;
  if (filter.op === '>') return price > filter.value;
  if (filter.op === '>=') return price >= filter.value;
  return Math.abs(price - filter.value) < 0.005 || price.toFixed(2).includes(filter.raw);
}

export function matchesInventoryQuery(item: Record<string, unknown>, query: InventorySearchQuery) {
  const sku = normalize(item.sku ?? item.id ?? item.barcode_id);
  const name = normalize(item.name ?? item.item ?? item.desc ?? item.description);
  const category = normalize(item.category ?? item.cat ?? item.category_name);
  const unit = normalize(item.unit);
  const price = Number(item.price ?? item.unit_price ?? 0);
  const priceText = Number.isFinite(price) ? price.toFixed(2) : '';
  const haystack = [sku, name, category, unit, priceText, `$${priceText}`].join(' ');

  return (
    query.terms.every((term) => haystack.includes(term)) &&
    query.skuTerms.every((term) => sku.includes(term)) &&
    query.nameTerms.every((term) => name.includes(term)) &&
    query.categoryTerms.every((term) => category.includes(term)) &&
    query.unitTerms.every((term) => unit.includes(term)) &&
    query.priceFilters.every((filter) => matchesPrice(price, filter))
  );
}
