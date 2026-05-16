"""
Unconditional WGAN-GP for pixel art sprite generation.
Trains on the Kaggle 89K pixel art dataset (Apache 2.0).
Outputs: generator.onnx (INT8 quantized, ~2-4MB)

Dataset path on Kaggle: /kaggle/input/pixel-art/
  images/images/  -- 89K JPEG images (16x16 pixel art)
"""

import os
import time
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
from PIL import Image

# ── Config ──────────────────────────────────────────────────────────────────

DEVICE     = torch.device("cuda" if torch.cuda.is_available() else "cpu")
IMG_SIZE   = 16
LATENT_DIM = 128
CHANNELS   = 64
BATCH_SIZE = 256
N_EPOCHS   = 200
N_CRITIC   = 5
GP_LAMBDA  = 10.0
LR         = 1e-4
BETAS      = (0.5, 0.9)
SAVE_EVERY = 25
OUT_DIR    = "/kaggle/working"

print(f"Device: {DEVICE}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")

# ── Data ─────────────────────────────────────────────────────────────────────

class PixelArtDataset(Dataset):
    def __init__(self, root: str):
        self.paths = [
            os.path.join(root, f)
            for f in os.listdir(root)
            if f.lower().endswith((".jpg", ".jpeg", ".png"))
        ]
        if not self.paths:
            raise RuntimeError(f"No images found in {root}")
        print(f"Found {len(self.paths)} images in {root}")

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        img = Image.open(self.paths[idx]).convert("RGB").resize(
            (IMG_SIZE, IMG_SIZE), Image.Resampling.NEAREST
        )
        x = torch.from_numpy(np.array(img)).float() / 127.5 - 1.0  # [-1, 1]
        return x.permute(2, 0, 1)  # (3, 16, 16)


def load_data():
    data_path = "/kaggle/input/pixel-art/images/images"
    dataset = PixelArtDataset(data_path)
    return DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=2,
        pin_memory=True,
        drop_last=True,
    )


# ── Generator ────────────────────────────────────────────────────────────────

class Generator(nn.Module):
    def __init__(self):
        super().__init__()
        self.project = nn.Sequential(
            nn.Linear(LATENT_DIM, CHANNELS * 8),
            nn.ReLU(True),
        )
        self.conv = nn.Sequential(
            nn.ConvTranspose2d(CHANNELS * 8, CHANNELS * 4, 4, 2, 1, bias=False),
            nn.BatchNorm2d(CHANNELS * 4), nn.ReLU(True),
            nn.ConvTranspose2d(CHANNELS * 4, CHANNELS * 2, 4, 2, 1, bias=False),
            nn.BatchNorm2d(CHANNELS * 2), nn.ReLU(True),
            nn.ConvTranspose2d(CHANNELS * 2, CHANNELS,     4, 2, 1, bias=False),
            nn.BatchNorm2d(CHANNELS),     nn.ReLU(True),
            nn.ConvTranspose2d(CHANNELS,     3,            4, 2, 1, bias=False),
            nn.Tanh(),
        )

    def forward(self, z):
        x = self.project(z).view(-1, CHANNELS * 8, 1, 1)
        return self.conv(x)


# ── Discriminator (Critic) ───────────────────────────────────────────────────

class Discriminator(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(3, CHANNELS,        4, 2, 1, bias=False), nn.LeakyReLU(0.2, True),
            nn.Conv2d(CHANNELS, CHANNELS*2, 4, 2, 1, bias=False), nn.LeakyReLU(0.2, True),
            nn.Conv2d(CHANNELS*2, CHANNELS*4, 4, 2, 1, bias=False), nn.LeakyReLU(0.2, True),
        )
        self.head = nn.Linear(CHANNELS * 4 * 2 * 2, 1)

    def forward(self, img):
        x = self.conv(img)
        return self.head(x.view(x.size(0), -1))


# ── Gradient Penalty ─────────────────────────────────────────────────────────

def gradient_penalty(critic, real, fake):
    B     = real.size(0)
    alpha = torch.rand(B, 1, 1, 1, device=DEVICE)
    interp = (alpha * real + (1 - alpha) * fake).requires_grad_(True)
    d_out  = critic(interp)
    grads  = torch.autograd.grad(
        d_out, interp,
        grad_outputs=torch.ones_like(d_out),
        create_graph=True, retain_graph=True,
    )[0].view(B, -1)
    return ((grads.norm(2, dim=1) - 1) ** 2).mean()


# ── Training Loop ─────────────────────────────────────────────────────────────

def train():
    loader = load_data()
    G = Generator().to(DEVICE)
    D = Discriminator().to(DEVICE)
    opt_G = optim.Adam(G.parameters(), lr=LR, betas=BETAS)
    opt_D = optim.Adam(D.parameters(), lr=LR, betas=BETAS)
    t0 = time.time()

    for epoch in range(1, N_EPOCHS + 1):
        G.train()
        D.train()
        g_losses, d_losses = [], []

        for real_imgs in loader:
            real_imgs = real_imgs.to(DEVICE)
            B = real_imgs.size(0)

            for _ in range(N_CRITIC):
                z    = torch.randn(B, LATENT_DIM, device=DEVICE)
                fake = G(z).detach()
                gp   = gradient_penalty(D, real_imgs, fake)
                d_loss = D(fake).mean() - D(real_imgs).mean() + GP_LAMBDA * gp
                opt_D.zero_grad()
                d_loss.backward()
                opt_D.step()
                d_losses.append(d_loss.item())

            z      = torch.randn(B, LATENT_DIM, device=DEVICE)
            g_loss = -D(G(z)).mean()
            opt_G.zero_grad()
            g_loss.backward()
            opt_G.step()
            g_losses.append(g_loss.item())

        elapsed = (time.time() - t0) / 60
        print(f"[{epoch:03d}/{N_EPOCHS}] D:{np.mean(d_losses):+.4f}  G:{np.mean(g_losses):+.4f}  ({elapsed:.1f}min)")

        if epoch % SAVE_EVERY == 0 or epoch == N_EPOCHS:
            torch.save(G.state_dict(), f"{OUT_DIR}/generator_epoch{epoch:03d}.pt")
            print(f"  Checkpoint saved: epoch {epoch}")

    export_onnx(G)
    print("Done.")


# ── ONNX Export ───────────────────────────────────────────────────────────────

def export_onnx(G):
    G.train(False)
    dummy_z = torch.randn(1, LATENT_DIM, device=DEVICE)

    onnx_path = f"{OUT_DIR}/generator.onnx"
    torch.onnx.export(
        G, dummy_z, onnx_path,
        input_names=["latent"],
        output_names=["image"],
        dynamic_axes={"latent": {0: "batch"}, "image": {0: "batch"}},
        opset_version=17,
    )
    print(f"ONNX exported: {onnx_path} ({os.path.getsize(onnx_path)/1e6:.1f} MB)")

    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        q_path = f"{OUT_DIR}/generator_int8.onnx"
        quantize_dynamic(onnx_path, q_path, weight_type=QuantType.QUInt8)
        print(f"INT8 quantized: {q_path} ({os.path.getsize(q_path)/1e6:.1f} MB)")
    except Exception as e:
        print(f"Quantization skipped: {e}")


if __name__ == "__main__":
    train()
