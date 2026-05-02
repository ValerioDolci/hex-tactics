# hex-tactics Python port — TODO

> Piano di lavoro per il porting Python del motore. Convenzione: `[ ]` pending, `[~]` in progress, `[x]` done, `[-]` skipped.
>
> **Source of truth iniziale**: il codice TS in `../src/` + `../DECISIONS.md` (D-001..D-048).
> **Verifica parità**: ogni modulo portato deve avere un golden test che confronta output con la sim TS su seed identici.

---

## Stato avanzamento

| Milestone | Stato | Note |
|---|---|---|
| **P0** Scaffolding | `[x]` | Cartelle, requirements (numpy/pytorch/sb3), README, RNG portato |
| **P1** Hex math | `[x]` | core/hex.py (coords, distance, line, base — pathfinding rinviato). 30 test verdi inclusi golden parità TS↔Py (50 distanze + 20 linee). |
| **P2** Entities + Data | `[x]` | Unit, Equipment, Skill, weapons (12), shields (3), armors (3), presets (3, post-D-046). 21 test parità inclusi 120 cost-grid. |
| **P3** Stats + Skill match | `[x]` | getImpedimentTotal, countFlatBonuses, countMaxDiceExtra, makeAttack/Dodge/Parry/SlancioContext. 6 test parità su 3 preset × 4 contesti. |
| **P4** Combat math | `[x]` | dice (Roll), composeAttackRoll (D-047), composeDodgeRoll, composeParryRoll, resolveDodge/Parry/NoDef, applyDamageWithArmor. 90 scenari + sequence test stato RNG. |
| **P5** Ranged | `[x]` | computeLoS, canFireRanged, composeRangedAttackRoll (D-042/D-043). 6 LoS + 7 canFire + 9 ranged_attack. |
| **P6** Turn + Round | `[x]` | applyTurnStart (D-044), applyInitialSlancio (D-045), applySlancioPenalty, computeTurnOrder, checkGameOver. 6 test parità inclusi RNG state final. |
| **P7** Events + State + Reducer | `[x]` | tutti gli event types, GameState, reducer puro. 6 scenari × ~5 eventi con snapshot completo dopo ogni step. |
| **P8** Test parità engine | `[x]` | 30 battaglie complete (6 matchup × 5 seed) con basicAi da entrambi i lati: winner + rounds + HP finali + RNG state finale tutti identici. |
| **P9** AI Heuristic | `[x]` | basicAi.ts → basic_ai.py (find_closest_enemy, ai_decide_slancio, action, attacker_dice, defense). |
| **P10** Utility AI + legalMoves | `[x]` | utilityAi.ts + legalMoves.ts → utility_ai.py + legal_moves.py. 18 battaglie complete + 3 scenari legalMoves/decision/score parità. |
| **P10b** Weights GA-tuned | `[ ]` | mapping preset×preset → weights ottimi. **Bloccato**: i 12 set GA-found non sono hardcoded nel TS (output di optimize-ai-ga.ts). Aspetto JSON da Valerio. |
| **P11** Gymnasium env wrapper | `[ ]` | observation space, action space (per phase), reward shaping (HP delta + win/loss) |
| **P12** DQN baseline (stable-baselines3) | `[ ]` | training su 100k+ episodi, eval vs Utility AI |
| **P13** PPO baseline | `[ ]` | confronto vs DQN |
| **P14** AlphaZero-light (MCTS + NN value) | `[ ]` | strategia policy + tree search guidato da NN |
| **P15** Bilanciamento avanzato | `[ ]` | usa AI trained per scoprire strategie e segnalare squilibri di preset/regole |

---

## P1 — Hex math ✅

**Obiettivo**: portare `src/core/hex/{coords,distance,line,base}.ts` in `python/hex_tactics/core/hex.py` (single file).

- [x] `Axial` dataclass (q, r) frozen → hashable; `Offset`, `Pixel`
- [x] `axial_equals(a, b)`
- [x] `axial_round(q_frac, r_frac)` con `_js_round = floor(x+0.5)` (round-half-up come `Math.round` JS — diverso da `round()` Python che fa banker's)
- [x] `offset_to_axial`, `axial_to_offset` (odd-r), `axial_to_pixel`, `pixel_to_axial`, `hex_vertices`
- [x] `hex_distance(a, b)` — Manhattan su cube coords
- [x] `neighbors`, `hexes_in_range(center, n)`, `are_adjacent`, `NEIGHBOR_DIRS` (stesso ordine TS)
- [x] `hex_line(a, b)` — lerp axial + `axial_round`
- [x] `has_line_of_sight(from, to, is_blocking)` — esclude estremi
- [x] `get_base_hexes(center)`, `bases_overlap`, `base_distance`
- [x] **Golden parità TS↔Py**: dump JSON da `tests/sim/dump_hex_golden.test.ts` (Mulberry32 seed=42, 50 pair + 20 line) caricato da `tests/test_hex.py::TestGoldenParity` → 100% match
- [-] Pathfinding (`findPath`, `reachableHexes`) rimandato: non listato in P1, deferred a milestone successiva quando serve all'AI

**Test**: `pytest tests/test_hex.py` → 30/30 verdi in ~30ms.

**Note di chiusura P1**:
- Single file `core/hex.py` (~250 righe), pari di scope con i 4 file TS minus pathfinding
- Punto di attenzione documentato nel modulo: `_js_round` per matchare `Math.round` JS sui `.5` esatti
- Fixture `tests/fixtures/hex_golden.json` rigenerabile con: `DUMP_HEX_GOLDEN=1 npx vitest run tests/sim/dump_hex_golden.test.ts`

## P2 — Entities + Data

- [ ] `entities/equipment.py`: Stat, EquipCategory, ItemBase
- [ ] `entities/skill.py`: SkillModifier, AcquiredSkill (con `level`), `compute_skill_cost`, `count_specializations`, `skill_key`, `validate_skill_set`, `skill_matches_context`, `skill_matches_equip`
- [ ] `entities/unit.py`: Unit dataclass, `create_baseline_unit`
- [ ] `data/weapons.py`: dict di tutte le armi (arma `1D6+2/+2` con i 2 modes per Spada)
- [ ] `data/shields.py`, `data/armors.py`
- [ ] `data/presets.py`: 3 preset post-D-046 (spadaccino 2H, arciere, tank), `unit_from_preset`
- [ ] **Golden test**: cost calculator → stessi costi del TS per i 3 preset

## P3 — Stats + Skill match

- [ ] `core/stats.py`: tutte le funzioni di `src/core/stats.ts`
- [ ] make_attack_context, make_dodge_context (stat='agilità'), make_slancio_context (stat='agilità'), make_parry_context
- [ ] **Golden test**: imp totale per ogni preset → identico

## P4 — Combat math

- [ ] `core/dice.py`: Roll dataclass (variable: list[int], fixed: int), `make_roll`, `roll_total`, `combine_rolls`
- [ ] `core/combat.py`: composeAttackRoll (con D-047 dual-stat), composeDodgeRoll, composeParryRoll, resolveDodge, resolveParry, resolveNoDefense, applyDamageWithArmor
- [ ] **Golden test parità**: con seed S, attaccante X, difensore Y → stesso Roll TS↔Py

## P5 — Ranged

- [ ] `core/ranged.py`: computeLoS, canFireRanged, composeRangedAttackRoll (D-042 scudo passivo, D-043 armor passivo single application)
- [ ] **Golden test**: tiri ranged identici al TS

## P6 — Turn + Round

- [ ] `core/turn.py`: applyTurnStart (con impetoToSlancio D-044), applyInitialSlancio (D-045), applySlancioPenalty, computeDiceRecovery, getMaxSlancioRoll (cap senza imp)
- [ ] `core/round.py`: computeTurnOrder, checkGameOver
- [ ] **Golden test**: tiro slancio iniziale e applyTurnStart identici

## P7 — Events + State + Reducer

- [ ] `core/events.py`: GameEvent come union di dataclass (START_ROUND, START_TURN, MOVE, DECLARE_ATTACK, CHOOSE_ATTACKER_DICE, CHOOSE_DEFENSE, RESOLVE_COMBAT, RELOAD, END_TURN, END_ROUND)
- [ ] `core/state.py`: GameState, PendingAction, LogEntry, `create_initial_state` (chiama applyInitialSlancio per D-045), helpers (update_unit, append_log)
- [ ] `core/reducer.py`: reducer puro con tutti i casi del reducer TS, incluso D-048 contraccolpo + bypass RD per ranged (D-043)

## P8 — Test parità engine end-to-end

- [ ] Script `tests/test_parity.py`:
  - 100 partite TS via `runBattle` (esportate in JSON: seed, matchup, winner, rounds, hp_a_finale, hp_b_finale)
  - 100 partite Py con stessi seed/matchup
  - assert outcome identico al 100%
- [ ] Se fallisce, identificare il primo punto di divergenza con tracing

## P9 — AI port

- [ ] `ai/basic_ai.py`: heuristic
- [ ] `ai/utility_ai.py`: scoring identico (con D-048 contraccolpo cost, D-047 dual-stat detection, kite logic per ranged)
- [ ] `ai/legal_moves.py`: legalMoves identico (con D-044 transfer impeto-slancio variants)
- [ ] **Golden test**: AI Utility Py = AI Utility TS sui matchup

## P10 — Weights GA-tuned

- [ ] `ai/matchup_weights.py`: hardcode dei 12 set GA-found (mapping `[my_preset][enemy_preset] → UtilityWeights`)
- [ ] Default fallback per matchup non coperti

## P11 — Gymnasium env

- [ ] `ai/env.py`: HexTacticsEnv(gym.Env) con:
  - observation: vettore (impeto, slancio, dadi, hp, dist, hp_enemy, ...)
  - action_space: Discrete con max(legal_actions) per tutte le phase
  - reward: HP_delta intermedio + ±5 win/loss
  - reset(seed) + step(action) + render()
- [ ] Test smoke: env.reset() + env.step() funzionano

## P12 — DQN

- [ ] `ai/train_dqn.py`: stable-baselines3 DQN, 100k-1M episodi, eval vs Utility
- [ ] Save model `.zip`, eval winrate

## P13 — PPO

- [ ] `ai/train_ppo.py`: stable-baselines3 PPO con stesso env

## P14 — AlphaZero-light

- [ ] MCTS guidato da NN (policy + value)
- [ ] Self-play data generation
- [ ] Network: CNN o MLP su state vector
- [ ] Iter di policy improvement

## P15 — Bilanciamento avanzato

- [ ] Usa AI trained vs preset variants per identificare squilibri
- [ ] Suggerimenti di tweak (mazza nerf, armatura buff, skill costi rivisti, ecc.)
- [ ] Loop: tweak → retrain → re-eval

---

## Note operative

- **Source of truth**: TS finché parità engine non chiusa (P8). Dopo P8, Python può divergere.
- **Test parità**: ogni modulo ha un test che combacia con TS. Se TS cambia (nuova D-049, ecc.), Python deve essere aggiornato.
- **Effort stimato**: P1-P8 (engine) ~3 giorni. P9-P12 (AI baseline) ~2 giorni. P13-P15 (avanzato) ~1 settimana.
- **Priorità**: P1→P8 lineare (dependencies). P9-P10 prima di P11. P11 prima di P12-P14.

## Come usare questo file

- Inizio sessione: leggere `CLAUDE.md`, `DECISIONS.md`, `TODO.md` (TS), `python/TODO.md` (questo)
- Durante lavoro: aggiornare `[ ] → [~] → [x]`
- Fine milestone: aggiornare tabella stato
- Nuovo task: aggiungere alla milestone giusta
