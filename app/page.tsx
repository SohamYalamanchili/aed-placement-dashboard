"use client";

/* Building selection intentionally synchronizes floor, zone, and map-camera state. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useRef, useState } from "react";

type Zone = Record<string, number | string> & {
  zone_id: string; building_code: string; building_name: string; floor: number;
  zone_type: string; campus_x_m: number; campus_y_m: number;
  nearest_aed_estimated_retrieval_minutes: number;
};
type Site = { site_id: string; building_code: string; building_name: string; floor: number; x: number; y: number };
type Selection = { mode: string; scenario: string; inventory_scenario?: string; budget: number; improvement_pct: number; sites: Site[] };
type CostAction = Site & { action: "remove_for_relocation" | "relocate_to" | "buy_new"; cost_usd: number; device_count: number; relocated_from_site_id?: string };
type CostPlan = { plan_id:string; scenario:string; budget_usd:number; total_cost_usd:number; unused_budget_usd:number; new_aeds:number; relocations:number; improvement_pct:number; solver_status:string; actions:CostAction[] };
type NetworkSite = { id:string; kind:string; x:number; y:number; floor:number; code:string; label:string };
type HypotheticalAed = { inventory_scenario:string;site_id:string;building_code:string;building_name:string;floor:number;campus_x_m:number;campus_y_m:number;status:string };
type Footprint = { osm_id: string; building_code: string | null; name: string | null; points: number[][]; primary: boolean };
type DashboardData = {
  meta: { buildings: number; zones: number; aeds: number; candidates: number };
  bounds: { min_x: number; max_x: number; min_y: number; max_y: number };
  geo_bounds: { min_x: number; max_x: number; min_y: number; max_y: number };
  footprints: Footprint[];
  campus_boundary: number[][][];
  buildings: Array<{ building_code: string; building_name: string; building_type: string; campus_x_m: number; campus_y_m: number; has_public_aed: boolean }>;
  aeds: Array<{ aed_analysis_id: string; analysis_building_code: string; floor: number; campus_x_m: number; campus_y_m: number }>;
  hypothetical_aeds: HypotheticalAed[];
  route_matrix: { method: string; zone_ids: string[]; site_ids: string[]; minutes_by_preset: Record<"fast"|"base"|"conservative",number[][]>; route_type_codes:Record<"fast"|"base"|"conservative",number[][]>; route_type_legend:Record<string,string> };
  route_audit: { current_zone_aed_pairs: number; fallback_pairs: number; fallback_fraction: number; fallback_method: string; skybridge_pairs:number; same_building_pairs:number; ground_pairs:number; active_skybridges:number; base_export_skybridge_pairs:number };
  zones: Zone[];
  selections: Selection[];
  cost_plans: CostPlan[];
  cost_assumptions: { all_costs_simulated:boolean; new_base_total_usd:number; relocation_base_total_usd:number; candidate_shortlist:string };
  readiness: { status:string; score:number; allowed_modes:string[]; blocked_modes:string[]; authoritative_data_needed:string[] };
};

const scenarios = [
  ["weekday_day", "Day"], ["weekday_evening", "Evening"], ["overnight", "Overnight"],
  ["weekend", "Weekend"], ["large_campus_festival", "Event"],
];
export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scenario, setScenario] = useState("weekday_day");
  const [budget, setBudget] = useState(3);
  const [costBudget, setCostBudget] = useState(7500);
  const [layer, setLayer] = useState<"demand" | "retrieval">("demand");
  const [placementMode, setPlacementMode] = useState<"current" | "add" | "cost" | "same_count">("add");
  const [assumptionPreset, setAssumptionPreset] = useState<"fast" | "base" | "conservative">("base");
  const [networkView, setNetworkView] = useState<"before" | "after">("after");
  const [housingInventory, setHousingInventory] = useState("confirmed_only");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activePage, setActivePage] = useState<"overview"|"map"|"optimize">("overview");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const mapRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const showHeat = true;

  useEffect(() => {
    let cancelled = false;
    fetch("/data/dashboard.json")
      .then(response => {
        if (!response.ok) throw new Error(`Dashboard data request failed (${response.status})`);
        return response.json() as Promise<DashboardData>;
      })
      .then(result => { if (!cancelled) setData(result); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : "Dashboard data could not be loaded"); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!data || !selectedBuilding) { setSelectedFloor(null); return; }
    const buildingZones = data.zones.filter(z => z.building_code === selectedBuilding);
    const floors = [...new Set(buildingZones.map(z => Number(z.floor)))].sort((a,b) => a-b);
    const firstFloor = floors[0] ?? null;
    setSelectedFloor(firstFloor);
    setSelectedZone(buildingZones.find(zone => Number(zone.floor) === firstFloor)?.zone_id ?? null);
  }, [data, selectedBuilding]);
  useEffect(() => {
    if (!data || !selectedBuilding || !mapRef.current) return;
    const footprint = data.footprints.find(f => f.primary && f.building_code === selectedBuilding);
    if (!footprint) return;
    const x = footprint.points.reduce((sum, point) => sum + point[0], 0) / footprint.points.length;
    const y = footprint.points.reduce((sum, point) => sum + point[1], 0) / footprint.points.length;
    const xRatio = (x - data.geo_bounds.min_x) / (data.geo_bounds.max_x - data.geo_bounds.min_x);
    const yRatio = (data.geo_bounds.max_y - y) / (data.geo_bounds.max_y - data.geo_bounds.min_y);
    const rect = mapRef.current.getBoundingClientRect();
    const focusZoom = 3;
    const focusPan = { x: rect.width / 2 - xRatio * rect.width * focusZoom, y: rect.height / 2 - yRatio * rect.height * focusZoom };
    viewRef.current = { zoom: focusZoom, pan: focusPan };
    setZoom(focusZoom);
    setPan(focusPan);
  }, [data, selectedBuilding]);
  useEffect(() => {
    const exitFocusedBuilding = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      viewRef.current = { zoom: 1, pan: { x: 0, y: 0 } };
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setSelectedBuilding(null);
      setSelectedZone(null);
    };
    window.addEventListener("keydown", exitFocusedBuilding);
    return () => window.removeEventListener("keydown", exitFocusedBuilding);
  }, []);
  const normalizedScenario = scenario;
  // Cost plans and the same-count benchmark are defined against the confirmed
  // 50-device pilot inventory. Do not let an optional housing sensitivity
  // setting silently turn those comparisons into 51–55 devices versus 50.
  const effectiveHousingInventory =
    placementMode === "cost" || placementMode === "same_count" ? "confirmed_only" : housingInventory;
  const activeSelection = useMemo(() => {
    if (!data) return null;
    if (placementMode === "current") return null;
    if (placementMode === "same_count") return data.selections.find(s => s.mode === "same_count" &&
      s.scenario === scenario && s.budget === 50) ?? null;
    return data.selections.find(s => s.mode === "simple" &&
      s.scenario === scenario && s.budget === budget &&
      s.inventory_scenario === effectiveHousingInventory) ?? null;
  }, [data, scenario, budget, placementMode, effectiveHousingInventory]);
  const activeCostPlan = useMemo(() => data?.cost_plans.filter(plan => plan.scenario === scenario && plan.budget_usd <= costBudget).sort((a,b)=>b.budget_usd-a.budget_usd)[0] ?? null, [data,scenario,costBudget]);
  const clusteredAeds = useMemo(() => {
    if (!data) return [];
    const groups = new Map<string, typeof data.aeds>();
    data.aeds.forEach(aed => groups.set(aed.analysis_building_code, [...(groups.get(aed.analysis_building_code) ?? []), aed]));
    return Array.from(groups.entries()).map(([code, entries]) => ({
      code, count: entries.length,
      x: entries.reduce((sum, item) => sum + item.campus_x_m, 0) / entries.length,
      y: entries.reduce((sum, item) => sum + item.campus_y_m, 0) / entries.length,
      floors: [...new Set(entries.map(item => item.floor))].sort((a,b) => a-b),
    }));
  }, [data]);

  const proposedSites = useMemo(() => {
    if (!data) return [];
    const currentNetwork: NetworkSite[] = data.aeds.map(a => ({ id: a.aed_analysis_id, kind: "current", x: a.campus_x_m, y: a.campus_y_m, floor: a.floor, code: a.analysis_building_code, label: `Current AED · ${a.analysis_building_code} · Floor ${a.floor}` }));
    const hypotheticalNetwork: NetworkSite[] = data.hypothetical_aeds.filter(a => a.inventory_scenario === effectiveHousingInventory).map(a => ({id:a.site_id,kind:"hypothetical",x:a.campus_x_m,y:a.campus_y_m,floor:a.floor,code:a.building_code,label:`Hypothetical AED · ${a.building_code} · Floor ${a.floor}`}));
    if (placementMode === "current") return [...currentNetwork,...hypotheticalNetwork];
    if (placementMode === "cost" && activeCostPlan) {
      const removals = new Map<string,number>();
      activeCostPlan.actions.filter(a=>a.action==="remove_for_relocation").forEach(action => {
        const key = `${action.building_code}-F${action.floor}`;
        removals.set(key,(removals.get(key) ?? 0) + action.device_count);
      });
      // Remove exactly the number of devices authorized by the plan. Several
      // UTD building-floor groups contain multiple AEDs and must retain one.
      const retained = currentNetwork.filter(site => {
        const key = `${site.code}-F${site.floor}`;
        const remaining = removals.get(key) ?? 0;
        if (remaining <= 0) return true;
        removals.set(key,remaining-1);
        return false;
      });
      const changed = activeCostPlan.actions.filter(a=>a.action!=="remove_for_relocation").map(a=>({id:a.site_id,kind:a.action==="buy_new"?"new":"relocated",x:a.x,y:a.y,floor:a.floor,code:a.building_code,label:`${a.action==="buy_new"?"New":"Relocated"} AED · ${a.building_code} · Floor ${a.floor}`}));
      return [...retained,...changed];
    }
    const optimizedNetwork = (activeSelection?.sites ?? []).map(s => ({ id: s.site_id, kind: "optimized", x: s.x, y: s.y, floor: s.floor, code: s.building_code, label: `${placementMode === "same_count" ? "Redesigned AED" : "New AED"} · ${s.building_code} · Floor ${s.floor}` }));
    if (placementMode === "same_count") return optimizedNetwork;
    return [...currentNetwork,...hypotheticalNetwork, ...optimizedNetwork];
  }, [data, activeSelection, activeCostPlan, placementMode, effectiveHousingInventory]);
  const analysisSites = useMemo(() => {
    if (!data || (networkView === "after" && placementMode !== "current")) return proposedSites;
    return [
      ...data.aeds.map(a => ({ id: a.aed_analysis_id, kind: "current", x: a.campus_x_m, y: a.campus_y_m, floor: a.floor, code: a.analysis_building_code, label: `Current AED · ${a.analysis_building_code} · Floor ${a.floor}` })),
      ...data.hypothetical_aeds.filter(a => a.inventory_scenario === effectiveHousingInventory).map(a => ({id:a.site_id,kind:"hypothetical",x:a.campus_x_m,y:a.campus_y_m,floor:a.floor,code:a.building_code,label:`Hypothetical AED · ${a.building_code} · Floor ${a.floor}`})),
    ];
  }, [data,proposedSites,networkView,placementMode,effectiveHousingInventory]);

  if (loadError) return <main className="loading"><div className="loading-mark">!</div><p>{loadError}. Refresh the page or regenerate the dashboard data.</p></main>;
  if (!data) return <main className="loading"><div className="loading-mark">A</div><p>Preparing the campus analysis…</p></main>;

  const demandKey = `demand_${normalizedScenario}`;
  const assumptionParams = {
    fast: { speed: 2.5, routeBuffer: 1.0, floor: 15, cabinet: 15 },
    base: { speed: 2.0, routeBuffer: 1.0, floor: 30, cabinet: 30 },
    conservative: { speed: 1.5, routeBuffer: 1.15, floor: 45, cabinet: 45 },
  }[assumptionPreset];
  const footprintCentres = new Map(data.footprints.filter(f => f.primary && f.building_code).map(f => [f.building_code as string, {
    x: f.points.reduce((sum, p) => sum + p[0], 0) / f.points.length,
    y: f.points.reduce((sum, p) => sum + p[1], 0) / f.points.length,
  }]));
  // Put every zone and AED into the same real-map coordinate system before
  // measuring distance. The older simulated campus coordinates are only used
  // as small within-building offsets, never as cross-campus geography.
  const mappedPoint = (code: string, oldX?: number, oldY?: number) => {
    const centre = footprintCentres.get(code);
    if (!centre) return { x: oldX ?? 0, y: oldY ?? 0 };
    const old = data.buildings.find(building => building.building_code === code);
    return {
      x: centre.x + ((oldX ?? old?.campus_x_m ?? 0) - (old?.campus_x_m ?? 0)) * .22,
      y: centre.y + ((oldY ?? old?.campus_y_m ?? 0) - (old?.campus_y_m ?? 0)) * .22,
    };
  };
  const geoPosition = (code: string, oldX?: number, oldY?: number) => {
    const {x,y} = mappedPoint(code,oldX,oldY);
    return {
      left: `${((x - data.geo_bounds.min_x) / (data.geo_bounds.max_x - data.geo_bounds.min_x)) * 100}%`,
      top: `${((data.geo_bounds.max_y - y) / (data.geo_bounds.max_y - data.geo_bounds.min_y)) * 100}%`,
    };
  };
  const geoAbsolutePosition = (x: number, y: number) => ({
    left: `${((x - data.geo_bounds.min_x) / (data.geo_bounds.max_x - data.geo_bounds.min_x)) * 100}%`,
    top: `${((data.geo_bounds.max_y - y) / (data.geo_bounds.max_y - data.geo_bounds.min_y)) * 100}%`,
  });
  const routeZoneIndex = new Map(data.route_matrix.zone_ids.map((id,index) => [id,index]));
  const routeSiteIndex = new Map(data.route_matrix.site_ids.map((id,index) => [id,index]));
  const storedRetrieval = (zone: Zone, site: {id:string;code:string;x:number;y:number;floor:number}) => {
    const row = routeZoneIndex.get(zone.zone_id);
    const column = routeSiteIndex.get(site.id);
    if (row != null && column != null) {
      return data.route_matrix.minutes_by_preset[assumptionPreset][row][column];
    }
    // Defensive fallback only. Every exported current/candidate site is expected
    // to be in the matrix and validation rejects an incomplete matrix.
    const zonePoint = mappedPoint(zone.building_code,Number(zone.campus_x_m),Number(zone.campus_y_m));
    const sitePoint = mappedPoint(site.code,site.x,site.y);
    const metres = Math.hypot(zonePoint.x-sitePoint.x,zonePoint.y-sitePoint.y) * 1.45;
    const floors = zone.building_code === site.code
      ? Math.abs(Number(zone.floor)-site.floor)
      : Math.max(0,Number(zone.floor)-1)+Math.max(0,site.floor-1);
    return ((metres * assumptionParams.routeBuffer * 2 / assumptionParams.speed)
      + floors * assumptionParams.floor * 2 + assumptionParams.cabinet) / 60;
  };
  const storedRouteType = (zone: Zone, site: {id:string;code:string;x:number;y:number;floor:number}) => {
    const row = routeZoneIndex.get(zone.zone_id);
    const column = routeSiteIndex.get(site.id);
    if (row != null && column != null) {
      const code = data.route_matrix.route_type_codes[assumptionPreset][row][column];
      return data.route_matrix.route_type_legend[String(code)] ?? "ground";
    }
    return zone.building_code === site.code ? "same_building" : "ground";
  };
  const retrievalFor = (zone: Zone) => Math.min(
    ...analysisSites.map(site => storedRetrieval(zone,site)));
  const selected = data.buildings.find(b => b.building_code === selectedBuilding);
  const people = data.zones.reduce((sum, z) => sum + Number(z[`people_${normalizedScenario}`] ?? 0), 0);
  const hypotheticalCount = data.hypothetical_aeds.filter(a=>a.inventory_scenario===effectiveHousingInventory).length;
  const currentSites = [
    ...data.aeds.map(a => ({ id: a.aed_analysis_id, kind: "current", x: a.campus_x_m, y: a.campus_y_m, floor: a.floor, code: a.analysis_building_code, label: `Current AED · ${a.analysis_building_code} · Floor ${a.floor}` })),
    ...data.hypothetical_aeds.filter(a=>a.inventory_scenario===effectiveHousingInventory).map(a=>({id:a.site_id,kind:"hypothetical",x:a.campus_x_m,y:a.campus_y_m,floor:a.floor,code:a.building_code,label:`Hypothetical AED · ${a.building_code} · Floor ${a.floor}`}))
  ];
  const retrievalWith = (zone: Zone, sites: typeof currentSites) => Math.min(
    ...sites.map(site => storedRetrieval(zone,site)));
  const weights = data.zones.map(z => Number(z[demandKey] ?? 0));
  const efficiencyFor = (sites: typeof currentSites) => 100 * data.zones.reduce((sum, z, i) => sum + weights[i] * Math.pow(.94, retrievalWith(z, sites)), 0) / Math.max(1, weights.reduce((a,b) => a+b, 0));
  const currentEfficiency = efficiencyFor(currentSites);
  const proposedEfficiency = efficiencyFor(proposedSites);
  const scenarioPeopleWeights = data.zones.map(z=>Number(z[`people_${normalizedScenario}`]??0));
  const scenarioAverageRetrieval = data.zones.reduce((sum,z,index)=>sum+scenarioPeopleWeights[index]*retrievalWith(z,currentSites),0)/Math.max(1,scenarioPeopleWeights.reduce((a,b)=>a+b,0));
  const bestValuePlan = data.cost_plans.filter(plan=>plan.scenario===scenario&&plan.total_cost_usd>0).sort((a,b)=>(b.improvement_pct/b.total_cost_usd)-(a.improvement_pct/a.total_cost_usd))[0]??null;
  const sameCountIllustrativeCost = data.meta.aeds*data.cost_assumptions.relocation_base_total_usd;
  const selectedZones = data.zones.filter(z => z.building_code === selectedBuilding);
  const buildingFloors = [...new Set(selectedZones.map(z => Number(z.floor)))].sort((a,b) => a-b);
  const floorZones = selectedFloor == null ? selectedZones : selectedZones.filter(z => Number(z.floor) === selectedFloor);
  const selectedZoneRecord = data.zones.find(z => z.zone_id === selectedZone) ?? null;
  const visibleMapZones = selectedZoneRecord ? [selectedZoneRecord] : [];
  const zoneDisplayPosition = (zone: Zone) => geoPosition(zone.building_code,zone.campus_x_m,zone.campus_y_m);
  const selectedTargetZones = selectedZoneRecord ? [selectedZoneRecord] : floorZones;
  const selectedAvgRetrieval = selectedTargetZones.length ? selectedTargetZones.reduce((sum,z) => sum + retrievalFor(z), 0) / selectedTargetZones.length : 0;
  const selectedNearest = selectedTargetZones.length && analysisSites.length ? analysisSites.map(site => ({...site, minutes: retrievalWith(selectedTargetZones[0], [site])})).sort((a,b) => a.minutes-b.minutes)[0] : null;
  const selectedRouteType = selectedZoneRecord && selectedNearest
    ? storedRouteType(selectedZoneRecord,selectedNearest) : null;
  const selectedRouteLabel = selectedRouteType === "skybridge" ? "Skybridge route"
    : selectedRouteType === "same_building" ? "Inside the same building"
    : "Ground pedestrian route";
  const selectedRisk = selectedAvgRetrieval <= 3
    ? {label:"Low",className:"low",meaning:"AED estimated within 3 minutes"}
    : selectedAvgRetrieval <= 5
      ? {label:"Moderate",className:"moderate",meaning:"AED estimated within 3–5 minutes"}
      : {label:"High",className:"high",meaning:"AED estimated beyond 5 minutes"};
  const buildingHeat = new Map<string, number>();
  data.buildings.forEach(building => {
    const bz = data.zones.filter(z => z.building_code === building.building_code);
    const value = layer === "demand" ? bz.reduce((sum,z) => sum + Number(z[`people_${normalizedScenario}`] ?? 0), 0) :
      (bz.length ? bz.reduce((sum,z) => sum + retrievalFor(z), 0) / bz.length : 0);
    buildingHeat.set(building.building_code, value);
  });
  const maxBuildingHeat = Math.max(...buildingHeat.values(), 1);
  const solidRed = (intensity:number) => {
    const scaled = Math.pow(Math.max(0,Math.min(1,intensity)),.62);
    const light = [255,239,236], dark = [126,0,20];
    const rgb = light.map((value,index)=>Math.round(value+(dark[index]-value)*scaled));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  };
  const darkestEntry = [...buildingHeat.entries()].sort((a,b) => b[1]-a[1])[0];
  const darkestBuilding = data.buildings.find(b => b.building_code === darkestEntry?.[0]);
  const connection = selectedZoneRecord && selectedNearest ? {
    from: zoneDisplayPosition(selectedZoneRecord),
    to: geoPosition(selectedNearest.code, selectedNearest.x, selectedNearest.y),
  } : null;
  const assumptions = {
    fast: { speed: "9.0 km/h", detour: "0%", floor: "15 sec", cabinet: "15 sec" },
    base: { speed: "7.2 km/h", detour: "0%", floor: "30 sec", cabinet: "30 sec" },
    conservative: { speed: "5.4 km/h", detour: "15%", floor: "45 sec", cabinet: "45 sec" },
  }[assumptionPreset];
  const setMapView = (nextZoom: number, nextPan: {x:number;y:number}) => {
    viewRef.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom);
    setPan(nextPan);
  };
  const zoomAt = (nextZoom: number, anchorX: number, anchorY: number) => {
    const current = viewRef.current;
    // The map world already represents the complete campus extent. Allowing a
    // zoom below 1 shrinks that world inside the viewport and makes every
    // analysis marker appear detached from the background.
    const boundedZoom = Math.min(8, Math.max(1, nextZoom));
    const ratio = boundedZoom / current.zoom;
    setMapView(boundedZoom, {
      x: anchorX - (anchorX - current.pan.x) * ratio,
      y: anchorY - (anchorY - current.pan.y) * ratio,
    });
  };
  const zoomBy = (factor: number) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(viewRef.current.zoom * factor, rect.width / 2, rect.height / 2);
  };
  const resetMap = () => { setMapView(1, { x: 0, y: 0 }); setSelectedBuilding(null); setSelectedZone(null); };
  const exportAnalysis = () => {
    const report = { exported_at:new Date().toISOString(), disclaimer:"Simulation prototype—not a UTD deployment recommendation", scenario, demand_input:"simulated occupancy", placement_mode:placementMode, quantity_budget:budget, monetary_budget_usd:costBudget, cost_plan:placementMode==="cost"?activeCostPlan:null, assumptions:{assumptionPreset,...assumptions}, readiness:data.readiness };
    const blob = new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
    const link = document.createElement("a"); link.href=URL.createObjectURL(blob); link.download=`aed-analysis-${scenario}.json`; link.click(); URL.revokeObjectURL(link.href);
  };

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <div className="brand-mark">A</div>
        <nav aria-label="Primary navigation">
          <button className="rail-button active" aria-label="Campus analysis">⌖</button>
          <button className="rail-button" aria-label="Model results">⌁</button>
          <button className="rail-button" aria-label="Scenarios">◫</button>
          <button className="rail-button" aria-label="Documentation">≡</button>
        </nav>
            <button className="rail-button bottom" aria-label="Information">i</button>
      </aside>

      <section className={`workspace view-${activePage} ${selected?"has-map-selection":""}`}>
        <header className="topbar">
          <div>
            <div className="eyebrow">UT Dallas · Decision Support Prototype</div>
            <h1>AED Placement Lab</h1>
          </div>
          <div className="topbar-actions">
            <span className="simulation-pill"><i /> Simulated analysis</span>
            <button className="export-button" onClick={exportAnalysis}>Download analysis</button>
          </div>
        </header>

        <nav className="page-navigation" aria-label="Dashboard pages">
          {[["overview","Overview"],["map","Campus map"],["optimize","Optimize"]].map(([value,label],index)=><button key={value} className={activePage===value?"selected":""} onClick={()=>{setActivePage(value as typeof activePage);if(value!=="map")resetMap()}}><small>0{index+1}</small><span>{label}</span></button>)}
        </nav>

        <section className="control-strip" aria-label="Analysis controls">
          <div className="control-group scenario-tabs">
            <span className="control-label">Scenario</span>
            <div className="segmented">
              {scenarios.map(([value, label]) => <button key={value} className={scenario === value ? "selected" : ""} onClick={() => setScenario(value)}>{label}</button>)}
            </div>
          </div>
          <div className="control-group budget-control"><span className="control-label">{placementMode==="cost"?"Total money available":"New AED count"}</span>
            {placementMode==="cost"?<label className="money-input"><span>$</span><input type="number" min="0" max="50000" step="100" value={costBudget} onChange={e=>setCostBudget(Math.max(0,Math.min(50000,Number(e.target.value)||0)))} aria-label="Total money available in dollars"/></label>:<div className="budget-steps">{[1,2,3,4,5].map(value => <button key={value} className={budget === value ? "selected" : ""} onClick={() => setBudget(value)}>{value}</button>)}</div>}
          </div>
          <div className={`control-group housing-control advanced-control ${showAdvanced?"visible":""}`}><span className="control-label">Inventory stress test</span><div className="housing-steps">{[["confirmed_only","Pilot inventory"],["hypothetical_1","+1 hypothetical"],["hypothetical_3","+3 hypothetical"],["hypothetical_5","+5 hypothetical"]].map(([value,label])=><button key={value} className={housingInventory===value?"selected":""} onClick={()=>setHousingInventory(value)}>{label}</button>)}</div><small>The pilot treats its 50-device inventory as complete; extras are optional sensitivity tests.</small></div>
          <button className="advanced-toggle" onClick={()=>setShowAdvanced(value=>!value)} aria-expanded={showAdvanced}>{showAdvanced?"Hide advanced":"Advanced"}</button>
        </section>

        <section className="how-to-strip" aria-label="How to use this dashboard">
          <span><b>1</b><em>Choose when</em><strong>{scenarios.find(s => s[0] === scenario)?.[1]}</strong></span>
          <i>→</i><span><b>2</b><em>Choose resources</em><strong>{placementMode==="cost"?`$${costBudget.toLocaleString()}`:`${budget} new AED${budget > 1 ? "s" : ""}`}</strong></span>
          <i>→</i><span><b>3</b><em>Read the map</em><strong>Orange numbers are the answer</strong></span>
        </section>

        {(activePage==="overview"||activePage==="optimize")&&<section className="metric-row">
          <article className="metric-card"><span>Network being tested</span><strong>{data.meta.aeds+hypotheticalCount}</strong><small>{data.meta.aeds} pilot AEDs · assumed operational and 24/7{hypotheticalCount?` + ${hypotheticalCount} hypothetical`:""}</small></article>
          <article className="metric-card"><span>People in scenario</span><strong>{people.toLocaleString()}</strong><small>Simulated zone occupancy</small></article>
          <article className="metric-card accent"><span>Current layout efficiency</span><strong>{currentEfficiency.toFixed(1)}%</strong><small>Demand-weighted access index · before changes</small></article>
          <article className="metric-card"><span>Average retrieval</span><strong>{scenarioAverageRetrieval.toFixed(1)} min</strong><small>{scenarios.find(s=>s[0]===scenario)?.[1]} demand · current network</small></article>
        </section>}

        {activePage==="overview"&&<section className="overview-grid">
          <article><span>01</span><div><strong>Choose a scenario</strong><p>Day, evening, overnight, weekend, or event demand.</p></div></article>
          <article><span>02</span><div><strong>Inspect the campus</strong><p>See estimated people present, retrieval time, buildings, floors, and AEDs.</p></div></article>
          <article><span>03</span><div><strong>Create a plan</strong><p>Add devices, enter a dollar budget, or compare a redesigned network.</p></div></article>
          <button onClick={()=>setActivePage("map")}>Open campus map →</button>
        </section>}

        {activePage==="optimize"&&<section className="planner-mode-switch" aria-label="Planning method">
          <button className={placementMode==="current"?"selected":""} onClick={()=>setPlacementMode("current")}><small>01</small><strong>Current network</strong><span>No changes</span></button>
          <button className={placementMode==="add"?"selected":""} onClick={()=>setPlacementMode("add")}><small>02</small><strong>Add AEDs</strong><span>Keep all + add {budget}</span></button>
          <button className={placementMode==="cost"?"selected":""} onClick={()=>{setPlacementMode("cost");setHousingInventory("confirmed_only")}}><small>03</small><strong>Optimize money</strong><span>Buy + relocate</span></button>
          <button className={placementMode==="same_count"?"selected":""} onClick={()=>setPlacementMode("same_count")}><small>04</small><strong>Redesign same 50</strong><span>Benchmark</span></button>
        </section>}

        {(activePage==="map"||activePage==="optimize")&&<section className="main-grid">
          <article className="map-card">
            <div className="card-heading">
              <div><span className="kicker">Campus network</span><h2>Where should the AEDs go?</h2></div>
              <div className="map-actions"><div className="layer-toggle"><button className={layer === "demand" ? "selected" : ""} onClick={() => setLayer("demand")}>People present</button><button className={layer === "retrieval" ? "selected" : ""} onClick={() => setLayer("retrieval")}>Time to AED</button></div></div>
            </div>
            <div className="map-explainer"><strong>{layer === "demand" ? "People present = simulated occupancy in this scenario" : "Time to AED = estimated fetch-and-return time"}</strong><span>{layer === "demand" ? "Light red means fewer people; dark red means more people. This is a count, not people per square foot, and it changes with the selected time scenario." : `Light red means faster access; dark red means slower access for the ${networkView === "before" ? "current" : "proposed"} network.`}</span></div>
            <div className="active-filter-status"><i/><div><small>Active map filter</small><b>{layer === "demand" ? "People present" : "Time to AED"}</b></div><span>{layer==="demand"?"Most people":"Slowest average retrieval"}: <strong>{darkestBuilding?.building_code ?? "—"}</strong> · {layer === "demand" ? `${Math.round(darkestEntry?.[1] ?? 0).toLocaleString()} simulated people (unchanged by AED placement)` : `${(darkestEntry?.[1] ?? 0).toFixed(1)} min for the ${networkView==="before"?"Before":"After"} network`}</span></div>
            <div className="placement-switch" aria-label="Placement comparison">
              <button className={placementMode === "current" ? "selected" : ""} onClick={() => setPlacementMode("current")}><small>01</small><span><b>Pilot network</b><em>{data.meta.aeds} complete · operational · 24/7{hypotheticalCount?` + ${hypotheticalCount} hypothetical`:""}</em></span></button>
              <button className={placementMode === "add" ? "selected" : ""} onClick={() => setPlacementMode("add")}><small>02</small><span><b>Add AEDs</b><em>Start with {data.meta.aeds+hypotheticalCount} + add {budget}</em></span></button>
              <button className={placementMode === "cost" ? "selected" : ""} onClick={() => {setPlacementMode("cost");setHousingInventory("confirmed_only")}}><small>03</small><span><b>Optimize money</b><em>Buy + relocate</em></span></button>
              <button className={placementMode === "same_count" ? "selected" : ""} onClick={() => setPlacementMode("same_count")}><small>04</small><span><b>Redesign same 50</b><em>Greedy benchmark</em></span></button>
            </div>
            <div className="comparison-bar"><span>Network shown</span><div><button className={networkView === "before" ? "selected" : ""} onClick={() => setNetworkView("before")}><b>Before</b><small>{currentEfficiency.toFixed(1)}% efficiency</small></button><button className={networkView === "after" ? "selected" : ""} onClick={() => setNetworkView("after")} disabled={placementMode === "current"}><b>After</b><small>{proposedEfficiency.toFixed(1)}% efficiency</small></button></div><p>{layer === "demand" ? `Expected change: ${(proposedEfficiency-currentEfficiency)>=0?"+":""}${(proposedEfficiency-currentEfficiency).toFixed(1)} points.` : `Access index change: ${(proposedEfficiency-currentEfficiency)>=0?"+":""}${(proposedEfficiency-currentEfficiency).toFixed(1)} points.`}</p></div>
            <div ref={mapRef} className={`campus-map heat-${layer}`} role="img" aria-label="Pan and zoom UTD campus AED analysis map"
              onWheel={e => { e.preventDefault(); const rect=e.currentTarget.getBoundingClientRect(); zoomAt(viewRef.current.zoom*(e.deltaY<0?1.12:1/1.12),e.clientX-rect.left,e.clientY-rect.top); }}
              onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, panX: viewRef.current.pan.x, panY: viewRef.current.pan.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={e => { if (drag.current) setMapView(viewRef.current.zoom,{ x: drag.current.panX + e.clientX - drag.current.x, y: drag.current.panY + e.clientY - drag.current.y }); }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
              <div className={`map-world ${selectedBuilding ? "building-focused" : ""} ${selectedZoneRecord ? "has-selected-zone" : ""}`} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
              <svg className="footprint-layer" viewBox={`${data.geo_bounds.min_x} ${-data.geo_bounds.max_y} ${data.geo_bounds.max_x-data.geo_bounds.min_x} ${data.geo_bounds.max_y-data.geo_bounds.min_y}`} preserveAspectRatio="none" aria-label="Official UTD campus building footprints">
                {data.campus_boundary.map((points,index) => <polyline key={`boundary-${index}`} points={points.map(p => `${p[0]},${-p[1]}`).join(" ")} className="campus-boundary"/>)}
                {data.footprints.map(f => { const intensity=f.building_code ? (buildingHeat.get(f.building_code) ?? 0)/maxBuildingHeat : 0; return <polygon key={f.osm_id} points={f.points.map(p => `${p[0]},${-p[1]}`).join(" ")} className={`${f.primary && f.building_code ? "analysis-footprint" : "context-footprint"} ${selectedBuilding === f.building_code ? "selected-footprint" : ""} ${selectedZoneRecord && selectedNearest?.code === f.building_code && selectedBuilding !== f.building_code ? "nearest-aed-footprint" : ""}`} style={f.primary && f.building_code && showHeat ? {fill:solidRed(intensity)} : undefined} onPointerDown={e => e.stopPropagation()} onClick={() => { if(f.building_code){setSelectedBuilding(f.building_code);setSelectedZone(null)} }}><title>{f.name ?? f.building_code ?? "Campus building"} · {layer === "demand" ? `${Math.round(buildingHeat.get(f.building_code!) ?? 0)} simulated people` : `${(buildingHeat.get(f.building_code!) ?? 0).toFixed(1)} min average retrieval`}</title></polygon>})}
              </svg>
              {showHeat && data.zones.filter(z => z.zone_type === "outdoor_common").map(z => {
                const raw = layer === "demand" ? Number(z[demandKey] ?? 0) : retrievalFor(z);
                const intensity = Math.max(.08, raw / maxBuildingHeat);
                return <button key={`outdoor-${z.zone_id}`} className={`outdoor-heat-zone ${selectedZone === z.zone_id ? "selected" : ""}`} style={{...geoAbsolutePosition(Number(z.campus_x_m),Number(z.campus_y_m)),opacity:.18+Math.min(1,intensity)*.72,transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={`${z.building_name} · ${Math.round(Number(z[`people_${normalizedScenario}`] ?? 0))} simulated people · ${retrievalFor(z).toFixed(1)} min`} onPointerDown={event=>event.stopPropagation()} onClick={()=>{setSelectedBuilding(z.building_code);setSelectedFloor(1);setSelectedZone(z.zone_id)}}><span>{z.building_name}</span></button>;
              })}
              {visibleMapZones.map(z => <button key={z.zone_id} className={`zone-point ${selectedZone === z.zone_id ? "selected" : ""}`} style={{...zoneDisplayPosition(z), transform:`scale(${1/zoom})`}} title={`${z.building_name} · Floor ${z.floor} · ${retrievalFor(z).toFixed(1)} min retrieval`} onPointerDown={e => e.stopPropagation()} onClick={() => {setSelectedBuilding(z.building_code);setSelectedZone(z.zone_id)}}/>)}
              {data.footprints.filter(f => f.primary && f.building_code && (zoom >= 2.2 || selectedBuilding === f.building_code || selectedNearest?.code === f.building_code)).map(f => <button key={`label-${f.osm_id}`} className={`footprint-label ${selectedBuilding === f.building_code ? "selected-label" : ""}`} style={{...geoPosition(f.building_code!), transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={f.name ?? f.building_code!} onPointerDown={e=>e.stopPropagation()} onClick={()=>{setSelectedBuilding(f.building_code);setSelectedZone(null)}}><b>{f.building_code}</b><span>{f.name}</span></button>)}
              {networkView === "before" && clusteredAeds.map(a => <button key={a.code} className={`aed-marker ${selectedBuilding === a.code ? "in-selected-building" : ""} ${selectedNearest?.kind === "current" && selectedNearest.code === a.code ? "nearest-target" : ""}`} style={{...geoPosition(a.code,a.x,a.y), transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={`${a.count} current AED${a.count > 1 ? "s" : ""} · ${a.code}`} onPointerDown={e => e.stopPropagation()} onClick={() => {setSelectedBuilding(a.code);setSelectedZone(null)}}>✚{a.count > 1 && <small>{a.count}</small>}</button>)}
              {networkView === "after" && placementMode !== "same_count" && placementMode !== "cost" && clusteredAeds.map(a => <button key={a.code} className={`aed-marker existing-after ${selectedBuilding === a.code ? "in-selected-building" : ""} ${selectedNearest?.kind === "current" && selectedNearest.code === a.code ? "nearest-target" : ""}`} style={{...geoPosition(a.code,a.x,a.y), transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={`Retained current AED · ${a.code}`} onPointerDown={e => e.stopPropagation()} onClick={() => {setSelectedBuilding(a.code);setSelectedZone(null)}}>✚{a.count > 1 && <small>{a.count}</small>}</button>)}
              {networkView === "after" && placementMode === "cost" && proposedSites.filter(site=>site.kind==="current").map(site=><button key={site.id} className="aed-marker existing-after" style={{...geoPosition(site.code,site.x,site.y),transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={`Retained current AED · ${site.code} · Floor ${site.floor}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>setSelectedBuilding(site.code)}>✚</button>)}
              {placementMode !== "same_count" && data.hypothetical_aeds.filter(a=>a.inventory_scenario===effectiveHousingInventory).map(a=><button key={a.site_id} className={`hypothetical-marker ${selectedNearest?.kind==="hypothetical"&&selectedNearest.id===a.site_id?"nearest-target":""}`} style={{...geoPosition(a.building_code,a.campus_x_m,a.campus_y_m),transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={`Hypothetical only · ${a.building_name} · Floor ${a.floor}`} onPointerDown={event=>event.stopPropagation()} onClick={()=>{setSelectedBuilding(a.building_code);setSelectedZone(null)}}>?</button>)}
              {networkView === "after" && placementMode !== "current" && placementMode !== "cost" && activeSelection?.sites.map((site, index) => <button key={site.site_id} className={`${placementMode === "same_count" ? "optimized-marker" : "recommendation-marker"} ${selectedBuilding === site.building_code ? "in-selected-building" : ""} ${selectedNearest?.kind === "optimized" && selectedNearest.id === site.site_id ? "nearest-target" : ""}`} style={{...geoPosition(site.building_code,site.x,site.y), transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={`${placementMode === "same_count" ? "Optimized benchmark" : `Priority ${index+1}`} · ${site.building_name}`} onPointerDown={e => e.stopPropagation()} onClick={() => {setSelectedBuilding(site.building_code);setSelectedZone(null)}}>{placementMode === "same_count" ? "" : index+1}</button>)}
              {networkView === "after" && placementMode === "cost" && activeCostPlan?.actions.filter(a=>a.action!=="remove_for_relocation").map((action,index)=><button key={action.site_id} className={action.action==="buy_new"?"recommendation-marker":"relocation-marker"} style={{...geoPosition(action.building_code,action.x,action.y),transform:`translate(-50%,-50%) scale(${1/zoom})`}} title={`${action.action==="buy_new"?"Buy new":"Relocate here"} · ${action.building_name} · $${action.cost_usd.toLocaleString()}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>setSelectedBuilding(action.building_code)}>{action.action==="buy_new"?index+1:"↗"}</button>)}
              {selectedZoneRecord && selectedNearest && <div className={`nearest-aed-pin ${selectedNearest.kind}`} style={{...geoPosition(selectedNearest.code,selectedNearest.x,selectedNearest.y),transform:`translate(-50%,-50%) scale(${1/zoom})`}}>✚</div>}
              {selectedZoneRecord && selectedNearest && <div className="nearest-aed-label" style={{...geoPosition(selectedNearest.code,selectedNearest.x,selectedNearest.y),transform:`translate(-50%,-50%) translateY(${-42/zoom}px) scale(${1/zoom})`}}><b>Nearest AED · {selectedNearest.code}</b><strong>Floor {selectedNearest.floor}</strong><span>{data.buildings.find(building => building.building_code === selectedNearest.code)?.building_name ?? selectedNearest.code}</span></div>}
              {connection && <svg className="nearest-connection" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={parseFloat(connection.from.left)} y1={parseFloat(connection.from.top)} x2={parseFloat(connection.to.left)} y2={parseFloat(connection.to.top)}/><circle cx={parseFloat(connection.from.left)} cy={parseFloat(connection.from.top)} r=".8"/><circle cx={parseFloat(connection.to.left)} cy={parseFloat(connection.to.top)} r=".8"/></svg>}
              </div>
              <div className="map-zoom"><button onClick={() => zoomBy(1.3)} aria-label="Zoom in">+</button><button onClick={() => zoomBy(1/1.3)} aria-label="Zoom out">−</button><button onClick={resetMap} aria-label="Reset map">⌂</button><span>{Math.round(zoom * 100)}%</span></div>
              <div className="map-compass">N<span>↑</span></div>
              <div className="map-legend"><span><i className="legend-aed">✚</i> Current AED</span>{networkView === "after" && (placementMode === "add"||placementMode==="cost") && <span><i className="legend-rec">1</i> New AED</span>}{networkView==="after"&&placementMode==="cost"&&<span><i className="legend-relocate">↗</i> Relocated AED</span>}{networkView === "after" && placementMode === "same_count" && <span><i className="legend-opt"/> Optimized site</span>}<span><i className="legend-outdoor"/> Outdoor demand</span><span className="scale-legend"><i className="legend-heat"/><em>Low</em><b>{layer === "demand" ? "People present" : "Time to AED"}</b><em>High</em></span></div>
              <div className="zone-zoom-hint">{selectedBuilding ? `${selectedBuilding} · Floor ${selectedFloor ?? "—"} · ${selectedZoneRecord?.zone_type.replaceAll("_"," ") ?? "choose a zone"}` : "Select a building to inspect it"}</div>
              {selectedBuilding && <button className="exit-building" onClick={resetMap}><span>×</span> Exit {selectedBuilding}<small>Esc</small></button>}
            </div>
          </article>

          <aside className="recommendation-card">
            {selected && <section className="side-inspector">
              <div className="inspector-heading"><div><span className="kicker">Focused building</span><h2>{selected.building_code} · {selected.building_name}</h2></div><button onClick={resetMap} aria-label="Close building details">×</button></div>
              <div className="inspector-select-grid"><label><span>Floor</span><select value={selectedFloor ?? ""} onChange={event => {const floor=Number(event.target.value);setSelectedFloor(floor);setSelectedZone(selectedZones.find(zone => Number(zone.floor) === floor)?.zone_id ?? null)}}>{buildingFloors.map(floor => <option key={floor} value={floor}>Floor {floor} · {selectedZones.filter(zone => Number(zone.floor) === floor).length} zones</option>)}</select></label><label><span>Zone</span><select value={selectedZone ?? ""} onChange={event => setSelectedZone(event.target.value)}>{floorZones.map((zone,index) => <option key={zone.zone_id} value={zone.zone_id}>Zone {index+1} · {zone.zone_type.replaceAll("_"," ")}</option>)}</select></label></div>
              <div className="zone-result">
                <div><span>Nearest AED</span><strong>{selectedNearest ? `${selectedNearest.code} · Floor ${selectedNearest.floor}` : "—"}</strong></div>
                <div><span>Estimated retrieval</span><strong>{selectedAvgRetrieval.toFixed(1)} min</strong></div>
                <div><span>Fastest route</span><strong>{selectedRouteLabel}</strong></div>
                <div className={`risk-result ${selectedRisk.className}`}><span>Access risk</span><strong>{selectedRisk.label}</strong><small>{selectedRisk.meaning}</small></div>
              </div>
              <p className="risk-definition">Access risk uses estimated AED retrieval time only. It is not a medical-risk or survival prediction.</p>
            </section>}
            <div className="plan-content"><div className="card-heading"><div><span className="kicker">{placementMode === "cost"?"Dollar-budget optimum":placementMode === "same_count" ? "Greedy benchmark" : placementMode === "current" ? "Existing network" : "Global optimum"}</span><h2>{placementMode === "cost"?`Best verified plan within $${costBudget.toLocaleString()}`:placementMode === "same_count" ? "Same budget, redesigned" : placementMode === "current" ? "What UTD has now" : `${budget} recommended ${budget === 1 ? "location" : "locations"}`}</h2></div>{placementMode === "add" && <span className="optimal-badge">Proven optimal</span>}{placementMode==="cost"&&<span className="optimal-badge">{activeCostPlan?.budget_usd===costBudget?"Exact budget":"Verified lower plan"}</span>}</div>
            <p className="recommendation-context">Simulated occupancy · {scenarios.find(s => s[0] === scenario)?.[1]} · {effectiveHousingInventory==="confirmed_only"?"50-device pilot inventory assumed complete, operational, and 24/7":`${hypotheticalCount} hypothetical housing AED sensitivity`} · {placementMode==="cost"?"simulated costs":"one new AED per building"}</p>
            {placementMode === "current" ? <div className="mode-explanation"><strong>Start here.</strong><p>The black-and-green crosses show the 50 AED records confirmed from the public UTD map. Switch to “Add AEDs” to see practical improvements.</p></div> : placementMode === "same_count" ? <div className="mode-explanation"><strong>50-site redesign benchmark</strong><p>Illustrative relocation cost: <b>${sameCountIllustrativeCost.toLocaleString()}</b> minimum using {data.meta.aeds} × ${data.cost_assumptions.relocation_base_total_usd.toLocaleString()} simulated base relocation cost. This assumes every device moves and excludes site multipliers.</p></div> : placementMode==="cost" ? <div className="cost-plan"><div className="cost-warning"><strong>CHANGES IN THIS PLAN</strong><span>{activeCostPlan?.relocations??0} existing AEDs move, {activeCostPlan?.new_aeds??0} new AEDs are purchased, and all other AEDs remain.</span></div>{activeCostPlan?.budget_usd!==costBudget&&<p className="budget-library-note">Your amount is ${costBudget.toLocaleString()}. The closest fully verified plan was computed at ${activeCostPlan?.budget_usd.toLocaleString()}; the remaining money stays unused.</p>}<dl><div><dt>Spent</dt><dd>${activeCostPlan?.total_cost_usd.toLocaleString()}</dd></div><div><dt>Unused</dt><dd>${Math.max(0,costBudget-(activeCostPlan?.total_cost_usd??0)).toLocaleString()}</dd></div><div><dt>Efficiency gain</dt><dd>+{activeCostPlan?.improvement_pct.toFixed(1)}%</dd></div><div><dt>Actions</dt><dd>{(activeCostPlan?.new_aeds??0)+(activeCostPlan?.relocations??0)}</dd></div></dl>{bestValuePlan&&<div className="best-value-plan"><span>Best efficiency gain per dollar</span><strong>${bestValuePlan.total_cost_usd.toLocaleString()} plan</strong><small>+{bestValuePlan.improvement_pct.toFixed(1)}% modeled gain · {(bestValuePlan.improvement_pct/bestValuePlan.total_cost_usd*1000).toFixed(2)} points per $1,000</small><button onClick={()=>setCostBudget(bestValuePlan.budget_usd)}>Use this budget</button></div>}<ol className="site-list">{activeCostPlan?.actions.filter(a=>a.action!=="remove_for_relocation").map(action=><li key={action.site_id}><button onClick={()=>{setSelectedBuilding(action.building_code);setActivePage("map")}}><span className="site-rank">{action.action==="buy_new"?"+":"↗"}</span><div><strong>{action.action==="buy_new"?"Buy":"Relocate"} · {action.building_name}</strong><small>{action.action==="relocate_to"&&action.relocated_from_site_id?`From ${action.relocated_from_site_id.replace("CURRENT-","").replace(/-F(\d+)/," · floor $1")} → `:""}{action.building_code} · Floor {action.floor} · ${action.cost_usd.toLocaleString()}</small><em>Show change on map →</em></div></button></li>)}</ol><p className="candidate-note">The stored plan is exact inside the declared 15-site eligibility shortlist at its verified budget. Relocated AEDs are removed from their old sites, and at least one confirmed AED remains at every currently covered building-floor group.</p></div> : <ol className="site-list">
              {activeSelection?.sites.map((site,index) => <li key={site.site_id}><button onClick={() => setSelectedBuilding(site.building_code)}><span className="site-rank">{index+1}</span><div><strong>{site.building_name}</strong><small>{site.building_code} · Floor {site.floor} common area</small><em>Show on map →</em></div></button></li>)}
            </ol>}
              <section className="side-assumptions"><small>Active assumptions</small><div className="assumption-buttons"><button className={assumptionPreset === "fast" ? "selected" : ""} onClick={() => setAssumptionPreset("fast")}>Fast</button><button className={assumptionPreset === "base" ? "selected" : ""} onClick={() => setAssumptionPreset("base")}>Base</button><button className={assumptionPreset === "conservative" ? "selected" : ""} onClick={() => setAssumptionPreset("conservative")}>Conservative</button></div><dl><div><dt>Runner speed</dt><dd>{assumptions.speed}</dd></div><div><dt>Mapped-route buffer</dt><dd>+{assumptions.detour}</dd></div><div><dt>Floor travel</dt><dd>{assumptions.floor}</dd></div><div><dt>Cabinet delay</dt><dd>{assumptions.cabinet}</dd></div></dl><p>Each estimate uses the fastest valid same-building, mapped ground, or multi-floor skybridge route. The route network contains {data.route_audit.active_skybridges} resolved skybridge connections. {data.route_audit.fallback_pairs.toLocaleString()} of {data.route_audit.current_zone_aed_pairs.toLocaleString()} current zone–AED pairs ({(data.route_audit.fallback_fraction*100).toFixed(1)}%) require the flagged 1.45× disconnected-ground fallback. The conservative preset adds 15% for missing entrance detail.</p></section></div>
          </aside>
        </section>}

        <details className="keep-in-mind"><summary>Keep in mind</summary><div><p>This is a simulated placement-efficiency comparison, not a medical risk prediction, safety grade, or deployment order.</p><p>Real recommendations remain blocked until UTD verifies inventory, availability, demand, routes, access, costs, and privacy approval.</p><p>{data.route_audit.fallback_pairs.toLocaleString()} of {data.route_audit.current_zone_aed_pairs.toLocaleString()} current route pairs use the flagged disconnected-network fallback.</p></div></details>
        <footer><span>Simulation demonstration · Building geometry: official UTD sources</span><span>{data.meta.buildings} buildings · {data.meta.zones} demand zones · {data.meta.candidates} candidate sites</span></footer>
      </section>
    </main>
  );
}
