"""Esporta pesi MLP student → TS file con base64 embedded weights + inferenza pure JS.

Per build singlefile (GH Pages mobile): no onnxruntime-web, niente WASM.
Pesi salvati come base64 di Float32Array, inferenza scritta in JS puro.

Usage:
    python -m cfr.distill_export_jsweights /tmp/student_multi_small.pt --out /tmp/studentMlpWeights.ts
"""

from __future__ import annotations

import argparse
import base64
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("student_path")
    ap.add_argument("--out", default="/tmp/studentMlpWeights.ts")
    args = ap.parse_args()

    ckpt = torch.load(args.student_path, map_location="cpu", weights_only=False)
    hidden = ckpt.get("hidden", 256)
    n_layers = ckpt.get("n_layers", 3)
    student = StudentMultiMLP(hidden=hidden, n_layers=n_layers)
    student.load_state_dict(ckpt["state_dict"])
    student.eval()

    # Estrai pesi dei Linear in ordine
    layers: list[tuple[np.ndarray, np.ndarray]] = []
    sequential = student.net  # Sequential(Linear, ReLU, Linear, ReLU, ..., Linear)
    for module in sequential:
        if isinstance(module, torch.nn.Linear):
            w = module.weight.detach().cpu().numpy().astype(np.float32)  # (out, in)
            b = module.bias.detach().cpu().numpy().astype(np.float32)    # (out,)
            layers.append((w, b))

    n_params = sum(w.size + b.size for w, b in layers)
    print(f"Estratti {len(layers)} layer Linear, {n_params:,} params (~{n_params*4/1024:.1f} KB float32)", file=sys.stderr)

    # Concatena tutti i pesi in un singolo float32 buffer (layer dopo layer: w_i flatten, b_i)
    flat_chunks: list[np.ndarray] = []
    sizes: list[tuple[int, int]] = []  # (in_features, out_features) per layer
    for w, b in layers:
        out_feat, in_feat = w.shape
        sizes.append((in_feat, out_feat))
        flat_chunks.append(w.flatten())  # row-major: w[i,j] = w_flat[i*in + j]
        flat_chunks.append(b)
    flat = np.concatenate(flat_chunks).astype(np.float32)
    raw = flat.tobytes()
    b64 = base64.b64encode(raw).decode("ascii")
    print(f"Buffer raw: {len(raw)} bytes, base64: {len(b64)} chars", file=sys.stderr)

    # Genera TS
    out = []
    out.append("// AUTO-GENERATED — DO NOT EDIT BY HAND")
    out.append("// Generato da python/cfr/distill_export_jsweights.py")
    out.append(f"// Student MLP multi-matchup distilled (hidden={hidden}, n_layers={n_layers})")
    out.append(f"// Input: 231 (obs153 + build_self39 + build_opp39), Output: 24 logits")
    out.append("// Pesi inline base64 → niente onnxruntime, inferenza JS pura.")
    out.append("// Adatto per build singlefile / GitHub Pages mobile.")
    out.append("")
    out.append(f"export const STUDENT_INPUT_DIM = {INPUT_DIM};")
    out.append(f"export const STUDENT_OUTPUT_DIM = {MAX_ACTIONS};")
    out.append(f"const LAYER_SIZES: ReadonlyArray<readonly [number, number]> = [")
    for in_feat, out_feat in sizes:
        out.append(f"  [{in_feat}, {out_feat}],")
    out.append("] as const;")
    out.append("")
    out.append('const WEIGHTS_B64 = "' + b64 + '";')
    out.append("")
    out.append("// Decodifica base64 → Float32Array (lazy, una volta)")
    out.append("let _weights: Float32Array | null = null;")
    out.append("function getWeights(): Float32Array {")
    out.append("  if (_weights) return _weights;")
    out.append("  const bin = atob(WEIGHTS_B64);")
    out.append("  const bytes = new Uint8Array(bin.length);")
    out.append("  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);")
    out.append("  _weights = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);")
    out.append("  return _weights;")
    out.append("}")
    out.append("")
    out.append("/**")
    out.append(" * Inferenza forward pass MLP. Input deve essere lungo STUDENT_INPUT_DIM (231).")
    out.append(" * Ritorna logits (lunghezza STUDENT_OUTPUT_DIM, 24). ReLU su tutti i layer tranne l'ultimo.")
    out.append(" */")
    out.append("export function studentMlpForward(input: Float32Array | number[]): Float32Array {")
    out.append("  if (input.length !== STUDENT_INPUT_DIM) {")
    out.append("    throw new Error(`Input length mismatch: got ${input.length} expected ${STUDENT_INPUT_DIM}`);")
    out.append("  }")
    out.append("  const W = getWeights();")
    out.append("  let h: Float32Array = input instanceof Float32Array ? input : new Float32Array(input);")
    out.append("  let offset = 0;")
    out.append("  for (let l = 0; l < LAYER_SIZES.length; l++) {")
    out.append("    const [inSize, outSize] = LAYER_SIZES[l];")
    out.append("    // Layout pesi: w[out, in] flatten row-major → w_flat[i*inSize + j] = w[i, j]")
    out.append("    const wOff = offset;")
    out.append("    const bOff = wOff + inSize * outSize;")
    out.append("    const next = new Float32Array(outSize);")
    out.append("    for (let i = 0; i < outSize; i++) {")
    out.append("      let s = W[bOff + i];")
    out.append("      const rowBase = wOff + i * inSize;")
    out.append("      for (let j = 0; j < inSize; j++) s += h[j] * W[rowBase + j];")
    out.append("      // ReLU su layer intermedi (non l'ultimo)")
    out.append("      next[i] = l < LAYER_SIZES.length - 1 ? Math.max(0, s) : s;")
    out.append("    }")
    out.append("    h = next;")
    out.append("    offset = bOff + outSize;")
    out.append("  }")
    out.append("  return h;")
    out.append("}")
    out.append("")

    Path(args.out).write_text("\n".join(out))
    size_kb = Path(args.out).stat().st_size / 1024
    print(f"Wrote {args.out} ({size_kb:.1f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
