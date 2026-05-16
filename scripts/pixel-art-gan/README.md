# Pixel Art GAN — Small Gods

Conditional WGAN-GP that generates 16×16 pixel art sprites, trained on
[Kaggle's 89K pixel art dataset](https://www.kaggle.com/datasets/ebrahimelgazar/pixel-art)
(Apache 2.0). Final output: `generator_int8.onnx` (~2–4 MB) for ONNX Runtime Web.

## Quick Start

```bash
# 1. First-time setup: installs kaggle CLI and sets up your API token
./run.sh setup

# 2. Push training script to Kaggle + wait for GPU run + download model
./run.sh all
```

That's it. The trained model lands in `output/generator_int8.onnx`.

## Individual Commands

```bash
./run.sh setup     # install kaggle CLI, configure API token (~/.kaggle/kaggle.json)
./run.sh push      # push kernel to Kaggle and start GPU run
./run.sh status    # check if run is still running / complete / error
./run.sh wait      # block and poll until complete
./run.sh download  # download all output files (generator.onnx, checkpoints)
./run.sh all       # push + wait + download in one shot
```

## Files

| File | Purpose |
|------|---------|
| `train.py` | Conditional WGAN-GP training script (runs on Kaggle T4 GPU) |
| `kernel-metadata.json` | Kaggle kernel config (GPU on, pixel-art dataset linked) |
| `requirements.txt` | Extra pip deps installed on the Kaggle kernel |
| `run.sh` | Shell script for all CLI operations |
| `output/` | Created by `./run.sh download`, holds .onnx + .pt files |

## Model Details

| Spec | Value |
|------|-------|
| Architecture | Conditional WGAN-GP |
| Output resolution | 16×16 RGB |
| Classes | 13 sprite categories (from dataset labels) |
| Conditioning | Class embedding concatenated with latent vector |
| Latent dim | 128 |
| Generator params | ~2.7M |
| Training | 200 epochs, batch 256, T4 GPU (~2–3 hrs) |
| ONNX export | FP32 + INT8 quantized |
| INT8 size | ~2–4 MB |

## Using the Model (ONNX Runtime Web)

```ts
import * as ort from 'onnxruntime-web';

const session = await ort.InferenceSession.create('/models/generator_int8.onnx', {
  executionProviders: ['webgpu', 'wasm'],
});

// Generate a sprite for class 3
const latent = new Float32Array(128).map(() => Math.random() * 2 - 1); // ~N(0,1)
const label  = new BigInt64Array([3n]);

const feeds = {
  latent: new ort.Tensor('float32', latent, [1, 128]),
  label:  new ort.Tensor('int64',   label,  [1]),
};

const result = await session.run(feeds);
const pixels = result.image.data; // Float32Array, shape [1,3,16,16], range [-1,1]

// Convert to ImageData
const rgba = new Uint8ClampedArray(16 * 16 * 4);
for (let i = 0; i < 16 * 16; i++) {
  rgba[i * 4 + 0] = Math.round((pixels[i]            + 1) * 127.5); // R
  rgba[i * 4 + 1] = Math.round((pixels[i + 256]      + 1) * 127.5); // G
  rgba[i * 4 + 2] = Math.round((pixels[i + 512]      + 1) * 127.5); // B
  rgba[i * 4 + 3] = 255;
}
const imageData = new ImageData(rgba, 16, 16);
```

## Prerequisites

- Python 3.8+ and pip
- A [Kaggle account](https://www.kaggle.com) (free)
- Phone-verified Kaggle account (needed to unlock GPU quota)
