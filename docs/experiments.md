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

- **The picked car reached 20 of 20 at 50% of the budget in every seed and stayed there**, apart from one 19 at 90%. The last half of the budget bought no extra finishes on these tracks.
- **This test was too easy to settle the budget.** It counts finished tracks on plain unseen tracks and is capped at 20. The Grand Prix check below used the real race-day scoring and told a different story.
- Early on the picks were shaky (8 of 20 at 10% for one seed, and a dip at 40%), so a much smaller budget would bring the training luck back.
- **The pick helped on fresh seeds.** The picked car matched or beat the practice-best car at every checkpoint, and by a wide margin before 50%. This is not the same comparison as the earlier test, but it points the same way.
- Three seeds only. Treat this as a direction.

## 5 Nov 2026: does a smaller budget cost Grand Prix medals?

`scripts/budgetMedals.ts`, default build, the same seeds (11, 12, 13). At 40%, 50%, 60%, 80% and 100% of the budget, the car the app would pick was raced on the 8 Grand Prix tracks with the real race-day scoring from `src/race.ts` (tracks finished, then total time; gold was all 8 in under 200 s at the time, see the calibration below).

| Budget used | Seed 11 | Seed 12 | Seed 13 | Gold |
|---|---|---|---|---|
| 40% | 8/8, 163 s, gold | 7/8, bronze | 8/8, 175 s, gold | 2 of 3 |
| 50% | 6/8, bronze | 5/8, none | 7/8, bronze | 0 of 3 |
| 60% | 7/8, bronze | 5/8, none | 7/8, bronze | 0 of 3 |
| 80% | 8/8, 148 s, gold | 8/8, 154 s, gold | 8/8, 150 s, gold | 3 of 3 |
| 100% | 8/8, 148 s, gold | 8/8, 149 s, gold | 8/8, 150 s, gold | 3 of 3 |

- **At 50% and 60% of the budget no seed finished all 8 tracks, and none won gold**, although the same cars finished 20 of 20 plain unseen tracks in the test above. The Grand Prix tracks (hairpins, block fields and a wild one) are harder, and the cars are not reliable on them until later.
- **80% matched 100% on every seed**: all gold, within a few seconds of each other.
- **40% did better than 50% and 60%** (2 gold), which does not fit a smooth curve. With three seeds, treat it as luck, and as a sign that a single run at a given budget can fool you.
- **Verdict: do not cut the budget to 60%.** 80% looks safe but saves only about a fifth of the training time (roughly 20 seconds), and it rests on three seeds, so the budget stays at 30M steps for now.
- Picking a car at each checkpoint uses the run's own track randomness, so the 100% row differs slightly from an unchecked run. The effect is small and the same at every budget.

## 5 Nov 2026: is the gold time fair across builds?

`scripts/medalCalibration.ts`. 16 trainings with the app's exact flow (the full 30M budget, then the final pick), each car raced on the 8 Grand Prix tracks. Builds: default (seeds 21 to 24), and on seeds 21 to 23 each: wide vision (9 rays, 180°), six practice tracks, fast car with a crash penalty, and a careful style (crash penalty and smoothness).

| Build | Result per seed | Gold at 200 s |
|---|---|---|
| Default | 148 s, 148 s, 147 s, 151 s | 4 of 4 |
| Wide vision | 143 s, 7/8, 156 s | 2 of 3 |
| Six practice tracks | 7/8, 2/8, 154 s | 1 of 3 |
| Fast car | 7/8, 6/8, 6/8 | 0 of 3 |
| Careful style | 149 s, 149 s, 7/8 | 2 of 3 |

- **9 of 16 cars finished all 8 tracks, and every one of them took 143 to 156 s.** At the 200 s line all 9 won gold and none won silver, so gold currently just means "finish all 8".
- **Finishing times barely differ between cars.** They drive near top speed, so total time follows track length. The cars built for speed (the fast car) crashed instead: none of its 3 finished all 8.
- **Share of all cars that would win gold:** 0% at 140 s or less, 38% at 150 s, 56% at 160 s and above.
- **A 150 s line** would give 38% gold, 19% silver, 38% bronze and 6% no medal. But with a 13 s spread it would split cars that are within noise of each other (the default runs at 147, 148 and 148 s would win gold, the one at 151 s silver).
- The 4 Nov line (200 s, from times of 183 to 312 s) predates the mirrored-track pick and was out of date.
- **Decision (5 Nov 2026): `GOLD_TIME` is now 149 s**, set before any playtest. On these 16 cars it gives 4 gold, 5 silver, 6 bronze and 1 with no medal. The line at 150 s would give 6 gold, and at 148 s only 2. The default build's four times were 146.9, 148.2, 148.3 and 150.6 s, so three of them win gold and one gets silver. Revisit after the playtest, once real players have raced.
- More practice tracks and wider vision are not safe upgrades: six tracks finished all 8 on 1 of 3 seeds and wide vision on 2 of 3, against 4 of 4 for the default. Three seeds is a small sample.
