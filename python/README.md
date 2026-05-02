# hex-tactics — Python port

Port del motore TS in Python per training RL avanzato e ricerca su bilanciamento/strategie.

## Obiettivi
- **Engine identico al TS** (parità verificata via seed): stesso input → stesso output
- **Velocità**: numpy/cython/torch per simulazioni 10-100x più veloci della sim TS
- **RL nativo**: gymnasium env, stable-baselines3, pytorch

## Setup
```bash
cd python/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Struttura
```
python/
├── hex_tactics/
│   ├── core/        # hex math, state, reducer, events, combat, turn, round
│   ├── entities/    # Unit, Weapon, Shield, Armor, Skill (dataclass)
│   ├── data/        # weapons, shields, armors, presets (singletons)
│   └── ai/          # heuristic, utility, q-learning, dqn, ppo
└── tests/           # parità con TS + unit tests
```

## Riferimento TS (source of truth iniziale)
Il codice TS in `../src/` resta source of truth fino a parità verificata.
Decisioni architetturali in `../DECISIONS.md` (D-001..D-048).

## Roadmap
1. ✅ Scaffolding
2. ⬜ Hex math + types base
3. ⬜ State + reducer + events (cuore engine)
4. ⬜ Test parità con TS sim (golden tests)
5. ⬜ AI Utility port (con weights GA-tuned)
6. ⬜ Gymnasium env wrapper
7. ⬜ DQN/PPO baseline (stable-baselines3)
8. ⬜ AlphaZero-light (MCTS + NN)

## Test parità
Idea: per ogni seed S e matchup M, simulare in TS e in Py, verificare uguale outcome (winner, rounds, hp finali).

```bash
# Da TS:
RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "PARITY DUMP" > /tmp/ts_results.json
# Da Py:
pytest tests/test_parity.py
```
