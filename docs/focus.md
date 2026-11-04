# CrashLab: race team

Written 4 Nov 2026. This replaces every earlier plan, and it wins over the roadmap. Teaching is gone. The physics, tracks, evolution and training worker stay. The whole front end is rebuilt.

## The game

You run a race team. You set up a car, train its brain on a fixed budget, then send it to race on secret tracks. Nobody touches a weight or sees any maths. You win by making good engineering choices.

**Loop:** Garage → Practice (training) → Race → Results and ghost replay → back to the Garage.

## Look

A racing game HUD: dark, bold and fast. Big lap timers, sector splits, telemetry bars and a timing tower. The car and track art stays top-down and 2D. Tracks are about 2400×1500, several screens big, with laps of roughly 5 km. The camera stays north-up and scrolls to follow the car, a little ahead of it, and a minimap shows the whole track. While training, it follows the lead car.

## The garage (the build)

1. **Sensor package.** The number, angle and range of the rays. More vision means a bigger brain, which needs more of the budget to train.
2. **Car setup.** Top speed against grip and acceleration. A fast car is harder to keep on the road.
3. **Driving style.** Reward sliders for raw pace, staying alive and smooth lines. Training optimises whatever you choose.
4. **Practice tracks.** Pick which tracks to train on, each tagged with what it has (hairpins, blocks, narrow sections). Choose them to get ready for unknown race tracks.


## Training

- **Fixed budget.** Everyone gets the same number of "garage hours", measured in car-laps simulated rather than seconds, so a faster laptop gives no advantage. More practice tracks use the budget faster, and a bigger brain (from more rays) has more weights to find, so it needs more generations to learn.
- You can watch the generations, or skip to the end.

## Racing

- **Weekly Grand Prix.** A new set of secret tracks each week, with one leaderboard per race and championship points across a season.
- **Always-on leaderboard.** A permanent hidden-track ranking you can enter at any time.
- **Score:** tracks finished first, then total time.
- **Ghost replays.** Watch your car against the leader's on the same track, with the time gap shown at each sector.
- **Trust:** the simulation is deterministic. A server re-runs each submitted car on secret tracks, and the tracks never reach the browser.

## Build order

- [x] **R1. Engine changes.** The sensor setup, car setup and reward weights become parameters, with a variable brain size. Car files store their full setup. The budget is counted in simulated driving steps. Code: `setup.ts`, `sim.ts`, `evolve.ts`, `trainWorker.ts`, `carFile.ts`, and `scripts/check.ts` for a headless check.
- [ ] **R2. New front end: Garage and Practice.** HUD look, garage screens and training on a budget.
- [ ] **R3. Local race day.** Sample race tracks, a results screen, a timing tower and ghost replays against your own best car.
- [ ] **R4. Server.** Car upload, secret-track re-scoring, the always-on leaderboard and leader ghosts.
- [ ] **R5. Weekly Grand Prix.** Rotating track sets, a leaderboard for each race, season points.

## Alongside

- Balance runs (does each setup choice really matter?) go one batch at a time, at low priority, with rests between runs.
