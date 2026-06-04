#!/usr/bin/env python3
"""
Bambata DJ — Demucs ONNX export script
Exports Demucs v3 (4-stem, time-domain, no STFT) to ONNX for browser use.

Model: mdx bag, model[0] — 89M parameters, float32, ~341 MB
Segment: 8s fixed (352800 samples @ 44100 Hz)
Compatible with onnxruntime-web WASM (all ops are standard float32).

Run once; produces demucs.onnx in the project root, then drag it into
the Bambata STEM SEPARATION panel.
"""

import sys, subprocess, os

def pip(*args):
    subprocess.run([sys.executable, '-m', 'pip', 'install', *args, '-q'], check=True)

# ── Dependencies ──────────────────────────────────────────────────────────────
print("Checking dependencies...")
for pkg in [('demucs', 'demucs'), ('onnx', 'onnx'), ('onnxruntime', 'onnxruntime')]:
    try:
        __import__(pkg[1])
    except ImportError:
        print(f"  Installing {pkg[0]}...")
        pip(pkg[0])

import torch
import onnx as onnx_lib
import onnxruntime

# ── Load model ────────────────────────────────────────────────────────────────
from demucs.pretrained import get_model

OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'demucs.onnx')

print("\nLoading Demucs mdx model (downloads ~400 MB of weights on first run)...")
bag = get_model('mdx')

# model[0] is the original time-domain Demucs v3 (no STFT — ONNX-exportable)
# model[2]/[3] are HDemucs variants that use STFT and cannot be exported
model = bag.models[0]
model.eval()

sr          = int(model.samplerate)          # 44100
seg_samples = 8 * sr                         # 352800  (8 seconds)
sources     = list(model.sources)            # ['drums','bass','other','vocals']
params      = sum(p.numel() for p in model.parameters())

print(f"  Architecture:    {type(model).__name__} (time-domain, no STFT)")
print(f"  Parameters:      {params/1e6:.0f}M")
print(f"  Sample rate:     {sr} Hz")
print(f"  Segment:         {seg_samples} samples  ({seg_samples/sr:.0f}s)")
print(f"  Sources:         {sources}")
print(f"  Output path:     {OUT_PATH}")

# ── ONNX export via dynamo ─────────────────────────────────────────────────
dummy = torch.zeros(1, 2, seg_samples)

print("\nExporting to ONNX (dynamo, ~1-3 min on CPU)...")
torch.onnx.export(
    model,
    dummy,
    OUT_PATH + '.tmp',
    dynamo=True,
)

# Inline the external weights file into a single .onnx file
print("Inlining weights into single file...")
m = onnx_lib.load(OUT_PATH + '.tmp')
onnx_lib.save(m, OUT_PATH, save_as_external_data=False)
try:
    os.remove(OUT_PATH + '.tmp')
    os.remove(OUT_PATH + '.tmp.data')
except FileNotFoundError:
    pass

# ── Validate ──────────────────────────────────────────────────────────────────
print("Validating with onnxruntime...")
sess = onnxruntime.InferenceSession(OUT_PATH)
import numpy as np
x = np.zeros((1, 2, seg_samples), dtype=np.float32)
out = sess.run(None, {sess.get_inputs()[0].name: x})
assert out[0].shape == (1, 4, 2, seg_samples), f"Unexpected shape: {out[0].shape}"

size_mb = os.path.getsize(OUT_PATH) / 1024**2
inp_name = sess.get_inputs()[0].name
out_name = sess.get_outputs()[0].name

print(f"\n✓  {OUT_PATH}")
print(f"   Size:    {size_mb:.0f} MB")
print(f"   Input:   {inp_name}  [1, 2, {seg_samples}]")
print(f"   Output:  {out_name}  [1, 4, 2, {seg_samples}]")
print(f"   Stems:   drums | bass | other | vocals")
print()
print("Next step:")
print("  1. Open http://localhost:5173")
print("  2. Click STEM SEPARATION → LOAD MODEL (.onnx)")
print(f"  3. Select: {OUT_PATH}")
print()
print("The model is cached in IndexedDB after first load — works fully offline.")
