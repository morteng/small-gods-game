/// <reference types="@webgpu/types" />
// src/render/ui/ui-pass.ts
//
// WebGPU edge of the UI layer (S1). The ONLY UI module that touches the device.
// Owns the quad pipeline, a 1×1 white texel (so `Solid` groups are tint-only),
// the per-group atlas bind groups, the viewport uniform, and a grow-on-demand
// vertex buffer. `record()` uploads + draws each `UiDrawGroup` into an already-
// open render pass (mirrors how `shape-geometry` draws inside the entity pass).
//
// Renders BOTH spaces. World-anchored groups (P5 semantic-zoom alert pins) are
// CPU-projected to device px in the runtime — the immediate-mode UI is rebuilt
// every frame from the live camera, so a pin tracks pan/zoom with no swim and
// stays pixel-snapped — so both spaces share this viewport→NDC vertex path; World
// groups just draw FIRST (beneath the screen HUD). Groups whose page has no atlas
// registered are skipped (only Solid exists in the gray-box build).

import { UI_WGSL } from '@/render/ui/wgsl/ui-wgsl';
import {
  UiPage,
  UiSpace,
  UI_VERTEX_STRIDE,
  type UiDrawGroup,
} from '@/render/ui/ui-batcher';

export class UiPass {
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private globalsBuf: GPUBuffer;
  private white: GPUTexture;
  /** page → atlas texture; Solid is the white texel. Bitmap/Msdf/Skin set later. */
  private atlases = new Map<UiPage, GPUTexture>();
  private bindCache = new Map<GPUTexture, GPUBindGroup>();
  private vbuf: GPUBuffer | null = null;
  private vcap = 0;

  constructor(private device: GPUDevice, format: GPUTextureFormat) {
    const module = device.createShaderModule({ code: UI_WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: UI_VERTEX_STRIDE,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // xy
              { shaderLocation: 1, offset: 8, format: 'float32x2' }, // uv
              { shaderLocation: 2, offset: 16, format: 'float32x4' }, // rgba
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      // no depthStencil: UI is painter-order (submission order), no depth test.
    });

    this.sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    this.globalsBuf = device.createBuffer({
      size: 16, // vec2 viewport + vec2 pad
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 1×1 opaque-white texel for Solid groups.
    this.white = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: this.white }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
    this.atlases.set(UiPage.Solid, this.white);
  }

  /** Register a glyph/skin atlas texture for a page (S2/S3/S3.5). */
  setAtlas(page: UiPage, tex: GPUTexture): void {
    this.atlases.set(page, tex);
    this.bindCache.delete(tex);
  }

  private bindFor(tex: GPUTexture): GPUBindGroup {
    let bg = this.bindCache.get(tex);
    if (!bg) {
      bg = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.globalsBuf } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: tex.createView() },
        ],
      });
      this.bindCache.set(tex, bg);
    }
    return bg;
  }

  private ensureVbuf(bytes: number): GPUBuffer {
    if (!this.vbuf || this.vcap < bytes) {
      this.vbuf?.destroy();
      this.vcap = Math.max(bytes, this.vcap * 2, 4096);
      this.vbuf = this.device.createBuffer({
        size: this.vcap,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    return this.vbuf;
  }

  /** Upload + draw all groups into an open render pass. World-anchored groups
   *  (already CPU-projected to device px) draw beneath the screen-space HUD. */
  record(pass: GPURenderPassEncoder, groups: readonly UiDrawGroup[], w: number, h: number): void {
    const hasAtlas = (g: UiDrawGroup) => this.atlases.has(g.page);
    // Painter order = submission order: World first (under), then Screen (over).
    // Filter (not sort) so each space keeps its own emission order.
    const drawable = [
      ...groups.filter((g) => g.space === UiSpace.World && hasAtlas(g)),
      ...groups.filter((g) => g.space === UiSpace.Screen && hasAtlas(g)),
    ];
    if (drawable.length === 0) return;

    this.device.queue.writeBuffer(this.globalsBuf, 0, new Float32Array([w, h, 0, 0]));

    const total = drawable.reduce((s, g) => s + g.vertices.byteLength, 0);
    const vbuf = this.ensureVbuf(total);
    pass.setPipeline(this.pipeline);

    let off = 0;
    for (const g of drawable) {
      this.device.queue.writeBuffer(vbuf, off, g.vertices as GPUAllowSharedBufferSource);
      pass.setBindGroup(0, this.bindFor(this.atlases.get(g.page)!));
      pass.setVertexBuffer(0, vbuf, off, g.vertices.byteLength);
      pass.draw(g.vertexCount);
      off += g.vertices.byteLength;
    }
  }
}
