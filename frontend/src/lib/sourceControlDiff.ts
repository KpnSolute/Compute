import type { SourceTransaction } from "./api";

export type DiffMarker = "A" | "M" | "D";

export interface LogicalCommitChange {
  key: string;
  label: string;
  path: string;
  marker: DiffMarker;
  rows: SourceTransaction[];
}

const ADDED = new Set(["add", "added", "create", "created", "insert", "new"]);
const DELETED = new Set(["delete", "deleted", "remove", "removed"]);

function normalizedChangeType(row: SourceTransaction): string {
  return String((row as SourceTransaction & { change_type?: string | null }).change_type || "")
    .trim()
    .toLowerCase();
}

export function diffMarker(row: SourceTransaction): DiffMarker {
  const changeType = normalizedChangeType(row);
  if (DELETED.has(changeType)) return "D";
  if (ADDED.has(changeType)) return "A";
  return "M";
}

function safeSegment(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return cleaned || fallback;
}

export function logicalChangeIdentity(row: SourceTransaction): { key: string; label: string; path: string } {
  const entityType = safeSegment(row.entity_type, "system");
  const identity = row.item_id || row.entity_id || row.sku || row.change_id || "change";
  const key = `${entityType}:${identity}`;
  const label = row.description || row.sku || row.entity_id || `${row.entity_type || "System"} change`;

  if (entityType === "inventory") {
    const filename = safeSegment(row.sku || row.entity_id || row.description, "item");
    return { key, label, path: `inventory/items/${filename}` };
  }

  const filename = safeSegment(row.entity_id || row.description || row.change_id, "entry");
  return { key, label, path: `${entityType}/${filename}` };
}

function groupMarker(rows: SourceTransaction[]): DiffMarker {
  const markers = new Set(rows.map(diffMarker));
  if (markers.has("D")) return "D";
  if (markers.has("A") && !markers.has("M")) return "A";
  return "M";
}

export function groupCommitChanges(rows: SourceTransaction[]): LogicalCommitChange[] {
  const grouped = new Map<string, LogicalCommitChange>();
  for (const row of rows) {
    const identity = logicalChangeIdentity(row);
    const current = grouped.get(identity.key);
    if (current) {
      current.rows.push(row);
      current.marker = groupMarker(current.rows);
      continue;
    }
    grouped.set(identity.key, {
      ...identity,
      marker: diffMarker(row),
      rows: [row],
    });
  }
  return Array.from(grouped.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function displayDiffValue(value: unknown, textValue?: string | null): string {
  if (textValue !== null && textValue !== undefined && textValue !== "") return textValue;
  if (value === null || value === undefined || value === "") return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
