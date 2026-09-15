import { describe, expect, it } from "vitest";
import { diffMarker, displayDiffValue, groupCommitChanges } from "./sourceControlDiff";

describe("source-control diff helpers", () => {
  it("maps create, update, and delete changes to Git-style markers", () => {
    expect(diffMarker({ change_type: "create" } as never)).toBe("A");
    expect(diffMarker({ change_type: "update" } as never)).toBe("M");
    expect(diffMarker({ change_type: "delete" } as never)).toBe("D");
  });

  it("groups granular fields into one logical changed entity", () => {
    const grouped = groupCommitChanges([
      { change_id: "1", item_id: "item-1", entity_type: "inventory", sku: "ABC 10", description: "Rice", field_name: "unit_price", change_type: "update" } as never,
      { change_id: "2", item_id: "item-1", entity_type: "inventory", sku: "ABC 10", description: "Rice", field_name: "par_level", change_type: "update" } as never,
      { change_id: "3", entity_id: "event-1", entity_type: "event", description: "Career fair", field_name: "title", change_type: "create" } as never,
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.find((group) => group.label === "Rice")).toMatchObject({
      marker: "M",
      path: "inventory/items/abc-10",
      rows: [{ field_name: "unit_price" }, { field_name: "par_level" }],
    });
    expect(grouped.find((group) => group.label === "Career fair")?.marker).toBe("A");
  });

  it("renders missing values explicitly", () => {
    expect(displayDiffValue(null)).toBe("∅");
    expect(displayDiffValue(0)).toBe("0");
    expect(displayDiffValue(10, "10 cases")).toBe("10 cases");
  });
});
