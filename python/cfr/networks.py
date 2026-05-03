"""
Neural networks per Deep CFR scratch.

Architettura:
  - RegretNet: input obs (153) → output regret per azione (24 = MAX_ACTIONS)
    Usato per regret matching: σ_t(s,a) = max(R_t(s,a),0) / Σ max(R_t(s,a'),0)
  - StrategyNet: input obs → output policy distribution (24 azioni)
    Usato per running average strategy (la policy finale che approssima Nash).

Body comune:
  - 3-layer MLP, hidden 256
  - ReLU + LayerNorm
  - Output linear (no softmax: applichiamo masking + softmax esternamente)

Buffer:
  - RegretBuffer: (info_set_key, obs, regrets[24], legal_mask[24], iter_t)
  - StrategyBuffer: (info_set_key, obs, strategy[24], legal_mask[24], iter_t)

Uso:
  net.predict(obs, legal_mask) → strategia o regret per le azioni legali
  buffer.add(...) → accumula sample
  trainer.train(net, buffer) → aggiorna pesi su batch
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

MAX_ACTIONS = 24
N_FEATURES = 153
HIDDEN = 256


class MLPBody(nn.Module):
    """Body comune: MLP 3-layer con LayerNorm."""

    def __init__(self, n_features: int = N_FEATURES, hidden: int = HIDDEN):
        super().__init__()
        self.fc1 = nn.Linear(n_features, hidden)
        self.ln1 = nn.LayerNorm(hidden)
        self.fc2 = nn.Linear(hidden, hidden)
        self.ln2 = nn.LayerNorm(hidden)
        self.fc3 = nn.Linear(hidden, hidden)
        self.ln3 = nn.LayerNorm(hidden)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.relu(self.ln1(self.fc1(x)))
        x = F.relu(self.ln2(self.fc2(x)))
        x = F.relu(self.ln3(self.fc3(x)))
        return x


class RegretNet(nn.Module):
    """Predice regret per azione. Output dim = MAX_ACTIONS."""

    def __init__(self, n_features: int = N_FEATURES, hidden: int = HIDDEN):
        super().__init__()
        self.body = MLPBody(n_features, hidden)
        self.head = nn.Linear(hidden, MAX_ACTIONS)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.body(x))

    def predict_regret(self, obs: np.ndarray, legal_mask: np.ndarray) -> np.ndarray:
        """Restituisce regret per ogni azione (mascherato a 0 per illegal)."""
        with torch.no_grad():
            x = torch.from_numpy(obs).float().unsqueeze(0)
            r = self.forward(x).squeeze(0).numpy()
            # Mask illegal: regret 0 (così non sono mai scelti)
            r[~legal_mask.astype(bool)] = 0.0
            return r

    def predict_strategy(self, obs: np.ndarray, legal_mask: np.ndarray) -> np.ndarray:
        """Strategia da regret matching: positive normalized."""
        regret = self.predict_regret(obs, legal_mask)
        positive = np.maximum(regret, 0.0)
        positive[~legal_mask.astype(bool)] = 0.0
        s = positive.sum()
        if s > 0:
            return positive / s
        # Tutti regret <= 0: fallback uniforme su azioni legali
        n_legal = int(legal_mask.sum())
        if n_legal == 0:
            out = np.zeros(MAX_ACTIONS)
            out[0] = 1.0
            return out
        out = np.zeros(MAX_ACTIONS)
        out[legal_mask.astype(bool)] = 1.0 / n_legal
        return out


class StrategyNet(nn.Module):
    """Predice strategia (policy distribution). Output softmax mascherato."""

    def __init__(self, n_features: int = N_FEATURES, hidden: int = HIDDEN):
        super().__init__()
        self.body = MLPBody(n_features, hidden)
        self.head = nn.Linear(hidden, MAX_ACTIONS)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.body(x))  # logits

    def predict_strategy(self, obs: np.ndarray, legal_mask: np.ndarray) -> np.ndarray:
        """Softmax su logits, mascherato per legal."""
        with torch.no_grad():
            x = torch.from_numpy(obs).float().unsqueeze(0)
            logits = self.forward(x).squeeze(0).numpy()
            # Set illegal a -inf
            logits[~legal_mask.astype(bool)] = -1e9
            # Numerical stable softmax
            logits = logits - logits.max()
            exp_l = np.exp(logits)
            exp_l[~legal_mask.astype(bool)] = 0.0
            s = exp_l.sum()
            if s > 0:
                return exp_l / s
            n_legal = int(legal_mask.sum())
            if n_legal == 0:
                out = np.zeros(MAX_ACTIONS)
                out[0] = 1.0
                return out
            out = np.zeros(MAX_ACTIONS)
            out[legal_mask.astype(bool)] = 1.0 / n_legal
            return out


@dataclass
class RegretSample:
    obs: np.ndarray
    regrets: np.ndarray  # [MAX_ACTIONS]
    legal_mask: np.ndarray  # [MAX_ACTIONS]
    iter_t: int  # weight (linear CFR)


@dataclass
class StrategySample:
    obs: np.ndarray
    strategy: np.ndarray  # [MAX_ACTIONS] target distribution
    legal_mask: np.ndarray
    iter_t: int


class RegretBuffer:
    """Reservoir buffer per regret samples (un buffer per player)."""

    def __init__(self, max_size: int = 50000):
        self.max_size = max_size
        self.samples: List[RegretSample] = []
        self._n_seen = 0

    def add(self, sample: RegretSample) -> None:
        self._n_seen += 1
        if len(self.samples) < self.max_size:
            self.samples.append(sample)
        else:
            # Reservoir sampling
            idx = np.random.randint(0, self._n_seen)
            if idx < self.max_size:
                self.samples[idx] = sample

    def __len__(self) -> int:
        return len(self.samples)


class StrategyBuffer:
    """Buffer per strategy samples (per training average policy)."""

    def __init__(self, max_size: int = 50000):
        self.max_size = max_size
        self.samples: List[StrategySample] = []
        self._n_seen = 0

    def add(self, sample: StrategySample) -> None:
        self._n_seen += 1
        if len(self.samples) < self.max_size:
            self.samples.append(sample)
        else:
            idx = np.random.randint(0, self._n_seen)
            if idx < self.max_size:
                self.samples[idx] = sample

    def __len__(self) -> int:
        return len(self.samples)


def train_regret_net(
    net: RegretNet,
    buffer: RegretBuffer,
    epochs: int = 5,
    batch_size: int = 256,
    lr: float = 1e-3,
) -> float:
    """Train regret net su buffer. Restituisce loss media finale."""
    if len(buffer) == 0:
        return 0.0
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    indices = np.arange(len(buffer))
    final_loss = 0.0
    for ep in range(epochs):
        np.random.shuffle(indices)
        total_loss = 0.0
        n_batches = 0
        for start in range(0, len(indices), batch_size):
            batch_idx = indices[start:start + batch_size]
            obs = np.stack([buffer.samples[i].obs for i in batch_idx])
            regrets = np.stack([buffer.samples[i].regrets for i in batch_idx])
            masks = np.stack([buffer.samples[i].legal_mask for i in batch_idx])
            weights = np.array([buffer.samples[i].iter_t for i in batch_idx], dtype=np.float32)
            x = torch.from_numpy(obs).float()
            y = torch.from_numpy(regrets).float()
            mask = torch.from_numpy(masks).float()
            w = torch.from_numpy(weights).float().unsqueeze(1)
            pred = net(x)
            # MSE solo su azioni legali, weighted by iter_t (linear CFR)
            loss = ((pred - y) ** 2 * mask * w).sum() / (mask.sum() + 1e-8)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
            total_loss += loss.item()
            n_batches += 1
        final_loss = total_loss / max(1, n_batches)
    return final_loss


def train_strategy_net(
    net: StrategyNet,
    buffer: StrategyBuffer,
    epochs: int = 5,
    batch_size: int = 256,
    lr: float = 1e-3,
) -> float:
    """Train strategy net (cross-entropy verso target strategy)."""
    if len(buffer) == 0:
        return 0.0
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    indices = np.arange(len(buffer))
    final_loss = 0.0
    for ep in range(epochs):
        np.random.shuffle(indices)
        total_loss = 0.0
        n_batches = 0
        for start in range(0, len(indices), batch_size):
            batch_idx = indices[start:start + batch_size]
            obs = np.stack([buffer.samples[i].obs for i in batch_idx])
            target = np.stack([buffer.samples[i].strategy for i in batch_idx])
            masks = np.stack([buffer.samples[i].legal_mask for i in batch_idx])
            weights = np.array([buffer.samples[i].iter_t for i in batch_idx], dtype=np.float32)
            x = torch.from_numpy(obs).float()
            y = torch.from_numpy(target).float()
            mask = torch.from_numpy(masks).float()
            w = torch.from_numpy(weights).float().unsqueeze(1)
            logits = net(x)
            # Mask illegal: -inf
            masked_logits = logits.masked_fill(mask == 0, -1e9)
            log_p = F.log_softmax(masked_logits, dim=-1)
            # Cross entropy weighted
            loss = -(y * log_p * w).sum() / (mask.sum() + 1e-8)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
            total_loss += loss.item()
            n_batches += 1
        final_loss = total_loss / max(1, n_batches)
    return final_loss


# Smoke test
if __name__ == "__main__":
    print("[test] RegretNet")
    rnet = RegretNet()
    obs = np.random.randn(N_FEATURES).astype(np.float32)
    mask = np.zeros(MAX_ACTIONS, dtype=bool)
    mask[:5] = True
    r = rnet.predict_regret(obs, mask)
    s = rnet.predict_strategy(obs, mask)
    print(f"  Regret shape: {r.shape}, sum (legal only): {r[mask].sum():.3f}")
    print(f"  Strategy: {s[:5]}, sum: {s.sum():.3f}")

    print("\n[test] StrategyNet")
    snet = StrategyNet()
    s2 = snet.predict_strategy(obs, mask)
    print(f"  Strategy: {s2[:5]}, sum: {s2.sum():.3f}")

    print("\n[test] Buffers + train")
    rb = RegretBuffer(max_size=100)
    sb = StrategyBuffer(max_size=100)
    for i in range(50):
        rb.add(RegretSample(obs, np.random.randn(MAX_ACTIONS), mask, iter_t=i+1))
        sb.add(StrategySample(obs, s2, mask, iter_t=i+1))
    loss_r = train_regret_net(rnet, rb, epochs=2)
    loss_s = train_strategy_net(snet, sb, epochs=2)
    print(f"  RegretNet loss: {loss_r:.4f}, StrategyNet loss: {loss_s:.4f}")
    print("OK")
