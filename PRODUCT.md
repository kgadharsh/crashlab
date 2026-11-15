# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who open a link to the game on a laptop or a phone and play in the browser. No primary audience or device has been chosen yet (asked 16 Nov 2026, left open). Playtests so far were with people the author knows.

## Product Purpose

CrashLab is a competitive build-a-car game. A player sets up a car, trains its brain on a fixed budget, then races it on tracks it has never seen. Success is a player finishing the loop (Garage, Practice, Race) and coming back to beat a medal, a friend, or a leaderboard place. Teaching how neural networks work was dropped on 4 Nov 2026 and is not a goal.

## Positioning

The player never drives. They win by engineering choices: how the car sees, how it is set up, what it is rewarded for and which tracks it practises on. The car then drives by itself on secret tracks, and every result is recomputed by a deterministic simulation, so two cars can be compared fairly.

## Operating Context

- The loop: Garage, Skill tree, Practice (training), Race, back to the Garage. Profile and Challenge sit beside it.
- Training takes about half a minute on a laptop and longer on a phone. The other tabs keep working while it runs.
- Results: a medal per Grand Prix (dry and wet), a medal per practice track, stars, a daily and a weekly board, challenge links to race a friend's car.
- Played in short sessions. A large part of every screen is a top-down canvas showing the car, its sensor rays and the track.

## Capabilities and Constraints

- Vite and TypeScript, no UI framework. Screens are DOM built in `src/main.ts` and friends, styled by `src/style.css`. The car, track and race are drawn on canvas in `src/draw.ts` and `src/raceView.ts`.
- Static site on GitHub Pages. The leaderboard is a separate Cloudflare Worker.
- Phone layout uses a bottom tab bar, and every control is at least 44px tall.
- Terms in use: Garage, Skill tree, Practice, Race, Grand Prix, My cars, stars, medals (bronze, silver, gold), rays, budget.
- Undecided: the primary audience and device; whether the wording and the tab structure may change in a redesign (not marked as fixed).

## Brand Commitments

- The name CrashLab and its logo (wordmark with the car badge) stay as they are. Confirmed 16 Nov 2026.
- Nothing else about the current look is binding.

## Evidence on Hand

- The working game itself: real tracks, real trained cars, real lap times and medal thresholds (`docs/focus.md`, `docs/experiments.md`).
- Playtest notes in `docs/playtest.md`. Six responses on 5 Nov 2026, most of which stopped after training.
- No testimonials, player counts or press. Do not invent any.

## Product Principles

1. The player's choices decide the result, and the screen should make each choice and its cost visible.
2. The next step in the loop is always obvious, especially after training.
3. It is a competition: times, gaps, medals and places are the content.
4. It works as well on a phone as on a laptop.

## Accessibility & Inclusion

Keyboard focus is visible on every control, tabs are tied to their panels, small text is at least 12px, and motion respects the reduced-motion setting. Keep all of these.
