"""Export student multi-matchup PyTorch model → ONNX per browser inference (TS+onnxruntime-web).

Sanity check: confronta output ONNX vs PyTorch su sample casuali.

Usage:
    python -m cfr.distill_export_onnx /tmp/student_multi_v2.pt --out /tmp/student_multi.onnx
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch

_THIS_DIR = Path(__file__).resolve().parent
_PYTHON_ROOT = _THIS_DIR.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))

from cfr.distill_multi_student import StudentMultiMLP, INPUT_DIM
from cfr.abstract_game import MAX_ACTIONS

DEVICE = torch.device("cpu")  # ONNX export su CPU per portability


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("student_path")
    ap.add_argument("--out", default="/tmp/student_multi.onnx")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    print(f"Loading {args.student_path}...", file=sys.stderr)
    ckpt = torch.load(args.student_path, map_location=DEVICE, weights_only=False)
    hidden = ckpt.get("hidden", 384)
    n_layers = ckpt.get("n_layers", 3)
    student = StudentMultiMLP(hidden=hidden, n_layers=n_layers).to(DEVICE)
    student.load_state_dict(ckpt["state_dict"])
    student.eval()

    n_params = sum(p.numel() for p in student.parameters())
    print(f"Student: hidden={hidden} n_layers={n_layers} params={n_params:,}", file=sys.stderr)

    # Forward signature: (obs, build_self, build_opp) → logits
    # Per ONNX export, traccio con un wrapper che concatena gli input
    class StudentForExport(torch.nn.Module):
        def __init__(self, m: StudentMultiMLP):
            super().__init__()
            self.m = m

        def forward(self, obs: torch.Tensor, build_self: torch.Tensor, build_opp: torch.Tensor):
            return self.m.forward(obs, build_self, build_opp)

    model = StudentForExport(student).to(DEVICE)
    model.eval()

    # Dummy inputs (batch=1)
    from cfr.build_features import BUILD_FEATURES_DIM
    from hex_tactics.ai.obs_features_v2 import N_FEATURES_TOTAL_V2
    dummy_obs = torch.randn(1, N_FEATURES_TOTAL_V2)
    dummy_bs = torch.randn(1, BUILD_FEATURES_DIM)
    dummy_bo = torch.randn(1, BUILD_FEATURES_DIM)

    out_path = Path(args.out)
    print(f"Exporting to {out_path} (opset={args.opset})...", file=sys.stderr)

    # torch 2.x: dynamo exporter è il default ma può produrre file troppo piccoli (esporta
    # solo il graph). Forzo legacy exporter con dynamo=False per includere i weights.
    torch.onnx.export(
        model,
        (dummy_obs, dummy_bs, dummy_bo),
        str(out_path),
        input_names=["obs", "build_self", "build_opp"],
        output_names=["logits"],
        dynamic_axes={
            "obs": {0: "batch"},
            "build_self": {0: "batch"},
            "build_opp": {0: "batch"},
            "logits": {0: "batch"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
        dynamo=False,
    )
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"Exported: {out_path} ({size_mb:.2f} MB)", file=sys.stderr)

    # Sanity check con ONNX Runtime se disponibile
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError:
        print("⚠ onnxruntime non installato, salto sanity check (pip install onnxruntime per validare)", file=sys.stderr)
        sys.exit(0)

    print("\nSanity check: ONNX vs PyTorch su 10 sample casuali...", file=sys.stderr)
    sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])

    rng = np.random.default_rng(42)
    max_abs_diff = 0.0
    for i in range(10):
        obs_np = rng.standard_normal((1, N_FEATURES_TOTAL_V2)).astype(np.float32)
        bs_np = rng.standard_normal((1, BUILD_FEATURES_DIM)).astype(np.float32)
        bo_np = rng.standard_normal((1, BUILD_FEATURES_DIM)).astype(np.float32)

        # PyTorch
        with torch.no_grad():
            pt_out = model(torch.from_numpy(obs_np), torch.from_numpy(bs_np), torch.from_numpy(bo_np)).numpy()

        # ONNX
        ox_out = sess.run(["logits"], {"obs": obs_np, "build_self": bs_np, "build_opp": bo_np})[0]

        diff = np.abs(pt_out - ox_out).max()
        max_abs_diff = max(max_abs_diff, diff)

    print(f"Max |PyTorch − ONNX| over 10 samples: {max_abs_diff:.6e}", file=sys.stderr)
    if max_abs_diff < 1e-4:
        print("✓ ONNX output matches PyTorch (eps < 1e-4)", file=sys.stderr)
    else:
        print(f"⚠ Differenza > 1e-4 — verifica export", file=sys.stderr)


if __name__ == "__main__":
    main()
