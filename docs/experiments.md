# Experiments

Each result here was measured by a script in `scripts/`. Runs are small, so treat the numbers as a direction, not proof.

## 4 Nov 2026: does the build matter more than training luck?

`scripts/luckVsBuild.ts`. 4 builds × 3 training seeds, each trained on the full 30M-step budget, then raced on 20 tracks no build practised on. Run on the old set of 12 look-alike practice tracks.

| Build | Unseen tracks finished (of 20), seeds 1/2/3 | Mean |
|---|---|---|
| Default (5 rays, 120°) | 17, 6, 16 | 13.0 |
| Wide vision (9 rays, 180°, range 280) | 12, 10, 8 | 10.0 |
| Six practice tracks | 13, 18, 17 | 16.0 |
| Fast car + crash penalty | 4, 17, 18 | 13.0 |

- **Luck beat the build.** The spread between seeds of the same build (typical sd 3.8 tracks) was bigger than the spread between builds (sd 2.1).
- The driving-style sliders did not hurt: fast and cautious averaged the same as the default.
- More practice tracks looked best, but n = 3.

## 4 Nov 2026: where does the luck come from?

`scripts/luckDiagnose.ts`, default build, on the new set of 8 distinct practice tracks. For each training seed, the 20 finalists the car is picked from were raced on the same 20 unseen tracks.

- **Within one training run, the finalists finished anywhere from 2 to 20 of 20.** Every run produced excellent cars. The luck was in which one got picked, because practice scores barely predict new tracks.
- Judging on more block layouts of the same tracks helped little.
- **Judging the finalists on mirrored and backwards versions of the practice tracks** picked better cars:

| Seed | Practice tracks only | With mirrored and backwards versions | Best finalist |
|---|---|---|---|
| 1 | 16 | 16 | 19 |
| 2 | 16 | 18 | 20 |
| 3 | 14 | 19 | 20 |
| 4 | 16 | 18 | 20 |
| Total (of 80) | 62 | **71** | 79 |

Training now picks the car this way (`src/training.ts`). The same 4 seeds chose and tested the method, so it should be checked again on new seeds.
