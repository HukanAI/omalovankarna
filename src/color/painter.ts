import type { Drawing } from '../engine/types';
import { paintDrawing } from '$lib/render';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Step {
  rect: Rect;
  before: ImageData;
  after: ImageData | null;
}

/** Maximální paměť pro historii kroků (bajty). */
const HISTORY_BUDGET = 160 * 1024 * 1024;

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Plátno pro vybarvování. Barva je ve vlastní vrstvě *pod* čarami,
 * takže čáry zůstávají vždy ostré a dítě je nemůže „přemalovat“.
 */
export class Painter {
  readonly w: number;
  readonly h: number;
  private color: CanvasRenderingContext2D;
  /** Kopie potvrzeného stavu – z ní se berou data „před“ pro krok zpět. */
  private shadow: OffscreenCanvasRenderingContext2D;
  private barrier: Uint8Array;
  private visited: Uint8Array;
  private grain: Float32Array;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private stroke: { pts: number[]; color: string; width: number; erase: boolean; rect: Rect } | null = null;
  onchange?: () => void;

  constructor(drawing: Drawing, longSide: number, colorCanvas: HTMLCanvasElement, lineCanvas: HTMLCanvasElement) {
    const s = longSide / Math.max(drawing.w, drawing.h);
    this.w = Math.round(drawing.w * s);
    this.h = Math.round(drawing.h * s);
    for (const c of [colorCanvas, lineCanvas]) {
      c.width = this.w;
      c.height = this.h;
    }
    this.color = colorCanvas.getContext('2d', { willReadFrequently: true })!;
    this.shadow = new OffscreenCanvas(this.w, this.h).getContext('2d', { willReadFrequently: true })!;

    const lines = lineCanvas.getContext('2d', { willReadFrequently: true })!;
    paintDrawing(lines, drawing, 0, 0, s);

    // Bariéra pro kyblík: čáry + 1 px rezerva, aby barva neprosákla škvírou v antialiasingu.
    const alpha = lines.getImageData(0, 0, this.w, this.h).data;
    const n = this.w * this.h;
    const raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) raw[i] = alpha[i * 4 + 3] > 90 ? 1 : 0;
    this.barrier = new Uint8Array(n);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        this.barrier[i] =
          raw[i] ||
          (x > 0 && raw[i - 1]) ||
          (x < this.w - 1 && raw[i + 1]) ||
          (y > 0 && raw[i - this.w]) ||
          (y < this.h - 1 && raw[i + this.w])
            ? 1
            : 0;
      }
    }
    this.visited = new Uint8Array(n);

    // Zrno pastelky: jemná nepravidelnost jasu, ať plochy nevypadají jako z tiskárny.
    this.grain = new Float32Array(128 * 128);
    let seed = 7;
    for (let i = 0; i < this.grain.length; i++) {
      seed = (seed * 16807) % 2147483647;
      this.grain[i] = (seed / 2147483647) * 0.07;
    }
  }

  async load(colored: Blob | null): Promise<void> {
    if (!colored) return;
    const bmp = await createImageBitmap(colored);
    this.color.drawImage(bmp, 0, 0, this.w, this.h);
    this.shadow.drawImage(bmp, 0, 0, this.w, this.h);
    bmp.close();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get isEmpty(): boolean {
    return this.undoStack.length === 0;
  }

  // ——— Kyblík ———

  /** Vyplní uzavřenou plochu. Vrací false, pokud se trefilo mimo plochu. */
  fill(px: number, py: number, hex: string): boolean {
    let x = Math.round(px);
    let y = Math.round(py);
    const { w, h, barrier } = this;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (barrier[y * w + x]) {
      // Klepnutí na čáru: najdeme nejbližší volný bod.
      const near = this.nearestFree(x, y, Math.round(Math.max(w, h) * 0.012));
      if (!near) return false;
      [x, y] = near;
    }
    const visited = this.visited;
    visited.fill(0);
    let minX = x;
    let maxX = x;
    let minY = y;
    let maxY = y;
    const stack: number[] = [x, y];
    while (stack.length) {
      const sy = stack.pop()!;
      const sx = stack.pop()!;
      let l = sx;
      const row = sy * w;
      if (visited[row + l] || barrier[row + l]) continue;
      while (l > 0 && !barrier[row + l - 1] && !visited[row + l - 1]) l--;
      let r = sx;
      while (r < w - 1 && !barrier[row + r + 1] && !visited[row + r + 1]) r++;
      for (let i = l; i <= r; i++) visited[row + i] = 1;
      if (l < minX) minX = l;
      if (r > maxX) maxX = r;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
      for (const ny of [sy - 1, sy + 1]) {
        if (ny < 0 || ny >= h) continue;
        const nrow = ny * w;
        let inRun = false;
        for (let i = l; i <= r; i++) {
          const free = !barrier[nrow + i] && !visited[nrow + i];
          if (free && !inRun) {
            stack.push(i, ny);
            inRun = true;
          } else if (!free) inRun = false;
        }
      }
    }

    // Plochu rozšíříme o 3 px pod čáry – mezi barvou a čárou nezůstane bílý lem.
    const grow = 3;
    const rect = {
      x: Math.max(0, minX - grow),
      y: Math.max(0, minY - grow),
      w: Math.min(w, maxX + grow + 1) - Math.max(0, minX - grow),
      h: Math.min(h, maxY + grow + 1) - Math.max(0, minY - grow),
    };
    for (let g = 0; g < grow; g++) {
      // Soused se počítá, jen pokud byl vyplněný už před tímto kolem (hodnota < 2 + g).
      const was = (i: number) => visited[i] !== 0 && visited[i] < 2 + g;
      for (let yy = rect.y; yy < rect.y + rect.h; yy++) {
        for (let xx = rect.x; xx < rect.x + rect.w; xx++) {
          const i = yy * w + xx;
          if (visited[i] || !barrier[i]) continue;
          if ((xx > 0 && was(i - 1)) || (xx < w - 1 && was(i + 1)) || (yy > 0 && was(i - w)) || (yy < h - 1 && was(i + w))) {
            visited[i] = 2 + g;
          }
        }
      }
    }

    const before = this.color.getImageData(rect.x, rect.y, rect.w, rect.h);
    const out = new ImageData(new Uint8ClampedArray(before.data), rect.w, rect.h);
    const [cr, cg, cb] = hexToRgb(hex);
    const d = out.data;
    for (let yy = 0; yy < rect.h; yy++) {
      for (let xx = 0; xx < rect.w; xx++) {
        const gx = rect.x + xx;
        const gy = rect.y + yy;
        if (!visited[gy * w + gx]) continue;
        const k = 1 - this.grain[(gy & 127) * 128 + (gx & 127)];
        const o = (yy * rect.w + xx) * 4;
        d[o] = cr * k;
        d[o + 1] = cg * k;
        d[o + 2] = cb * k;
        d[o + 3] = 255;
      }
    }
    this.color.putImageData(out, rect.x, rect.y);
    this.commit(rect, before);
    return true;
  }

  private nearestFree(x: number, y: number, radius: number): [number, number] | null {
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < this.w && ny < this.h && !this.barrier[ny * this.w + nx]) return [nx, ny];
        }
      }
    }
    return null;
  }

  // ——— Pastelka a guma ———

  beginStroke(x: number, y: number, hex: string, width: number, erase: boolean, pressure = 0.5): void {
    this.stroke = { pts: [x, y, pressure], color: hex, width, erase, rect: { x, y, w: 0, h: 0 } };
    this.segment(x, y, x, y, pressure);
  }

  extendStroke(x: number, y: number, pressure = 0.5): void {
    const s = this.stroke;
    if (!s) return;
    const n = s.pts.length;
    const lx = s.pts[n - 3];
    const ly = s.pts[n - 2];
    if (Math.hypot(x - lx, y - ly) < 1.2) return;
    s.pts.push(x, y, pressure);
    this.segment(lx, ly, x, y, pressure);
  }

  private segment(x0: number, y0: number, x1: number, y1: number, pressure: number) {
    const s = this.stroke!;
    const ctx = this.color;
    const width = s.width * (0.65 + 0.7 * Math.min(1, Math.max(0, pressure || 0.5)));
    ctx.save();
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = s.erase ? 1 : 0.92;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
    const pad = width;
    const r = s.rect;
    const nx = Math.min(r.w ? r.x : x0, x0, x1) - pad;
    const ny = Math.min(r.h ? r.y : y0, y0, y1) - pad;
    const mx = Math.max(r.w ? r.x + r.w : x0, x0, x1) + pad;
    const my = Math.max(r.h ? r.y + r.h : y0, y0, y1) + pad;
    s.rect = { x: nx, y: ny, w: mx - nx, h: my - ny };
  }

  endStroke(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const rect = this.clamp(s.rect);
    if (!rect) return;
    const before = this.shadow.getImageData(rect.x, rect.y, rect.w, rect.h);
    this.commit(rect, before);
  }

  /** Zruší rozpracovaný tah (např. když se místo kreslení začne přibližovat dvěma prsty). */
  cancelStroke(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    const rect = this.clamp(s.rect);
    if (rect) this.color.putImageData(this.shadow.getImageData(rect.x, rect.y, rect.w, rect.h), rect.x, rect.y);
  }

  private clamp(r: Rect): Rect | null {
    const x = Math.max(0, Math.floor(r.x));
    const y = Math.max(0, Math.floor(r.y));
    const w = Math.min(this.w, Math.ceil(r.x + r.w)) - x;
    const h = Math.min(this.h, Math.ceil(r.y + r.h)) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  // ——— Historie ———

  private commit(rect: Rect, before: ImageData) {
    this.undoStack.push({ rect, before, after: null });
    this.redoStack = [];
    this.syncShadow(rect);
    let bytes = this.undoStack.reduce((a, s) => a + s.before.data.length, 0);
    while (bytes > HISTORY_BUDGET && this.undoStack.length > 1) bytes -= this.undoStack.shift()!.before.data.length;
    this.onchange?.();
  }

  private syncShadow(r: Rect) {
    this.shadow.clearRect(r.x, r.y, r.w, r.h);
    this.shadow.drawImage(this.color.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    const { rect } = step;
    step.after = this.color.getImageData(rect.x, rect.y, rect.w, rect.h);
    this.color.putImageData(step.before, rect.x, rect.y);
    this.syncShadow(rect);
    this.redoStack.push(step);
    this.onchange?.();
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step || !step.after) return;
    const { rect } = step;
    this.color.putImageData(step.after, rect.x, rect.y);
    this.syncShadow(rect);
    this.undoStack.push(step);
    this.onchange?.();
  }

  /** Vybarvená vrstva jako PNG (průhledná tam, kde se nekreslilo). */
  async export(): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.color.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export vrstvy selhal.'))), 'image/png'),
    );
  }
}
