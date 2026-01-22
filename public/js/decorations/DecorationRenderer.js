/**
 * DecorationRenderer - Renders decorations from primitive definitions
 *
 * Supports: rect, circle, ellipse, triangle, path, line, arc, quadCurve
 * Uses seed-based RNG for consistent procedural variation
 */

(function(global) {
  'use strict';

  /**
   * Seeded random number generator (mulberry32)
   */
  class SeededRandom {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.state = seed >>> 0;
    }

    next() {
      let t = this.state += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    // Random int in range [min, max]
    range(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    }

    // Random float in range [min, max]
    rangeFloat(min, max) {
      return this.next() * (max - min) + min;
    }

    // Pick from array
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }

    // Shuffle array (Fisher-Yates)
    shuffle(arr) {
      const result = [...arr];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    }
  }

  /**
   * Color utility functions
   */
  const ColorUtils = {
    hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 0, g: 0, b: 0 };
    },

    rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(x => {
        const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }).join('');
    },

    darken(hex, amount) {
      const { r, g, b } = this.hexToRgb(hex);
      const factor = 1 - amount;
      return this.rgbToHex(r * factor, g * factor, b * factor);
    },

    lighten(hex, amount) {
      const { r, g, b } = this.hexToRgb(hex);
      return this.rgbToHex(
        r + (255 - r) * amount,
        g + (255 - g) * amount,
        b + (255 - b) * amount
      );
    },

    // Shift hue in HSL space
    shiftHue(hex, degrees) {
      const { r, g, b } = this.hexToRgb(hex);

      // RGB to HSL
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
          case gn: h = ((bn - rn) / d + 2) / 6; break;
          case bn: h = ((rn - gn) / d + 4) / 6; break;
        }
      }

      // Shift hue
      h = (h + degrees / 360 + 1) % 1;

      // HSL to RGB
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      let r2, g2, b2;
      if (s === 0) {
        r2 = g2 = b2 = l;
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r2 = hue2rgb(p, q, h + 1/3);
        g2 = hue2rgb(p, q, h);
        b2 = hue2rgb(p, q, h - 1/3);
      }

      return this.rgbToHex(r2 * 255, g2 * 255, b2 * 255);
    }
  };

  /**
   * DecorationRenderer - Main renderer class
   */
  const DecorationRenderer = {
    /**
     * Render a decoration instance
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} instance - Decoration instance {id, seed, offsetX, offsetY}
     * @param {number} x - Center X position
     * @param {number} y - Anchor Y position (bottom of decoration)
     * @param {number} tileWidth - Tile width for scaling
     */
    render(ctx, instance, x, y, tileWidth) {
      const def = global.DecorationRegistry?.get(instance.id);
      if (!def || !def.drawing) {
        console.warn(`DecorationRenderer: No drawing data for "${instance.id}"`);
        return;
      }

      const rng = new SeededRandom(instance.seed || 0);
      const scale = tileWidth / 32; // Base scale (32px default tile width)

      // Apply instance offset
      const ox = (instance.offsetX || 0) * scale;
      const oy = (instance.offsetY || 0) * scale;

      // Render each layer
      const drawing = def.drawing;
      const palettes = drawing.palettes || {};

      ctx.save();
      ctx.translate(x + ox, y + oy);

      for (const layer of drawing.layers) {
        this._renderLayer(ctx, layer, scale, rng, palettes, drawing.variants);
      }

      ctx.restore();
    },

    /**
     * Render a single layer/primitive
     */
    _renderLayer(ctx, layer, scale, rng, palettes, variants) {
      // Handle conditional layers
      if (layer.condition) {
        const { type, probability } = layer.condition;
        if (type === 'random' && rng.next() > probability) {
          return; // Skip this layer
        }
      }

      // Handle variant selection
      if (layer.variant && variants) {
        const variantDef = variants[layer.variant];
        if (variantDef) {
          const selectedVariant = rng.pick(variantDef);
          // Render all layers in the variant
          for (const varLayer of selectedVariant.layers) {
            this._renderLayer(ctx, varLayer, scale, rng, palettes, variants);
          }
          return;
        }
      }

      // Handle repeat (for things like multiple flowers)
      if (layer.repeat) {
        const count = typeof layer.repeat === 'object'
          ? rng.range(layer.repeat.min, layer.repeat.max)
          : layer.repeat;

        for (let i = 0; i < count; i++) {
          const repeatLayer = { ...layer, repeat: undefined };
          // Apply scatter if defined
          if (layer.scatter) {
            repeatLayer.x = (layer.x || 0) + rng.rangeFloat(-layer.scatter.x, layer.scatter.x);
            repeatLayer.y = (layer.y || 0) + rng.rangeFloat(-layer.scatter.y, layer.scatter.y);
          }
          this._renderLayer(ctx, repeatLayer, scale, rng, palettes, variants);
        }
        return;
      }

      // Resolve color
      const color = this._resolveColor(layer.color, palettes, rng);

      // Apply variance to properties
      const props = this._applyVariance(layer, rng, scale);

      // Render based on type
      switch (layer.type) {
        case 'rect':
          this._drawRect(ctx, props, color, scale);
          break;
        case 'circle':
          this._drawCircle(ctx, props, color, scale);
          break;
        case 'ellipse':
          this._drawEllipse(ctx, props, color, scale);
          break;
        case 'triangle':
          this._drawTriangle(ctx, props, color, scale);
          break;
        case 'path':
          this._drawPath(ctx, props, color, scale);
          break;
        case 'line':
          this._drawLine(ctx, props, color, scale);
          break;
        case 'arc':
          this._drawArc(ctx, props, color, scale);
          break;
        case 'quadCurve':
          this._drawQuadCurve(ctx, props, color, scale);
          break;
        case 'polygon':
          this._drawPolygon(ctx, props, color, scale);
          break;
        case 'group':
          if (props.layers) {
            ctx.save();
            ctx.translate((props.x || 0) * scale, (props.y || 0) * scale);
            for (const subLayer of props.layers) {
              this._renderLayer(ctx, subLayer, scale, rng, palettes, variants);
            }
            ctx.restore();
          }
          break;
      }
    },

    /**
     * Resolve color from palette or direct value
     */
    _resolveColor(colorDef, palettes, rng) {
      if (!colorDef) return '#000000';
      if (typeof colorDef === 'string') return colorDef;

      if (colorDef.palette && palettes[colorDef.palette]) {
        const palette = palettes[colorDef.palette];
        const index = colorDef.index !== undefined
          ? colorDef.index
          : (colorDef.random ? rng.range(0, palette.length - 1) : 0);
        let color = palette[index % palette.length];

        // Apply modifiers
        if (colorDef.darken) color = ColorUtils.darken(color, colorDef.darken);
        if (colorDef.lighten) color = ColorUtils.lighten(color, colorDef.lighten);
        if (colorDef.hueShift) color = ColorUtils.shiftHue(color, colorDef.hueShift);

        return color;
      }

      return colorDef.hex || '#000000';
    },

    /**
     * Apply variance to layer properties
     */
    _applyVariance(layer, rng, scale) {
      const props = { ...layer };
      const variance = layer.variance;

      if (variance) {
        for (const [key, range] of Object.entries(variance)) {
          if (props[key] !== undefined) {
            if (Array.isArray(range)) {
              props[key] += rng.rangeFloat(range[0], range[1]);
            } else if (typeof range === 'object') {
              props[key] += rng.rangeFloat(range.min, range.max);
            }
          }
        }
      }

      return props;
    },

    /**
     * Primitive drawing functions
     */
    _drawRect(ctx, props, color, scale) {
      const x = (props.x || 0) * scale;
      const y = (props.y || 0) * scale;
      const w = (props.width || 10) * scale;
      const h = (props.height || 10) * scale;

      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);

      if (props.stroke) {
        ctx.strokeStyle = props.strokeColor || ColorUtils.darken(color, 0.2);
        ctx.lineWidth = (props.strokeWidth || 1) * scale;
        ctx.strokeRect(x, y, w, h);
      }

      // Draw shadow side if specified
      if (props.shadow) {
        const shadowColor = ColorUtils.darken(color, props.shadow.amount || 0.2);
        ctx.fillStyle = shadowColor;
        if (props.shadow.side === 'right') {
          const sw = (props.shadow.width || 2) * scale;
          ctx.fillRect(x + w - sw, y, sw, h);
        } else if (props.shadow.side === 'bottom') {
          const sh = (props.shadow.height || 2) * scale;
          ctx.fillRect(x, y + h - sh, w, sh);
        }
      }
    },

    _drawCircle(ctx, props, color, scale) {
      const x = (props.x || 0) * scale;
      const y = (props.y || 0) * scale;
      const r = (props.r || 5) * scale;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (props.stroke) {
        ctx.strokeStyle = props.strokeColor || ColorUtils.darken(color, 0.2);
        ctx.lineWidth = (props.strokeWidth || 1) * scale;
        ctx.stroke();
      }

      // Highlight
      if (props.highlight) {
        const hColor = ColorUtils.lighten(color, props.highlight.amount || 0.3);
        const hx = x + (props.highlight.offsetX || -2) * scale;
        const hy = y + (props.highlight.offsetY || -2) * scale;
        const hr = r * (props.highlight.scale || 0.3);
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, Math.PI * 2);
        ctx.fillStyle = hColor;
        ctx.fill();
      }
    },

    _drawEllipse(ctx, props, color, scale) {
      const x = (props.x || 0) * scale;
      const y = (props.y || 0) * scale;
      const rx = (props.rx || 5) * scale;
      const ry = (props.ry || 3) * scale;
      const rotation = props.rotation || 0;

      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rotation * Math.PI / 180, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (props.stroke) {
        ctx.strokeStyle = props.strokeColor || ColorUtils.darken(color, 0.2);
        ctx.lineWidth = (props.strokeWidth || 1) * scale;
        ctx.stroke();
      }

      // Highlight
      if (props.highlight) {
        const hColor = ColorUtils.lighten(color, props.highlight.amount || 0.3);
        const hx = x + (props.highlight.offsetX || -1) * scale;
        const hy = y + (props.highlight.offsetY || -1) * scale;
        const hrx = rx * (props.highlight.scale || 0.3);
        const hry = ry * (props.highlight.scale || 0.3);
        ctx.beginPath();
        ctx.ellipse(hx, hy, hrx, hry, rotation * Math.PI / 180, 0, Math.PI * 2);
        ctx.fillStyle = hColor;
        ctx.fill();
      }
    },

    _drawTriangle(ctx, props, color, scale) {
      const x = (props.x || 0) * scale;
      const y = (props.y || 0) * scale;
      const w = (props.width || 10) * scale;
      const h = (props.height || 10) * scale;

      ctx.beginPath();
      ctx.moveTo(x, y); // Top point
      ctx.lineTo(x - w / 2, y + h); // Bottom left
      ctx.lineTo(x + w / 2, y + h); // Bottom right
      ctx.closePath();

      ctx.fillStyle = color;
      ctx.fill();

      // Shaded side
      if (props.shade) {
        const shadeColor = ColorUtils.darken(color, props.shade.amount || 0.15);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fillStyle = shadeColor;
        ctx.fill();
      }

      if (props.stroke) {
        ctx.strokeStyle = props.strokeColor || ColorUtils.darken(color, 0.2);
        ctx.lineWidth = (props.strokeWidth || 1) * scale;
        ctx.stroke();
      }
    },

    _drawPath(ctx, props, color, scale) {
      if (!props.points || props.points.length < 2) return;

      ctx.beginPath();
      const firstPt = props.points[0];
      ctx.moveTo(firstPt.x * scale, firstPt.y * scale);

      for (let i = 1; i < props.points.length; i++) {
        const pt = props.points[i];
        if (pt.cp1) {
          // Bezier curve
          ctx.bezierCurveTo(
            pt.cp1.x * scale, pt.cp1.y * scale,
            pt.cp2.x * scale, pt.cp2.y * scale,
            pt.x * scale, pt.y * scale
          );
        } else if (pt.cp) {
          // Quadratic curve
          ctx.quadraticCurveTo(pt.cp.x * scale, pt.cp.y * scale, pt.x * scale, pt.y * scale);
        } else {
          ctx.lineTo(pt.x * scale, pt.y * scale);
        }
      }

      if (props.closed) ctx.closePath();

      if (props.fill !== false) {
        ctx.fillStyle = color;
        ctx.fill();
      }

      if (props.stroke || props.fill === false) {
        ctx.strokeStyle = props.strokeColor || color;
        ctx.lineWidth = (props.strokeWidth || 1) * scale;
        ctx.lineCap = props.lineCap || 'round';
        ctx.stroke();
      }
    },

    _drawLine(ctx, props, color, scale) {
      const x1 = (props.x1 || 0) * scale;
      const y1 = (props.y1 || 0) * scale;
      const x2 = (props.x2 || 0) * scale;
      const y2 = (props.y2 || 0) * scale;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      ctx.strokeStyle = color;
      ctx.lineWidth = (props.width || 1) * scale;
      ctx.lineCap = props.lineCap || 'round';
      ctx.stroke();
    },

    _drawArc(ctx, props, color, scale) {
      const x = (props.x || 0) * scale;
      const y = (props.y || 0) * scale;
      const r = (props.r || 5) * scale;
      const startAngle = (props.startAngle || 0) * Math.PI / 180;
      const endAngle = (props.endAngle || 180) * Math.PI / 180;

      ctx.beginPath();
      ctx.arc(x, y, r, startAngle, endAngle);

      if (props.fill) {
        ctx.fillStyle = color;
        ctx.fill();
      }

      ctx.strokeStyle = props.strokeColor || color;
      ctx.lineWidth = (props.width || 1) * scale;
      ctx.lineCap = props.lineCap || 'round';
      ctx.stroke();
    },

    _drawQuadCurve(ctx, props, color, scale) {
      const x1 = (props.x1 || 0) * scale;
      const y1 = (props.y1 || 0) * scale;
      const cpx = (props.cpx || 0) * scale;
      const cpy = (props.cpy || 0) * scale;
      const x2 = (props.x2 || 0) * scale;
      const y2 = (props.y2 || 0) * scale;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cpx, cpy, x2, y2);

      ctx.strokeStyle = color;
      ctx.lineWidth = (props.width || 1) * scale;
      ctx.lineCap = props.lineCap || 'round';
      ctx.stroke();
    },

    _drawPolygon(ctx, props, color, scale) {
      if (!props.points || props.points.length < 3) return;

      ctx.beginPath();
      ctx.moveTo(props.points[0].x * scale, props.points[0].y * scale);
      for (let i = 1; i < props.points.length; i++) {
        ctx.lineTo(props.points[i].x * scale, props.points[i].y * scale);
      }
      ctx.closePath();

      ctx.fillStyle = color;
      ctx.fill();

      if (props.stroke) {
        ctx.strokeStyle = props.strokeColor || ColorUtils.darken(color, 0.2);
        ctx.lineWidth = (props.strokeWidth || 1) * scale;
        ctx.stroke();
      }
    },

    /**
     * Render segmentation shape for a decoration
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Object} instance - Decoration instance
     * @param {number} x - Center X position
     * @param {number} y - Anchor Y position
     * @param {number} tw - Tile width
     * @param {number} th - Tile height
     */
    renderSegmentation(ctx, instance, x, y, tw, th) {
      const def = global.DecorationRegistry?.get(instance.id);
      if (!def || !def.segmentation) return;

      const seg = def.segmentation;
      const color = seg.color;
      const extent = seg.extent || { width: 0.5, heightAbove: 16 };

      // Calculate dimensions
      const rng = new SeededRandom(instance.seed || 0);
      let heightAbove = extent.heightAbove;

      // Apply variance to height if specified
      if (extent.heightVariance) {
        heightAbove += rng.rangeFloat(extent.heightVariance[0], extent.heightVariance[1]);
      }

      const width = tw * extent.width;
      const height = heightAbove;

      // Draw as rectangle extending upward from anchor
      ctx.fillStyle = color;
      ctx.fillRect(x - width / 2, y - height, width, height);
    },

    /**
     * Get the extent (bounding box) of a decoration
     * @param {Object} instance - Decoration instance
     * @returns {Object} {width, height, offsetY}
     */
    getExtent(instance) {
      const def = global.DecorationRegistry?.get(instance.id);
      if (!def) return { width: 0, height: 0, offsetY: 0 };

      if (def.segmentation && def.segmentation.extent) {
        const ext = def.segmentation.extent;
        const rng = new SeededRandom(instance.seed || 0);
        let h = ext.heightAbove || 16;
        if (ext.heightVariance) {
          h += rng.rangeFloat(ext.heightVariance[0], ext.heightVariance[1]);
        }
        return {
          width: (ext.width || 0.5) * 32,
          height: h,
          offsetY: 0
        };
      }

      return { width: 16, height: 16, offsetY: 0 };
    }
  };

  // Expose utilities
  DecorationRenderer.SeededRandom = SeededRandom;
  DecorationRenderer.ColorUtils = ColorUtils;

  // Expose globally
  global.DecorationRenderer = DecorationRenderer;

})(typeof window !== 'undefined' ? window : global);
