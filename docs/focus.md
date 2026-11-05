# CrashLab: race team

Written 4 Nov 2026. This replaces every earlier plan, and it wins over the roadmap. Teaching is gone. The physics, tracks, evolution and training worker stay. The whole front end is rebuilt.

## The game

You run a race team. You set up a car, train its brain on a fixed budget, then send it to race on secret tracks. Nobody touches a weight or sees any maths. You win by making good engineering choices.

**Loop:** Garage → Practice (training) → Race → Results and ghost replay → back to the Garage.

## Look

A racing game HUD: dark, bold and fast. Big lap timers, sector splits, telemetry bars and a timing tower. The car and track art stays top-down and 2D. Tracks are about 2400×1500, several screens big, with laps of roughly 5 km. The camera stays north-up and scrolls to follow the car, a little ahead of it, and a minimap shows the whole track. While training, it follows the lead car.

## The garage (the build)

1. **Sensor package.** The number of rays and how wide they spread. More rays mean a bigger brain, which needs more of the budget to train. Ray range is fixed: a longer ray cost nothing, so it was not a real choice.
2. **Car setup.** Top speed against grip and acceleration. A fast car is harder to keep on the road.
3. **Driving style.** Reward sliders for raw pace, staying alive and smooth lines. Training optimises whatever you choose.
4. **Practice tracks.** Pick 1 to 6 of 8 tracks, each with its own character (tight bends, long straights, wide sweepers, lots of blocks), tagged with features measured from the track. Choose them to get ready for unknown race tracks.
5. **Road.** Dry or wet. Wet practice tracks lower the car's grip speed to 75%, so the tyres lose turning power sooner. Grand Prix 2 is wet, and a car practised only on dry roads finishes few of its tracks (see `docs/experiments.md`).


## Training

- **Fixed budget.** Everyone gets the same number of "garage hours", measured in car-laps simulated rather than seconds, so a faster laptop gives no advantage. More practice tracks use the budget faster, and a bigger brain (from more rays) has more weights to find, so it needs more generations to learn.
- Training always runs at full speed, about a minute or two on a laptop. You can watch every 10th generation replayed, each for about 10 seconds and following that generation's best car, or skip to the end. The graph and counters update every generation. On touch screens the replay shows only the best car by default (a hundred cars is heavy to draw on a phone), a tip changes every few seconds, and the Garage and Race tabs keep working while a run goes on.
- **Picking the car.** At the end, the best 20 cars drive mirrored and backwards versions of the practice tracks, and the best of them becomes your car. This cut the luck in training a lot (see `docs/experiments.md`).
- **Keep training.** Carries on from your current car with 30% of the budget, about a third of the time, so you can add practice tracks or change your style without starting over. It needs the same number of rays. Every run remembers the car it replaced, and "Switch to previous car" swaps them back. Tested on 4 seeds in `docs/experiments.md`.

## Racing

- **Weekly Grand Prix.** A new set of secret tracks each week, with one leaderboard per race and championship points across a season.
- **Always-on leaderboard.** A permanent hidden-track ranking you can enter at any time.
- **Score:** tracks finished first, then total time.
- **Ghost replays.** Watch your car against the leader's on the same track, with the time gap shown at each sector.
- **Two Grand Prix (built).** Grand Prix 1 is the eight tracks on a dry road, Grand Prix 2 the same tracks on a wet road. Each has its own medals and personal best, so one car cannot be best at both: a car practised dry wins the dry one in about 148 s, and a car practised wet does far better in the wet but is about 15 s slower on dry roads. Training on both at once was worse than either, so it is not offered. Gold is under 149 s dry and under 190 s wet.
- **Challenge links (built, no server).** "Copy challenge link" puts your car in a web address (`src/challenge.ts`). A friend who opens it sees how that car does on the Grand Prix and can race their own car against it. The car is checked like any car file, and its result is worked out again on the friend's own device, so both cars run on the same engine.
- **Trust:** the simulation is deterministic. A server re-runs each submitted car on secret tracks, and the tracks never reach the browser.

## Build order

- [x] **R1. Engine changes.** The sensor setup, car setup and reward weights become parameters, with a variable brain size. Car files store their full setup. The budget is counted in simulated driving steps. Code: `setup.ts`, `sim.ts`, `evolve.ts`, `trainWorker.ts`, `carFile.ts`, and `scripts/check.ts` for a headless check.
- [x] **R2. New front end: Garage and Practice.** HUD look, garage screens and training on a budget.
- [x] **R3. Local race day.** Grand Prix 1: 8 secret tracks, one in the style of each practice track plus a wild one (`src/race.ts`, `src/raceView.ts`). A replay with a timing tower, then a medal, a personal best and one piece of advice based on why the car failed. Gold: all 8 in under 149 s (set on 5 Nov 2026, see `docs/experiments.md`). Silver: all 8. Bronze: 6 or more. Ghost replays wait for R4.
- [ ] **R4. Server.** Car upload, secret-track re-scoring, the always-on leaderboard and leader ghosts.
- [ ] **R5. Weekly Grand Prix.** Rotating track sets, a leaderboard for each race, season points.

## Alongside

- Balance runs (does each setup choice really matter?) go one batch at a time, at low priority, with rests between runs.
