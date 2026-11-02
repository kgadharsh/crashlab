# Roadmap: every known flaw, in the order we fix it

Started 2 Nov 2026 from a full review of the code, headless measurements and the running app.
Work top to bottom, one item at a time. Tick an item only when its "done when" is true.

Severity: **[S1]** blocks the teaching goal, **[S2]** a real bug or misleading result, **[S3]** rough edge, **[S4]** cleanup.

## Build plan: from prototypes to the real app

Decided 2 Nov 2026 after ten chat prototypes. This order replaces the phase order below wherever they differ. The F numbers stay as the record of each flaw. Prototypes were sketches: each one must be rebuilt on the real car physics, and any number it shows must be measured.

### The journey: four chapters in the top bar

| Chapter | Steps | The sentence a user can say back |
|---|---|---|
| 1. Inside | Drive, tug-of-war neuron, Read the brain | "A neuron weighs its inputs and decides." |
| 2. Wiring | Road detector, edit the network, Blind the rays | "Weights decide what it notices, and it only knows what it can sense." |
| 3. Learning | You are evolution, 100-car training, Downhill, Reward design | "Learning means finding weights, and the score decides what gets learned." |
| 4. Trust | Memorise vs learn, Hidden layers, Crash detective | "Passing the practice track proves little, and I can explain why it failed." |

### Build order

- [x] **B1. Tug-of-war and predicted path.** Replaces the neuron table. All six weights plus Reset. The path comes from a copy of the real car simulated ahead. Fixes the rest of F10.
- [x] **B2. Read the brain.** A few guessing rounds using real track positions. Also the start of the quiz in F15.
- [x] **B3. Edit the network directly.** Drag connections, click rays to blind them, cut connections, link rays on the track to inputs in the panel. Fixes F11, F13 and F14.
- [x] **B4. Road detector.** Hover a neuron and the real road lights up. Fixes F24, or record why it was dropped.
- [ ] **Checkpoint: test Chapters 1 and 2 with 3 to 5 non-ML friends (F15).** Results can reorder everything below. The guide and quiz are in `docs/friend-test.md`.
- [ ] **B5. You are evolution and Downhill.** Pick-a-parent before the 100-car run, then the slope lesson. Fixes F16.
- [ ] **B6. Memorise vs learn.** Real brains trained on one track and on five, across at least 10 seeds. Fixes F17 and supports F30.
- [ ] **B7. Hidden layers.** Fixes F21 and needs F22. Measure two hidden layers on the car (F23).
- [ ] **B8. Reward design.** Real training with fixed reward terms and never user code. Needs a fast small run. Fixes F27.
- [ ] **B9. Crash detective.** Starts as chosen crashes with known causes, then grows into automatic diagnosis (F26).

Bias is editable in the neuron list from B3, but nothing explains it yet.

## Phase 0: Quick fixes (one sitting)

- [ ] **F01 [S2] Deploy not confirmed.** The filename fix is pushed, but no Netlify build from GitHub has been seen working.
  Done when: the live link loads and training runs on it.
- [x] **F02 [S2] "It learned to drive" is shown to an untrained brain.** The hand-written starter scores 20 of 20 on the hidden test and `hiddenVerdict` praises it as learned.
  Done when: the verdict depends on where the brain came from, and never says "learned" for the starter.
- [x] **F03 [S2] "The brain (watching you)" is false.** In Mission 1 the panel shows the starter brain's own outputs, for example steer 1.00 while the car is parked.
  Done when: the panel shows what is really driving, or plainly says it is only suggesting.
- [x] **F04 [S2] Mission 2's "That was easy" is untrue.** Its old answer (3, 1.5, 0.8) now reaches 45% of a lap. Only 132 of 648 positive-steering settings lap, and the ones tried take 14.7 to 19.4 s.
  Done when: the wording is honest. The real fix is F13.
- [x] **F05 [S3] Developer text on screen.** `mode: live`, `recorded steps`, raw checkpoint counts and "R = replay" are all visible, and those keys do not exist on a phone.
  Done when: players see only what the current mission needs.
- [x] **F06 [S3] Wrong or missing identity.** The page title is "crashlab", the project has no chosen name, and there is no meta description.
  Done when: a name is chosen and used everywhere.
- [x] **F07 [S4] Dead files.** `src/counter.ts` and `src/style.css` are unused, along with the template assets. `compare*.ts` are experiments sitting in `src/`.
  Done when: unused files are removed and experiments live in `scripts/`.
- [x] **F08 [S4] Scripts are not type-checked.** `tsconfig.json` only includes `src`, so `scripts/` never goes through `tsc`.
  Done when: `npm run build` or a separate script checks them.

## Phase 1: Make the network touchable (the main work)

- [x] **F09 [S1] Nobody can interact with the network.** The panel is display-only.
  Done when: it has click targets, and pausing and stepping the car work.
- [x] **F10 [S1] The app never shows what a neuron computes.** Weighted sum, bias, tanh and "hidden" are never explained.
  Done when: a new "inside one neuron" mission walks through ray x weight, the sum, the squash and the output, and the player drags a real weight to change the decision. Bias is not shown yet, because this neuron's bias is 0.
- [x] **F11 [S1] No way to break things.** Blind-a-ray and cut-a-connection do not exist.
  Done when: both work live and visibly change the driving.
- [ ] **F12 [S2] Numbers do not match.** The yellow line says 106 while the network says 0.53, with no explanation.
  Done when: both use one scale, or the conversion is shown.
- [x] **F13 [S1] Mission 2 teaches car tuning, not weights.** Sliders name behaviours and are not linked to any connection, and the mission is badly tuned for grip.
  Done when: the player edits real connections, those connections light up, and a sensible attempt laps at a decent speed.
- [x] **F14 [S3] Connections are too small to tap on a phone.**
  Done when: tapping a neuron opens its connections as a list of sliders.

- [x] **F41 [S3] Text says "the network on the right", but on phones it is below the track.**
  Done when: mission text does not depend on the layout.

- [x] **F42 [S2] The page had no real layout.** Stacked boxes, a graph below the fold, a row of plain buttons and clashing panel colours.
  Done when: dark theme, three columns on desktop with no scrolling at 1280x720, one main action, and a working stacked phone layout.

### Checkpoint: test with people

- [ ] **F15 [S1] No real user has ever tried it, and the quiz does not exist.**
  Done when: the pre/post quiz is written (with one non-car transfer question), 3 to 5 non-ML friends have played, and raw results are recorded.
  **Their results can reorder everything below.**

## Phase 2: Make the lessons true

- [ ] **F16 [S1] Mission 3 misleads about learning.** It answers "how does a network find its own weights?" with evolution and never mentions gradient descent.
  Done when: the app says evolution is one method and most networks use gradient descent. The full fix is F21.
- [ ] **F17 [S1] The overfitting lesson has gone from the story.** Training on five tracks scores about 19 of 20, and the hidden test belongs to no mission.
  Done when: a mission trains on one track and then five, and runs the same hidden test. One-track brains scored 20, 14 and 9, so first measure this across at least 10 seeds and choose a setup that shows the lesson reliably.
- [ ] **F18 [S2] Learning does not look necessary.** The starter brain finishes 20 of 20, and evolution's only win is speed (5.9 s against 8.8 s).
  Done when: the story openly compares reliability and speed, or the starter is weakened with a stated reason.
- [ ] **F19 [S2] "Best car" is shown on the wrong track.** Cars are scored on five tracks and shown on one, so the red best car can crash on screen, and the graph averages all five.
  Done when: the view shows all five tracks, or the wording explains the difference.
- [ ] **F20 [S2] Every old experiment number is stale.** Rays, obstacles and multi-track results came from older physics and settings. Only the network-size test is current.
  Done when: the ray test is rerun, and old tables are marked or replaced.

## Phase 3: Teach size and layers

- [ ] **F21 [S1] Network size and layers are not taught.** Current data shows no hidden layer drives as well as any size tested. Neurons only add a little speed.
  Done when: an XOR lab shows no hidden layer failing and one working, shows gradient descent next to evolution, and links back to "the car's task was simple enough".
- [ ] **F22 [S2] Network shape is hard-coded.** `genome.ts`, the save format and the panel assume 6-5-2, and `think` assumes one hidden layer.
  Done when: hidden size can change, with retraining or pre-trained swaps, and a warning that old weights no longer fit.
- [ ] **F23 [S2] Two hidden layers are untested on the car.**
  Done when: measured, needs F22.
- [x] **F24 [S2] Hidden neurons remain unexplained black boxes.**
  Done when: the road-heatmap prototype shows where a neuron fires. If it is not readable, drop it and record why.
- [ ] **F25 [S2] The project file has false or outdated claims.** "Shrink to 2 neurons and watch it fail" (sections 10.1 and 16.4), fresh tracks every generation (section 24), and the old schedule.
  Done when: the project document matches reality.

## Phase 4: Finish the original pitch

- [ ] **F26 [S1] Crash Lab does not exist,** and neither does the rolling state buffer it needs.
  Done when: a crash rewinds and gives a most-likely cause with evidence, checked on 20 hand-labelled crashes.
- [ ] **F27 [S3] No reward lesson.** Reward is a promised outcome in the project file, and users cannot change it.
  Done when: reward sliders exist, using fixed terms and never user code.
- [ ] **F28 [S3] Mission 4 is missing.**
  Done when: it ties the break-it tools to Crash Lab.
- [ ] **F29 [S3] Outlinks are missing.** There is no `links.ts`, and the reward-hacking URL is still unverified.
  Done when: each diagnosis has one checked link.
- [ ] **F30 [S3] Multi-track training was adopted without saved evidence.** The record says it hurt, and no results show that changed.
  Done when: 10-seed results are saved. This also supports F17.
- [ ] **F31 [S3] Reliability test never reached 50 seeds,** and `scripts/reliability.ts` still trains on one track for 40 generations.
  Done when: it matches the app's real setup and 50 seeds are recorded.
- [ ] **F32 [S3] Possible undrivable test track.** No run scored above 39 of 40 at difficulty 1 in the size test.
  Done when: the track is found and explained, and `trackProblem` is updated if needed.

## Phase 5: Quality and launch

- [ ] **F33 [S3] Slow start.** Tracks are built while the page loads (about 1.7 s in Node for the 10 mission tracks).
  Done when: the first frame appears immediately in a browser.
- [ ] **F34 [S3] No welcome.** The page opens directly on Mission 1 with no explanation of what this is.
  Done when: a stranger understands it in 10 seconds.
- [ ] **F35 [S3] No accessibility work.** Canvases have no text alternatives, and there are no ARIA labels or reduced-motion handling.
  Done when: main actions work by keyboard and screen readers get basic labels.
- [ ] **F36 [S3] Phone support is only emulated.** Canvas text is tiny at phone width.
  Done when: tested on real Android Chrome and Safari.
- [ ] **F37 [S4] `main.ts` is 1,088 lines** holding game, UI, graph, swarm and missions, with inline styles.
  Done when: split into modules. Do this before Phase 1 only if it gets in the way.
- [ ] **F38 [S4] No automated tests.** Determinism, genome round trips and `brainFromJson` are unprotected.
  Done when: a small test suite runs from one command.
- [ ] **F39 [S3] No README, write-up or demo.**
  Done when: the repo has a README with a GIF, results table and short write-up, including negative results.
- [x] **F40 [S4] Plain car and track.** The car is now a drawn top-down race car, and the track has kerbs, a chequered start line and a centre line.
  Done when: done last. An optional 3D view stays a bonus and changes drawing only.

## Parked on purpose

Arena, ghost car, obstacles, PPO/PID benchmark, multi-car racing. None of these start until Phase 4 is done.

## Already decided

- Stay 2D. A 3D view can only ever be an optional drawing layer.
- Crashes stay final.
- The network panel follows TensorFlow Playground's interaction ideas, not its look, and keeps the missions.
