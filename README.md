# AED Placement Dashboard

An interactive dashboard for exploring AED (automated external defibrillator) placement scenarios on a college campus — built so the underlying optimization analysis is something you can click through and compare live, not something stuck in a notebook.

## Scope

Piloted on the UT Dallas campus:

- **50** public AED records mapped
- **149** buildings mapped
- **862** indoor + outdoor zones
- **12** resolved skybridge connections
- **5** occupancy scenarios (e.g., day / evening / overnight / event conditions)

## Method summary

Placement is fundamentally a combinatorial search problem: choosing which subset of candidate sites to place AEDs at, out of a very large number of possible combinations, is not something you can just brute-force check exhaustively once the candidate pool gets large — the number of possible site combinations grows astronomically with candidate count.

Two approaches were compared:

- **Full-detailed (brute-force-style) evaluation** — every candidate is fully, expensively evaluated. Treated as the ceiling/benchmark for placement quality, not something scalable to run routinely at full candidate volume.
- **Sequential ML screening** — a lightweight model predicts each candidate's marginal gain using ~51 cheap features, keeps only the top 20% of candidates, and only *those* get the expensive full evaluation before a final pick is made. This retained about 99.12% of the full-detailed method's total improvement while fully evaluating only a fifth of the candidates — clearly ahead of simpler baselines tested the same way (a random baseline retained ~93.44%, a simple cheap-rule baseline ~84.94%).
- **Scenario-weighted placement** — rather than optimizing for a single fixed demand snapshot, the objective maximizes total improvement in *occupancy-weighted* access, evaluated across the 5 occupancy scenarios rather than one static picture of the campus — so a placement has to hold up reasonably well across different times/conditions, not just one.

## Outcome

Two different kinds of results came out of this, and they shouldn't be read the same way:

- **Method-comparison outcome (a real, valid finding):** the sequential ML screening approach retained ~99.12% of full-detailed placement quality while checking only the top 20% of candidates — a genuine efficiency result about the *screening method itself*, independent of whether the underlying demand data is real.
- **Simulated-scenario outcome (an estimate under modeled conditions, not a measured result):** in the example pilot run shown in the dashboard, the recommended placement estimated coverage for 28,683 people, an estimated ~81% coverage figure, and an average retrieval time around 3.5 minutes. These numbers come from simulated occupancy and route-estimate data, not measured real-world incidents or real recorded response times — they describe what the model estimates *given the simulated scenario*, not a validated real-world outcome.

## Dashboard features

- Choose an occupancy scenario and see the network recompute
- Inspect the campus and individual zones
- Compare a placement before/after a proposed change
- Enter a budget and see the recommended network update live
- Live summary metrics: cost used, estimated people covered, estimated coverage percentage, and average retrieval time

## Possible next version

None of the below is built yet — these are proposed directions, not existing features:

- Swap simulated occupancy/demand for real recorded incident data where and when it becomes available, so estimates reflect measured conditions rather than a modeled scenario
- Confidence intervals or uncertainty ranges on coverage/retrieval estimates, instead of single point numbers
- Support for comparing multiple campuses/institutions side by side
- A mobile-friendly view for walking a real building during a site visit
- Exportable summary reports (PDF/CSV) for sharing a specific placement plan with a decision-maker

## Limitations

- All occupancy, demand, and incident data used in this pilot is simulated, built specifically to test and validate the method — it is not real recorded cardiac-arrest incident data or measured foot-traffic data.
- Retrieval-time and route calculations rely on assumed responder speed and fixed per-floor/skybridge delay constants, not measured real-world timing.
- "People covered" and coverage-percentage figures are model estimates under a simulated scenario, not validated real-world outcomes, and should not be read as a measured impact claim.
- This is a single-institution pilot (UT Dallas); it has not been tested for how well the method or its assumptions generalize to other campuses or building types.
- No real-world deployment or field validation has occurred — this is a research/methodology pilot, not a decision-support tool currently in production use anywhere.
- 
