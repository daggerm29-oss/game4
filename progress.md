# SKYWALK – progress log

Resume from here if a chat runs out of credits. Keep this file updated.

## Phone testing (v5.1)
- `app/api/run/route.ts`: test start levels also honored when `VERCEL_ENV === 'preview'` (Vercel preview deployments).
- `lib/server/env.ts`: guests (plain browser, no Telegram) allowed on preview deployments.
- `lib/server/redis.ts`: in-memory store fallback on preview deployments (project has NO Upstash Redis connected yet;
  production still requires KV_REST_API_URL/TOKEN — connect "Upstash for Redis" before publishing).
- `lib/server/env.ts` gameSecret(): per-deployment fallback key on preview when GAME_SECRET/BOT_TOKEN missing
  (project has neither set; production still throws without them).
- Verified on the deployed preview: start at level 6 -> respawns 3; derail -> respawn, 2 left.
- Phone test link: https://respawn-git-v0-coaster-respawn-readability-k-171c.vercel.app/test (stable branch alias). Preview deployments use Vercel Authentication
  (ssoProtection all_except_custom_domains): log in with the Vercel account on the phone, or turn it off in
  Vercel project Settings -> Deployment Protection.

## Previous change (v5): NO MORE EASY DERAILS — DONE
Feedback: cart still fell off too easily. Root cause: steering target could go to +-4 m while plank edge is ~1.65 m,
and the fork branch offset was added on top.
- `lib/game/game.ts` updateCart: soft guard rail — targetX and x clamped to +-(limit * 0.88), so steering/drift/gusts
  can never derail. Gentle auto-centre (exp(-0.9*dt)) when not steering and next fork > 30 m away.
- Remaining ways to die on the coaster: hitting the bollard at a fork, or taking the dead-end branch.
- Verified: typecheck; /test level 6 with 25 hard right + 25 hard left presses -> still in CART, respawns 3.
- To re-enable edge derails for higher levels: raise the 0.88 factor above 1.0 (e.g. by level).

## Previous change (v4): COASTER READABILITY — DONE
Feedback: track too confusing/hard to see, cart falls off too easily, minimap blocks the view.
- Minimap: `components/game/minimap.tsx` smaller (max 8.5rem, no tilt); `hud.tsx` places it bottom-left.
- Track (`lib/game/render/coaster.ts`): PLANK_HALF 1.3 -> 1.75, SPLIT_HALF 3.3, BRANCH_OFFSET 1.65;
  new materials railGlowMat (yellow glowing edge rails), guideMat (cyan centre line), deckMat (semi-solid deck under grating).
- Physics (`lib/game/game.ts` updateCart): drift factor 0.05 -> 0.022, gusts ~half strength, derail margin +0.15 -> +0.35.
- Camera (placeCart): looks 14 m ahead and lower (y + 0.35) so the plank fills the view.
- Verified: typecheck passes; /test level 6 screenshot shows clear track + small corner map.
Further tuning knobs if still too hard: drift factor, PLANK_HALF, derail margin.

## Previous change (v3): COASTER RESPAWN CHECKPOINTS + /test page  — DONE
Requirement: "if a player dies after clearing level 5 there must be a respawn point; he must respawn from there if he
dies in the roller coaster; each player has 3 attempts to respawn". Plus a separate test preview link where levels can be skipped.

### Plan
- Checkpoint = start of the cart level the player died on (first checkpoint is the level-6 station right after level 5).
  A respawn re-builds that level as a fresh intro round (station + lift hill), new random forks.
- 3 respawns per run (`CART_RESPAWNS = 3` in lib/shared/game.ts). 4th death on the coaster ends the run as before.
- Server (`lib/server/runs.ts`): on a cart-round failure (wrong_track / derailed; NOT forfeit/implausible) with
  `respawnsLeft > 0` -> decrement, replace `run.round` with a new intro round of the same level (startMs = death clientMs),
  clear `run.next`, return `{ result: 'respawn', reason, respawnsLeft, round }`.
- Client (`lib/game/game.ts`): store pending respawn from the verdict; after the fall fades out, rebuild coaster at
  the death spot, put the cart at the station (phase CART), banner "Respawn – N left". HUD shows respawns left (hearts).
- Test page `/test`: same game + test panel (level picker 1..16, in-run "Skip level" = restart run at level+1).
  Server honors start level outside production, or when `ENABLE_TEST_MODE=1`. Test runs (start level > 1) are unranked.

### Status
- [x] Repo imported from github.com/daggerm29-oss/game3 (commit a738415) into v0 project
- [x] shared types (CART_RESPAWNS, TEST_MAX_LEVEL, 'respawn' AnswerResponse, RunStartResponse.respawns)
- [x] server runs.ts respawn logic (RunState.respawnsLeft, RunState.test -> unranked, no group post)
- [x] app/api/run/route.ts: start level honored outside production or with ENABLE_TEST_MODE=1; returns respawns
- [x] client game.ts: pendingRespawn, respawn() (rebuilds coaster at death spot, cart at station, phase CART),
      freshCart() helper, testDerail(), startRun(startLevel?) ; store.respawns
- [x] HUD hearts (components/game/hud.tsx) while in the cart
- [x] /test page (app/test/page.tsx) + components/game/test-panel.tsx (level picker 1-20, Skip level, Derail now)
- [x] typecheck passes
- [x] API check: derail x4 at level 6 -> respawn (2 left), respawn (1), respawn (0), then wrong/final; ranked=false
- [x] browser check on /test: level 6 -> CART -> Derail now -> FALL -> CART with respawns 2

### Possible next steps
- If "respawn point" should instead always be the level-6 station (not the current level): in runs.ts respawn branch
  use `createRound(CART_START_LEVEL, ...)` and set `run.level = CART_START_LEVEL`.
- Respawn count on the result screen; respawn sound / flash effect.

---
## Previous change (v2, done): CART / COASTER MODE after level 5
After clearing level 5 the runner reaches a station at the end of the deck and hops into a mine cart.
From level 6 on, every level is a cart ride on a narrow, see-through grating coaster track high above the city:
- Turns push the cart outward (centrifugal drift) -> player must slide left/right to stay on. Off the plank -> derail -> fall.
- Track FORKS (= the "gates" of a cart level). Slide LEFT or RIGHT of the bollard. One branch is real, the other a dead end.
- Orange handheld MINIMAP shows the TRUE route ahead. Fog banks hide forks; wind gusts; map static at level >= 8.

## Architecture (cart mode)
- `lib/shared/game.ts`: `CART_START_LEVEL=6`, `CartPlan {seed, correct[], fog[], wind, intro}`, `RoundDTO.cart`,
  `cartLayout()`, FailReasons `wrong_track` | `derailed`.
- Server `rounds.ts` generates cart rounds for level >= 6. `runs.ts` verifies lane (0 left / 1 right); lane -1 = derailed.
- Client `lib/game/render/coaster.ts`: deterministic path generator from seed, geometry, `Coaster` class, minimap drawing.
- `lib/game/game.ts`: phases `BOARDING`, `CART`; cart fall reuses `FALL` with `this.cartFall`.
- HUD: `components/game/minimap.tsx`, mist overlay, lean warning.

## Testing tip
Open `/test` for the test panel. `?cart=1` starts at level 6, `?level=N` at level N (server honors these only outside
production, or when env `ENABLE_TEST_MODE=1`).

## Previous change (v1, done): endless Temple-Run style runner
- Server signs round tokens, verifies each gate (lane + timing), delivers next round on gate 0.
- `lib/server/redis.ts` falls back to in-memory store without Upstash creds (dev only).
