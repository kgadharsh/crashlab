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
- More practice tracks and wider vision are not safe upgrades (but see the next section): six tracks finished all 8 on 1 of 3 seeds and wide vision on 2 of 3, against 4 of 4 for the default. Three seeds is a small sample.

## 5 Nov 2026: does carrying on from a trained car help?

`scripts/keepTraining.ts`, default build, seeds 21 to 24. Each car A is trained normally. Training then carries on from A with 30% of the budget (`KEEP_TRAINING_SHARE`), once on the same four tracks and once on six (adding two). The final pick includes A itself. All cars were raced on the Grand Prix.

| Seed | Car A | Carried on, same 4 tracks | Carried on, 6 tracks | Six-track car from scratch |
|---|---|---|---|---|
| 21 | 8/8, 148.2 s | **7/8** | 8/8, 148.6 s | 7/8 |
| 22 | 8/8, 148.3 s | 8/8, 147.4 s | 8/8, 147.3 s | 2/8 |
| 23 | 8/8, 146.9 s | 8/8, 146.9 s | 8/8, 146.3 s | 8/8, 154.0 s |
| 24 | 8/8, 150.6 s | 8/8, 148.3 s | 8/8, 148.8 s | not run |

- **Adding tracks by carrying on never lost a track.** It beat car A on 3 of 4 seeds, by 0.6 to 1.8 s, and was 0.4 s slower on the fourth. On seed 24 it turned a silver (150.6 s) into a gold at the 149 s line.
- **Starting a six-track car from scratch was much worse** (7/8, 2/8, then 8/8 in 154 s), and it takes the whole budget. Carrying on took about 9 to 16 generations.
- **Carrying on over the same four tracks is riskier.** It beat car A on 2 of 4, tied on 1 (A was picked again), and lost a track on 1. The final pick only sees practice tracks and their mirrored versions, so it can choose a car that is worse on the Grand Prix.
- Four seeds, default build only. Treat it as a direction.

Built from this: the **Keep training** button (30% of the budget, needs the same number of rays) and **Switch to previous car**, because every run remembers the car it replaced and a worse result can be undone.

## 5 Nov 2026: is wet weather a real decision?

`scripts/wetPilot.ts` and `scripts/wetCheck.ts`. A wet road multiplies the car's grip speed by 0.75 (`WET_GRIP` in `src/track.ts`), so the tyres lose turning power at lower speeds. Dry roads are unchanged: the benchmark fingerprints are identical.

**Pilot (one car trained dry, seed 21, raced on the Grand Prix at different grip):** 8/8 at grip ×1 (148.2 s), 6/8 at ×0.9, 3/8 at ×0.8 and ×0.75, 2/8 at ×0.7, 1/8 at ×0.6, 0/8 at ×0.5. The failures are tight bends and block fields.

**Main test (default build, seeds 21 to 23, full budget):** the car was trained practising on dry roads, on wet roads, and on both (two tracks per generation, so fewer generations), then raced on a dry and on a wet Grand Prix.

| Practised on | Generations | Dry Grand Prix | Wet Grand Prix (finished) |
|---|---|---|---|
| Dry | 94 | 8/8 on all 3, at 147 to 148 s | 3, 2, 5 (mean 3.3) |
| Wet | 102 | 8/8 on all 3, at 161 to 166 s | 6, 7, 8 (mean 7.0) |
| Both | 68 | 5, 8, 7 (mean 6.7) | 3, 5, 5 (mean 4.3) |

- **Wet practice more than doubles the wet result** (7.0 against 3.3 tracks finished) and a wet-trained car still finishes every dry track, only 13 to 19 s slower. So the road you practise on is a real decision.
- **"Both" is worse than either choice on both roads.** Two tracks per generation leaves only about 68 generations, so it is dropped as an option.
- Three seeds, default build only.

**Wet gold line (9 cars practised on wet roads, seeds 21 to 29, on the wet Grand Prix):** only 2 finished all 8 (183.7 s and 188.2 s), 4 got bronze (6 or 7 tracks), and 3 got nothing (5, 1 and 1 tracks; two of those were bad training runs). The wet Grand Prix is much harder than the dry one. `WET_GOLD_TIME` is 190 s: any line from 188 s up makes gold mean "finish all 8", and there are too few finishers to split them. Revisit after the playtest.

## 5 Nov 2026: can a network learn nitro?

`scripts/nitroCheck.ts`, default build with nitro (`perks: { nitro: true }`, off by default and not offered in the garage). The brain gets one more input (charge left) and one more output (boost). A lap has 240 steps of boost (4 s), which doubles acceleration and lifts top speed by 35%. Above the car's grip speed, turning weakens as it speeds up, so boosting in a bend is dangerous with no extra rule. Dry Grand Prix, seeds 21 to 23. The same seeds without nitro finished 8/8 in 148.2, 148.3 and 146.9 s. Cars without nitro are bit-identical to before (benchmark fingerprints unchanged).

| Seed | Generations | Grand Prix | Boost charge used per lap | Boost on straights (straights are 64% of the road) |
|---|---|---|---|---|
| 21 | 109 | 8/8, 148.0 s | 0% | none used |
| 22 | 113 | **7/8** | 92% | 77% |
| 23 | 123 | 8/8, 148.1 s | 0% | none used |

- **Two of three brains never touched the boost button**, so they drove like the no-nitro cars. Evolution did not find it in about 110 generations.
- **The one brain that did use it** spent 92% of the charge, 77% of it on straights (a little better than the 64% a random choice would give), but crashed on one track and finished 7/8.
- **Verdict: not worth building as it stands.** The brain does not reliably learn to use it in the fixed budget, and when it does the result is not clearly faster. Things to try if it is revisited: start the boost output slightly positive so cars discover it, reward finishing time more, or give nitro cars a bigger budget. Three seeds, default build only.

## 5 Nov 2026: does scoring cars on several threads change the cars, and how much faster is it?

`src/scorePool.ts`, `src/scoreWorker.ts` and `scripts/scorerCheck.ts`. A car is scored on its own, so each generation's 100 cars are shared out between this thread and up to 3 helper workers (the device's cores minus one, at most 4 threads), then put back in order and sorted as before. The threads were checked in the browser on an 8-core laptop, training the same seed with the thread count set by hand and comparing a fingerprint of the picked car and every generation's scores.

| Run | 1 thread | More threads | Same cars? |
|---|---|---|---|
| Default build, 4 practice tracks, 6M steps (dev build) | 16.1 s | 6.4 s (4 threads) | yes, identical fingerprint |
| 9 rays, 180°, wet road, 6 practice tracks, 3M steps | 12.1 s | 5.7 s (3 threads) | yes |
| Default build, 6M steps (production build) | 14.9 s | 5.4 s (4 threads) | yes, same fingerprint as the dev build |

- **Same cars, 2.1 to 2.8 times faster.** A whole run through the app (30M steps, 4 threads, replays on, production build) took 22.7 s to the end of training, against about 75 s on one thread.
- **One thread is untouched:** `scripts/bench.ts` gives the same fingerprints as before (`7d5eb8664a03` for default, `9c724097a6dd` for wide), and `scripts/scorerCheck.ts` shows the Scorer path matching the plain one.
- **If a helper fails**, the scorer falls back to one thread with the same result (tested with helpers given a broken build). A helper that does not answer for 30 s is dropped the same way.
- **Not measured:** phones. They report more cores than they have fast ones, and the page's own drawing competes for them, so the gain there may be smaller. One earlier full run through the app took about 70 s and did not repeat in three later runs; I could not tell why, so treat single timings as rough.

## 6 Nov 2026: par times for the track board

`scripts/boardCalibration.ts`, with the times in `src/board.ts`. Nine cars were each trained once with the app's exact flow (full budget, then the final pick) and then drove one lap of each of the 12 practice tracks on a dry road and on a wet one: default build on seeds 31 to 34, wide vision (9 rays, 180°), fast and cautious (all speed, crash penalty 0.8), six practice tracks, and the default build practised on wet roads on seeds 31 and 32.

- **Lap times barely differ between cars.** On the six easy tracks the median lap and the fastest are within 1 to 2% (Home Circuit: 14.9 to 15.7 s over seven cars), because every car drives near top speed. Only the twisty tracks (Hairpin Valley, Chicanes, Harbour Streets, Flowing Esses) spread out, from 18.7 to 28 s.
- **Many cars cannot finish some tracks.** Trained on four tracks, the default build finished 12, 12, 7 and 10 of the 12 dry tracks, so a first car often has a few "did not finish" laps. The twisty tracks are the ones that fail.
- **The gold rule:** 0.5% under the median lap of the seven dry-trained cars, one time per track (`PAR`). Silver is within 5% of the median (`SILVER_SLACK` 1.055 times gold), and bronze is finishing. On these cars that gives gold 25%, silver 57%, bronze 7% and no finish 11% of laps. Default builds mostly get silver, with a gold or two. The wide-vision car got gold on 11 of 12 tracks, the fast and cautious car mixed silver and bronze.
- **A cleaner rule was tried and dropped:** "within 1.5% of the best lap seen" made the wide-vision car gold everywhere by definition, because it set the bests.
- **Wet:** a wet lap took 10% longer than the same car's dry lap (median over 14 laps, range 7% to 51%), so `WET_FACTOR` is 1.1. The two wet-trained cars were slower than that on easy tracks (up to 23% over the dry gold time) and finished fewer of the twisty tracks than hoped, so they mostly get bronze and silver on a wet road.
- **Limits:** seven dry-trained cars and two wet ones, one seed each for most builds, so gold times may sit a little high or low. Gold on an easy track is a margin of about half a percent over a typical car, a few hundredths of a second, which a retrain can move either way. Star unlocks assume a first car earns 16 to 28 stars (12 silver laps is 24).
- Adding the four new practice tracks left the benchmark fingerprint (Grand Prix result included) unchanged, because the Grand Prix is built from the first eight practice styles only.
