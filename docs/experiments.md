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

## 5 Nov 2026: does the car stop improving before the budget runs out?

`scripts/budgetCurve.ts`, default build, three new seeds (11, 12, 13). At every 10% of the 30M-step budget, the car the app would pick if training ended there was raced on the same 20 unseen tracks as above. The practice-best car (the top of the population by practice score, with no extra judging) was raced too.

| Budget used | Generation (mean) | Picked car, seeds 11/12/13 | Picked mean | Practice-best mean |
|---|---|---|---|---|
| 10% | 27 | 18, 8, 19 | 15.0 | 11.3 |
| 20% | 41 | 18, 20, 18 | 18.7 | 13.3 |
| 30% | 50 | 20, 20, 16 | 18.7 | 15.3 |
| 40% | 59 | 15, 20, 16 | 17.0 | 14.0 |
| 50% | 68 | 20, 20, 20 | 20.0 | 16.0 |
| 60% | 75 | 20, 20, 20 | 20.0 | 20.0 |
| 70% | 83 | 20, 20, 20 | 20.0 | 18.7 |
| 80% | 90 | 20, 20, 20 | 20.0 | 18.3 |
| 90% | 97 | 20, 20, 19 | 19.7 | 17.7 |
| 100% | 104 | 20, 20, 20 | 20.0 | 19.7 |

- **The picked car reached 20 of 20 at 50% of the budget in every seed and stayed there**, apart from one 19 at 90%. The last half of the budget bought no extra finishes.
- **This test is capped at 20.** It counts finished tracks, not lap times, so it cannot show whether the later generations drive faster. Check race times, or the Grand Prix medals, before cutting the budget.
- Early on the picks were shaky (8 of 20 at 10% for one seed, and a dip at 40%), so a much smaller budget would bring the training luck back.
- **The pick helped on fresh seeds.** The picked car matched or beat the practice-best car at every checkpoint, and by a wide margin before 50%. This is not the same comparison as the earlier test, but it points the same way.
- Three seeds only. Treat this as a direction.
