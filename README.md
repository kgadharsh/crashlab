# CrashLab

You build a car's brain, train it, and race it on tracks you haven't seen.

Play it here: https://kgadharsh.github.io/crashlab/

It runs in the browser on a laptop or a phone. There's no server. Your car and your results stay in your own browser.

## How a game goes

**Garage.** Pick how the car sees: how many rays, and how wide they spread. Pick its balance between top speed and grip, what it gets rewarded for, which practice tracks it learns on, and whether those tracks are dry or wet.

**Practice.** The car trains on a fixed budget. A hundred cars drive the practice tracks, the best ones breed, and it repeats. That takes about a minute on a laptop and about two on a phone. You can watch every tenth generation, and "Keep training" carries on from the car you already have.

**Race.** The car drives eight secret tracks. There are two Grand Prix, a dry one and a wet one with less grip. Finish all eight, and fast, for a medal. Your best result is saved for each.

**Challenge a friend.** "Copy challenge link" puts your car in a link. Whoever opens it races your car on the same tracks and sees who's faster.

Every garage choice costs something. More rays see more, but need more of the budget to train. A fast car is harder to keep on the road. More practice tracks prepare the car better for new ones, but each generation then takes longer.

## Running it yourself

You need Node.js.

```bash
npm install
npm run dev
```

```bash
npm run build              # check types and build the site into dist/
npm run check              # check types for the app and the scripts
npx tsx scripts/bench.ts   # time a training run and print a fingerprint of its result
```

The simulation is deterministic. If a change shouldn't alter how a car drives, the fingerprint from `bench.ts` stays the same, which is how I check speed-ups. Pushing to `main` rebuilds and publishes the site (`.github/workflows/pages.yml`).

## Where things are

- `src/sim.ts`, `src/sensors.ts`, `src/track.ts`: the car, its rays and the tracks
- `src/evolve.ts`, `src/genome.ts`, `src/training.ts`, `src/trainWorker.ts`: training, which runs in a web worker
- `src/setup.ts`: the garage choices and the training budget
- `src/race.ts`, `src/raceView.ts`, `src/challenge.ts`: the Grand Prix, medals and challenge links
- `src/main.ts`, `src/draw.ts`, `src/style.css`: the screens
- `scripts/`: experiments that train real cars and measure the result
- `docs/focus.md`: the plan and why the design is what it is
- `docs/experiments.md`: what was measured and what it decided
- `docs/playtest.md`: the observer sheet for playtests
