"""Build features encoder per distillazione multi-matchup.

Trasforma una BuildSpec in un vettore numerico fisso che caratterizza il PG
in modo abbastanza ricco da permettere a un singolo MLP di distinguere
i matchup e generalizzare cross-build.

Output: np.ndarray di shape (BUILD_FEATURES_DIM,)
"""

from __future__ import annotations

import numpy as np

from cfr.abstraction import BuildSpec

# ── Vocabolari (ordine fisso per consistenza one-hot) ──

WEAPON_VOCAB = [
    "pugnale", "spada", "spada_lunga", "mazza",
    "ascia_1h", "ascia_2h",
    "lancia_2m", "lancia_3m", "giavellotto",
    "arco_corto", "arco_lungo", "balestra",
]
SHIELD_VOCAB = ["scudo_piccolo", "scudo_medio", "scudo_pesante"]
OFFHAND_WEAPON_VOCAB = ["pugnale", "spada"]  # offhand-as-weapon (parry support)
ARMOR_VOCAB = ["armatura_leggera", "armatura_media", "armatura_pesante"]

# Skill categories aggregated
SKILL_AZIONI = ["attaccare", "parare", "schivare", "slancio"]
SKILL_ABILITA = ["forza", "agilità", "volontà"]
SKILL_CLASSI = ["spade", "scudi", "armature", "lance", "asce", "archi", "balestre", "giavellotti"]

BUILD_FEATURES_DIM = (
    len(WEAPON_VOCAB)        # 12 - weapon one-hot
    + len(SHIELD_VOCAB) + 1  # 4 - shield one-hot + 1 bit "no shield"
    + 1                      # offhand-as-weapon flag (pugnale/spada parry)
    + len(ARMOR_VOCAB) + 1   # 4 - armor one-hot + 1 bit "no armor"
    + 1                      # thrown_inventory size (0..4)
    + 1                      # has_backup_weapon
    # skill aggregates
    + 4                      # skill counts per modifier type (-1imp, +1tiro, +1dado, +1dadomax)
    + len(SKILL_AZIONI)      # 4 - skill counts per azione
    + len(SKILL_CLASSI)      # 8 - skill counts per classe oggetto
)
# 12 + 4 + 1 + 4 + 1 + 1 + 4 + 4 + 8 = 39


def _one_hot(value, vocab, default_zero: bool = False) -> np.ndarray:
    v = np.zeros(len(vocab), dtype=np.float32)
    if value is None:
        return v
    if value in vocab:
        v[vocab.index(value)] = 1.0
    return v


def build_to_features(build: BuildSpec) -> np.ndarray:
    """Encoda una BuildSpec in un vettore fisso BUILD_FEATURES_DIM."""
    parts: list[np.ndarray] = []

    # Weapon one-hot (12)
    parts.append(_one_hot(build.weapon, WEAPON_VOCAB))

    # Shield (3) + no_shield flag (1)
    is_shield = build.offhand in SHIELD_VOCAB
    parts.append(_one_hot(build.offhand if is_shield else None, SHIELD_VOCAB))
    parts.append(np.array([0.0 if build.offhand else 1.0], dtype=np.float32))

    # Offhand-as-weapon (1) — pugnale o spada offhand
    has_off_weapon = build.offhand in OFFHAND_WEAPON_VOCAB
    parts.append(np.array([1.0 if has_off_weapon else 0.0], dtype=np.float32))

    # Armor (3) + no_armor flag (1)
    parts.append(_one_hot(build.armor, ARMOR_VOCAB))
    parts.append(np.array([0.0 if build.armor else 1.0], dtype=np.float32))

    # Thrown inventory size
    n_thrown = len(build.thrown_inventory) if build.thrown_inventory else 0
    parts.append(np.array([float(n_thrown)], dtype=np.float32))

    # Backup weapon
    parts.append(np.array([1.0 if build.backup_weapon else 0.0], dtype=np.float32))

    # Skill aggregates
    skill_modif_count = {"-1impedimento": 0.0, "+1tiro": 0.0, "+1dado": 0.0, "+1dadomax": 0.0}
    skill_azione_count = {a: 0.0 for a in SKILL_AZIONI}
    skill_classe_count = {c: 0.0 for c in SKILL_CLASSI}
    for s in build.skills:
        if s.modifier in skill_modif_count:
            skill_modif_count[s.modifier] += float(s.level)
        if s.azione and s.azione in skill_azione_count:
            skill_azione_count[s.azione] += float(s.level)
        if s.classe_oggetto and s.classe_oggetto in skill_classe_count:
            skill_classe_count[s.classe_oggetto] += float(s.level)
    parts.append(np.array([skill_modif_count[k] for k in ["-1impedimento", "+1tiro", "+1dado", "+1dadomax"]], dtype=np.float32))
    parts.append(np.array([skill_azione_count[a] for a in SKILL_AZIONI], dtype=np.float32))
    parts.append(np.array([skill_classe_count[c] for c in SKILL_CLASSI], dtype=np.float32))

    out = np.concatenate(parts).astype(np.float32)
    assert out.shape == (BUILD_FEATURES_DIM,), f"Got {out.shape}, expected ({BUILD_FEATURES_DIM},)"
    return out


__all__ = ["build_to_features", "BUILD_FEATURES_DIM"]
