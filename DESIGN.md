# Design

The look is called Trackside Paint. It was chosen on 16 Nov 2026 to replace the dark amber HUD.

## The idea

The game looks like a circuit in daylight. The page is painted concrete. Anything a car drives on, or anything drawn in the track's own colours, is asphalt. Kerb red is for actions. The marshal-flag colours carry state.

Two layouts carry the idea:

- **Garage is a pit lane.** The four settings are numbered pit boxes painted on asphalt. On a wide screen they also run across the top of the page and end at a green pit exit that leads to Practice. On a phone they stack down the page.
- **Race starts under the lights.** Five start lights sit over the race screen. They come on one at a time, go out, and the race starts.

## Colour

Tokens live at the top of `src/style.css`. The canvas uses light-on-dark versions of the same colours in `COL` in `src/draw.ts`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#e5e7e4` | The page: concrete |
| `--panel`, `--panel-2` | `#f6f7f5`, `#ffffff` | Panels, and the rows and inputs inside them |
| `--line`, `--line-2` | `#c6cac6`, `#9da29e` | Rules, and the border of anything pressable |
| `--text`, `--muted` | `#16181a`, `#555b60` | Text on the page |
| `--asphalt`, `--asphalt-2` | `#25282b`, `#33373b` | Top bar, pit boxes, track screen, skill tree, result card |
| `--accent` | `#d8261c` | Kerb red: the main action, and nothing else |
| `--flag` | `#ffd21f` | Yellow flag: state, the open pit box, your car |
| `--tele` | `#1f5fd6` | Blue flag: keyboard focus, telemetry, the Daily race |
| `--good`, `--bad` | `#0e8a47`, `#c21f16` | Green flag and red flag |
| `--gold`, `--silver`, `--bronze` | `#e0b020`, `#b9bec2`, `#b4763c` | Medals, always with a letter as well as the colour |

Rules:

- Red never decorates. If something is red it can be pressed and it is the main thing to do.
- Yellow text is only used on asphalt. On the page, yellow is a background with dark text on it.
- Things drawn by the game (track, cars, training graph, skill tree, result squares) keep their own bright colours, so they always sit on asphalt, never on the page.

## Type

One family, Archivo, loaded with its width axis.

- **Wide cut** (`font-stretch: 125%`, weight 800, capitals): headings, labels, tabs, buttons, pit-box numbers. The list of selectors is the "wide face" block at the end of `src/style.css`.
- **Normal width**: body text, hints and figures. Figures use tabular numerals everywhere.
- **Archivo Narrow**: text drawn on the canvas, where long lines must fit an 800-pixel screen.
- Nothing a player reads is under 12px.

## Components

- **Buttons.** White with a grey border; the main action is kerb red with white text. On asphalt, secondary buttons are a lighter asphalt with no border. A disabled main button is grey, not faded red.
- **Tabs.** Grid slots painted on the top bar: three sides of a box, open towards the page. The open tab is filled white. On a phone they are a bar of asphalt along the bottom.
- **Car status.** A flag panel in the top bar: a square of flag colour (yellow for no car or a changed setup, green for ready), then the words.
- **Pit box.** Asphalt, a 3px white painted outline, a large number. The open one is outlined in yellow.
- **Sliders.** A 6px rail and a round white thumb with a dark ring.
- **Kerb.** The red and white stripe is used twice only: under the top bar and along the pit lane.

## Motion

The start lights are the one authored moment. Everything else is a short colour or border change. All of it stops under the reduced-motion setting, and the race then starts at once.

## Kept from before

Keyboard focus on every control (blue ring on the page, white on asphalt), 44px controls on a phone, tabs tied to their panels, and the CrashLab name and logo.

## Not decided

- The pinned "Pit exit: train this car" button from the phone mock-up is not built; the first-visit Train button does that job.
- Stars (★) and arrows (→) in text are still type characters, not drawn icons.

## Added 16 Nov, second pass

- **The track is a slab.** The track screen is asphalt from the edge of the window to the panels, as tall as the window on a wide screen. Its counters and the training graph sit on the same asphalt.
- **The car in its box.** While the Car design box is open, the track screen shows the car drawn large on its grid slot, in the chosen design and paint (`drawBay` in `src/main.ts`). Every other box shows the car on the track. There is one view, and it follows the open box.
- **Icons.** One hand-drawn set in `src/icons.ts`: a 24 by 24 grid, a 2px round line, coloured by the text beside it. No emoji in the interface. The text that is copied when a result is shared still uses emoji squares and medals, because it is pasted into chats.
- **One box at a time.** On a wide screen the pit lane is where a box is opened, so the column shows only the open box.
- **Driving it yourself on a phone.** The track is held under the top bar and the pad sits just above the tabs.
