/**
 * 柔光擴散（bloom）：把已畫好的發光盤面縮小成兩層低解析度圖，再以加法混色放大疊回，
 * 縮放時的平滑會自然糊成光暈。成本很低（只是幾次 drawImage），不需要 shader，
 * 也不依賴 ctx.filter（Safari 不支援）。
 */
export class Bloom {
  private c1: HTMLCanvasElement | null = null;
  private c2: HTMLCanvasElement | null = null;

  private ensure(w: number, h: number): void {
    const w1 = Math.max(2, Math.round(w / 4));
    const h1 = Math.max(2, Math.round(h / 4));
    const w2 = Math.max(2, Math.round(w / 16));
    const h2 = Math.max(2, Math.round(h / 16));
    if (!this.c1) this.c1 = document.createElement("canvas");
    if (!this.c2) this.c2 = document.createElement("canvas");
    if (this.c1.width !== w1 || this.c1.height !== h1) {
      this.c1.width = w1;
      this.c1.height = h1;
    }
    if (this.c2.width !== w2 || this.c2.height !== h2) {
      this.c2.width = w2;
      this.c2.height = h2;
    }
  }

  /** 對 target（及其 2D 繪圖環境）疊加光暈；strength 為整體強度 */
  apply(target: HTMLCanvasElement, ctx: CanvasRenderingContext2D, strength = 1): void {
    this.ensure(target.width, target.height);
    const c1 = this.c1!;
    const c2 = this.c2!;
    const x1 = c1.getContext("2d");
    const x2 = c2.getContext("2d");
    if (!x1 || !x2) return;
    x1.imageSmoothingEnabled = true;
    x1.imageSmoothingQuality = "high";
    x2.imageSmoothingEnabled = true;
    x2.imageSmoothingQuality = "high";
    x1.clearRect(0, 0, c1.width, c1.height);
    x1.drawImage(target, 0, 0, c1.width, c1.height);
    x2.clearRect(0, 0, c2.width, c2.height);
    x2.drawImage(c1, 0, 0, c2.width, c2.height);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = Math.min(1, 0.7 * strength);
    ctx.drawImage(c1, 0, 0, target.width, target.height);
    ctx.globalAlpha = Math.min(1, 0.9 * strength);
    ctx.drawImage(c2, 0, 0, target.width, target.height);
    ctx.restore();
  }
}
