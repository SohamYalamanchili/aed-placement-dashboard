import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard build contains product metadata and generated data", async () => {
  const [layout, page, data] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/data/dashboard.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /AED Placement Lab/);
  assert.match(page, /Simulated analysis/);
  assert.match(page, /Global optimum/);
  assert.match(page, /Model comparison/);
  assert.match(page, /effectiveHousingInventory/);
  assert.match(page, /remaining-1/);
  assert.doesNotMatch(page, /new Set\(activeCostPlan\?\.actions/);
  const parsed = JSON.parse(data);
  assert.equal(parsed.meta.aeds, 50);
  assert.equal(parsed.meta.buildings, 149);
  assert.equal(parsed.meta.zones, parsed.zones.length);
  assert.ok(parsed.meta.zones >= parsed.meta.buildings);
  assert.equal(parsed.route_matrix.zone_ids.length, parsed.meta.zones);
  assert.ok(parsed.route_matrix.one_way_metres.every(
    row => row.length === parsed.route_matrix.site_ids.length,
  ));
  assert.equal(parsed.footprints.length, 137);
  assert.equal(parsed.campus_boundary.length, 1);
  assert.ok(parsed.selections.length >= 150);
  for (const plan of parsed.cost_plans) {
    const removed = plan.actions
      .filter(action => action.action === "remove_for_relocation")
      .reduce((sum, action) => sum + action.device_count, 0);
    const relocated = plan.actions
      .filter(action => action.action === "relocate_to")
      .reduce((sum, action) => sum + action.device_count, 0);
    assert.equal(removed, relocated);
  }
});
