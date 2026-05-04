# State Abstraction + Tabular CFR — Design Document

> **Status**: bozza tecnica per l'AI seria/esatta del progetto. Da rivedere con Valerio prima dell'implementazione.
> **Data**: 2026-05-03
> **Autore**: Claude (assistant), su brief di Valerio

## Obiettivo

Costruire un **solver near-Nash** per hex-tactics utilizzabile come strumento di **balance analysis**: dato qualunque matchup `(build_A, build_B)` (skill set + equipment), produrre una policy mixed-strategy vicina al Nash equilibrium e un valore di gioco V_a. Il sistema deve essere **generalizzabile**: non hardcoded sui 3 preset, deve consumare build arbitrarie e produrre risultati significativi.

## Vincoli noti dal bench (Step 1, 2026-05-03)

- **info-set count full state space**: 100K-2M+ (curva non satura a 1000 rollouts) → tabular CFR sul vero state space NON è praticabile
- **branching factor**: 4-10 (legalMoves cap 24) → ottimo per minimax/abstraction
- **depth partita**: 130-210 step → 60-100 decisioni per player
- **throughput Mac M4 (Leduc CFR)**: 199 iter/sec su game ~3.9M info-set → estrapolando, su game astratto a 10⁴-10⁵ info-set possiamo aspettarci 1000+ iter/sec

## Architettura del solver

```
┌─────────────────────────────────────────────────────────────┐
│                  build_A, build_B (input)                    │
│         (skill set + equipment + stat baseline)              │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           AbstractGame (pyspiel.Game wrapper)                │
│                                                              │
│   ┌──────────────────────────┐   ┌────────────────────────┐ │
│   │ State Abstraction        │   │ Action Abstraction     │ │
│   │ (bucketizza HP, slancio, │   │ (collassa hex moves    │ │
│   │  impeto, distance, ...)  │   │  in classi semantiche) │ │
│   └──────────────────────────┘   └────────────────────────┘ │
│                                                              │
│              concretize(abstract_event) → GameEvent          │
│              (per simulare partite vere)                     │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│       OpenSpiel CFR+ / External Sampling MCCFR               │
│       (tabular sull'abstraction)                             │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│   Output: avg_policy[infoset → action_probs], V_a, nash_conv │
└─────────────────────────────────────────────────────────────┘
```

## State Abstraction — design

### Principi guida

1. **Lossy controllato**: l'abstraction perde informazione. La perdita deve essere **dichiarata** (nei bucket boundaries) e **tunabile** (parametri).
2. **Sufficiente per resource pooling**: tutte le risorse globali (slancio, impeto, dadi, HP) sono nello state.
3. **Simmetrico**: lo stato astratto è invariante a simmetrie (scambio A↔B per mirror match, riflessione spaziale).
4. **Hashable & serializzabile**: per cache e log.

### Componenti dello state astratto

#### 1. Risorse pooling (dimensione critica)

| Variabile | Range vero | Bucket proposto | Rationale |
|---|---|---|---|
| `HP_a, HP_b` | 0..20 | `[0, 1-5, 6-10, 11-15, 16-20]` (5 bucket) | HP=0 distinto (terminal); 4 fasce gradient |
| `slancio_a, slancio_b` | 0..30 (può accumularsi) | `[0, 1-2, 3-5, 6-9, 10-14, 15-19, 20+]` (7 bucket) | Soglia tipica per asta D-052 (1, 5, 10) preservata |
| `impeto_a, impeto_b` | 0..30 | `[0, 1-13, 14-15 baseline, 16-19, 20+]` (5 bucket) | Cattura "ho perso impeto = recupero capped a 1" e "sono baseline 14" |
| `dadi_a, dadi_b` | 0..9 | esatto (10 valori) | Risorsa locale del turno, info importante |

**Stato risorse totale**: 5 × 5 × 7 × 7 × 5 × 5 × 10 × 10 = **3,062,500 combinazioni** ← troppo

**Riduzione**: il bucket dei due player può essere espresso come **delta** + simmetria:
- `HP_self_bucket` (5)
- `HP_enemy_bucket` (5)
- `slancio_self_bucket` (7)
- `slancio_enemy_bucket` (7)
- `impeto_delta_bucket` (5: very_behind / behind / equal / ahead / very_ahead)
- `dadi_self` (10)
- `dadi_enemy` (10)

→ 5 × 5 × 7 × 7 × 5 × 10 × 10 = **612,500** combinazioni risorse soltanto

Ancora troppo. Riduzioni:
- `dadi_enemy` solo nelle fasi dove conta (defense): in altre fasi → "irrelevant" bucket
- `impeto_delta` ridotto a 3: ahead / equal / behind

→ Stima realistica: ~50K-150K stati di sole risorse

#### 2. Posizione (compressione spaziale)

| Variabile | Range vero | Bucket proposto |
|---|---|---|
| `distance_hex` | 0..30+ | `[0 (adjacent), 1, 2, 3, 4-6, 7-10, 11+]` (7 bucket) |
| `los_visibility` | 0..7 | esatto (8) |
| `weapon_in_range` | bool ranged + bool melee_extended | 4 combo |

→ 7 × 8 × 4 = 224 combinazioni spaziali

#### 3. Build / Equipment (parametri statici della run, NON variabili durante il game)

Build A e B sono **fissi per una run di CFR**. Non vanno nello state — sono costanti del game. Questo è fondamentale per la generalizzabilità: una run di CFR risolve UNA configurazione `(build_A, build_B)`.

**Per testare N build in matchup**: lanciare CFR per ogni coppia `(build_A_i, build_B_j)` separatamente.

#### 4. Phase + flags

| Variabile | Cardinalità |
|---|---|
| `phase` (turn-start, choosing-action, declaring-attack, awaiting-defense, awaiting-attacker-bid, awaiting-defender-bid, ranged-pending, ...) | 8 |
| `weapon_loaded` (per balestra ricarica) | 2 |
| `current_turn_player` (è il mio turno?) | 2 |
| `pending_action_type` (None, melee, ranged, asta) | 4 |

→ 8 × 2 × 2 × 4 = 128 combo

#### 5. Stima totale info-set astratti

Ordine di grandezza:
- Risorse: ~150K
- Spaziale: ~224
- Phase: ~128
- Tutto combinato: lossy → la maggior parte non si raggiunge mai

**Stima realistica info-set effettivamente popolati**: 50K-500K (vs 5M-50M del game vero)

→ **fattibile per tabular CFR su Mac M4** in pochi minuti per matchup.

### Action Abstraction — design

#### Principio

Il branching factor vero è 4-10. Possiamo **conservarlo** se manteniamo le azioni semantiche:
- Movimento: invece di "muovi a hex (q,r)", classifichiamo come `MOVE_TOWARD_ENEMY`, `MOVE_AWAY`, `MOVE_FLANK`, `MOVE_TO_COVER`
- Attacco: `ATTACK_MELEE_1D`, `ATTACK_MELEE_2D`, `ATTACK_RANGED_1D`, `ATTACK_RANGED_2D`
- Difesa: `DODGE_1D`, `DODGE_2D`, `PARRY_1D`, `PARRY_2D`, `NO_DEFENSE`
- Asta: `BID_0`, `BID_1`, ..., `BID_MAX`, `QUIT`
- Bookkeeping: `END_TURN`, `RELOAD`, `SLANCIO_0D`, `SLANCIO_1D`, `SLANCIO_2D`
- Transfer: `IMPETO_TO_SLANCIO_X` (X = quanti)

→ Action space astratto cardinalità ~20-25

#### Concretizzazione (`concretize`)

Quando il solver vuole simulare/applicare un'azione astratta:
- `MOVE_TOWARD_ENEMY` → tra le hex moves disponibili, scegli quella che minimizza la distanza enemy (deterministic se unica, random se tie)
- `ATTACK_MELEE_2D` → emit `EventDeclareAttack(weapon=primary_melee, dice=2, ...)` con weapon scelto deterministicamente da build

La concretizzazione introduce un piccolo "loss" (più hex producono lo stesso `MOVE_TOWARD_ENEMY` ma il game vero li distingue). È accettabile per balance analysis.

## Generalizzabilità — il punto chiave

### API target

```python
from cfr.abstraction import HexTacticsAbstractGame, BuildSpec, run_cfr_for_matchup

build_a = BuildSpec(
    weapon="spada_lunga",
    weapon_2h_mode=True,
    offhand=None,
    armor="armatura_leggera",
    skills=[
        SkillSpec(modifier="+1 al tiro", spec_lists=["attaccare", "spade"], levels=2),
        SkillSpec(modifier="-1 impedimento", spec_lists=["armature"], levels=3),
    ],
    stats=(2, 2, 2),
)
build_b = BuildSpec(weapon="arco_corto", armor="armatura_leggera", skills=[...])

result = run_cfr_for_matchup(
    build_a, build_b,
    abstraction=DefaultAbstraction(),  # o custom
    iterations=5000,
    algorithm="cfr_plus",
)
print(f"V_a = {result.V_a}, nash_conv = {result.nash_conv}")
print(result.policy_table)  # serializzabile a JSON
```

### Sweep di build

```python
from cfr.abstraction import BuildSweep

sweep = BuildSweep()
# Confronta tutte le 12 armi a parità di armor/skill
sweep.add_axis("weapon", ["pugnale", "spada", "spada_lunga", ...])
sweep.add_axis("armor", ["armatura_leggera", "armatura_media", "armatura_pesante"])

results = sweep.run(iterations=2000, n_workers=4)  # multi-processing
sweep.plot_heatmap("V_a")  # heatmap winrate matchup
sweep.export_csv("/tmp/balance_sweep.csv")
```

### Skill ablation

```python
# Confronta build con e senza una skill specifica
base = BuildSpec(weapon="spada", armor="armatura_leggera", skills=[])
with_dice = base.with_extra_skill(SkillSpec("+1 dado", ["attaccare", "spade"]))
result = run_cfr_for_matchup(base, with_dice)
# Quanto vale la skill?
print(f"Δ V = {result.V_b - 0.5}  (skill value vs no-skill mirror)")
```

## Fasi di implementazione (proposta)

| Fase | Output | Tempo stimato |
|---|---|---|
| **F0** Documento design (questo file) | review da Valerio | 0.5h fatto |
| **F1** Bench abstraction su engine attuale | conferma 50K-500K info-set | 1-2h |
| **F2** `BuildSpec` + `AbstractState` + `concretize` | classi base testate | 3-4h |
| **F3** `HexTacticsAbstractGame` (pyspiel.Game) | wrapper testato con random rollouts | 3-4h |
| **F4** Sanity test CFR su un matchup piccolo (es. spadaccino vs tank) | nash_conv ≤ 0.05 in <10 min | 2h |
| **F5** `BuildSweep` + multi-processing | heatmap balance run reale | 2-3h |
| **F6** Validazione: confronto policy CFR vs PPO v16 sui matchup esistenti | sanity check semantico | 2h |

**Totale**: ~16h di lavoro pulito, distribuibile su 2-3 sessioni.

## Decisioni di abstraction critiche da fissare con Valerio

> Ognuna di queste cambia di 2-10x lo state space e il tempo di compute.

### D-A1. Granularità HP buckets

- **Stretto**: 5 bucket (proposto sopra) → buono per game con HP=20 baseline
- **Largo**: 3 bucket (full / hurt / dying) → riduce 1.7x ma perde gradiente damage tactics
- **Custom**: configurabile per build (es. tank con HP=30 → bucket diversi)

**Proposta default**: 5 bucket. Configurabile.

### D-A2. Slancio buckets

Slancio è la risorsa più critica per resource pooling (asta D-052, movimento, contraccolpo). Bucket sbagliati = perdita di precisione enorme.

**Proposta**: 7 bucket centrati sulle soglie di gameplay (`[0, 1-2, 3-5, 6-9, 10-14, 15-19, 20+]`)

### D-A3. Distance buckets

- **Stretto**: 7 bucket (proposto)
- **Largo**: 4 (adjacent / close / mid / far) → riduce branching ranged decisions
- **Hybrid**: ranged-aware (più dettaglio se in range arma)

**Proposta**: 7 default, hybrid se serve

### D-A4. Action concretization tie-break

Quando `MOVE_TOWARD_ENEMY` ha più hex equivalenti, come scegliamo?

- **Deterministic**: primo nella lista (semplice, deterministico) — proposto
- **Random**: 1/n probabilità su tutti — più realistico ma stocastico
- **Heuristic**: privilegia copertura/cover/flank → richiede heuristic nel concretize

**Proposta**: deterministic per la prima implementazione, stocastico come opzione.

### D-A5. Boundary condition: terminate dopo N round?

Game vero permette anche 30+ round. Per CFR convergente conviene troncare:
- `max_rounds = 25` con outcome="draw" se nessun win → matcha pratica gioco

**Proposta**: 25 round, draw=0.

## Validazione qualità abstraction

Dopo l'implementazione F2-F3, prima di lanciare CFR (F4):

1. **Test concretization round-trip**: per N partite simulate con AI heuristic, ogni `(state, action)` astratto → concretize → applica → confronta state risultante. Tasso di "abstraction-consistent" deve essere ≥ 85%.
2. **Coverage test**: 1000 rollouts random → quanti info-set astratti distinti? Deve essere 50K-500K (target).
3. **Symmetry test**: mirror match (build_A == build_B), `V_a` deve convergere a 0.5 entro tolleranza (se non c'è bias di iniziativa intrinseco).

## Output del solver per balance analysis

Per ogni matchup `(build_A, build_B)`:

```json
{
  "build_a": {...},
  "build_b": {...},
  "V_a": 0.62,
  "nash_conv": 0.018,
  "rounds_to_converge": 5000,
  "wall_time_s": 145.3,
  "policy_a_size": 47000,  // info-set count
  "policy_b_size": 46500,
  "key_decisions": [
    {"infoset": "phase=choosing-action,HP_s=high,...", "action_probs": {...}},
    ...
  ]
}
```

Aggregato su sweep:
- Heatmap `V_a` per ogni coppia build
- Ranking build per win rate medio (vs distribuzione di opponent)
- Identificazione build dominate (V_a < 0.3 in tutti i matchup) e dominanti (V_a > 0.7 ovunque)

## Open questions

- **Q1**: Vogliamo modellare l'asta D-052 nello state astratto, o trattarla come sub-game tabular standalone (cache CFR sub-game) chiamato dal macro? Il sub-game asta ha già una soluzione tabular. Integrarla risparmia tempo CFR.
- **Q2**: Come gestiamo la `random_pg` generation? L'abstraction qui è per build **fissi**. Per testare la balance "media" su build random, serve un layer sopra (es. CFR su build_a fisso, build_b mixed da pool di random_pg).
- **Q3**: Multi-processing: posso fork 4-8 worker per matchup paralleli. Il Mac M4 ha quanti P-core? (10-14 nominali, ma alcuni Efficient).

---

**Prossimo step**: una volta che approvi questo design (anche con modifiche su D-A1..D-A5), procedo con F1 (bench abstraction empirico — verifica che gli info-set astratti siano davvero 50K-500K).
