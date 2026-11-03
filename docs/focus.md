# CrashLab: the next two weeks

Written 3 Nov 2026, after the first tests and a council review. This note wins over the roadmap until the stop date.

## The one learning goal

After playing, a non-technical person can say:

> **"A neuron is a weighted vote on what the sensors see, and the car's driving is those votes added up."**

Every slide, mission and button either helps someone say this sentence or gets cut. Evolution stays only as the short payoff at the end.

## What changes

1. **Driving becomes a warm-up.** It's optional and lasts about 30 seconds. After 3 crashes the car offers to take over, and nobody gets stuck there.
2. **Lessons shrink from 22 slides to 6–8.** Each one has one idea and one thing to do. A slide that can't be made clear in 20 minutes gets deleted.
3. **Honesty pass.** The app says plainly that a trained brain fails on some new tracks.

## Frozen until the goal is met

These are not built, started or prototyped before the stop date:

- Overfitting lesson (B6)
- Hidden layers and XOR lab (B7)
- Reward design (B8)
- Crash detective (B9)
- Pick-a-parent and Downhill (B5)
- Shareable brains, leaderboard, 3D, new tracks or obstacles

## The test

- **Who:** at least 5 new people who know nothing about neural networks, mostly on phones, and none of them earlier testers.
- **How:** watch live, or on a video call with screen sharing. Ask them to think aloud, and note where they stop or frown. Quiz scores come second.
- **Questions:** a different set before and after, so seeing the same quiz twice can't raise the score.
- **The key question afterwards:** "In your own words, what does a neuron do?" It counts as a pass if their answer includes weighing or combining what it senses.

## Pass and stop

- **Pass:** at least 4 of 5 finish, and at least 3 of 5 explain a neuron correctly. Then ship: a README with the real numbers, a 90-second GIF, and a note on what didn't work.
- **Not yet:** one more round of cutting and retesting, and that's all.
- **Stop date: 17 Nov 2026.** If it hasn't passed by then, stop building and write an honest case study of what was tried, what was measured and what was learned.

## Alongside, not instead

- **Know the code.** By the stop date, be able to explain the genetic algorithm, tanh and the 47 weights without help.
- **Data-science work, if time allows:** fix how trained brains do on unseen tracks (now 5–8 of 10) by using more varied tracks and choosing the best brain on held-out tracks. Run this plugged in, with rests between runs.
