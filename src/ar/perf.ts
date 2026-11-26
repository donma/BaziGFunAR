/**
 * 自動效能調整（規格 12）：
 * - 以實測訊號（推論耗時、畫面幀率）調整辨識頻率、輸入解析度、同時追蹤數。
 * - 四個等級；負載升高降級，穩定後回升；不可假定可讀取手機溫度。
 * - 不提供給一般使用者的效能設定 UI。
 */

export interface PerfLevel {
  id: 0 | 1 | 2 | 3;
  /** 語意辨識間隔（ms） */
  detectIntervalMs: number;
  /** 辨識輸入寬度（px；等比縮放） */
  inputWidth: number;
  /** 同時追蹤上限 */
  maxTracks: number;
  /** 幾何候選每 N 次語意辨識跑一次 */
  geometricEvery: number;
}

export const PERF_LEVELS: PerfLevel[] = [
  { id: 0, detectIntervalMs: 900, inputWidth: 320, maxTracks: 6, geometricEvery: 3 },
  { id: 1, detectIntervalMs: 1400, inputWidth: 256, maxTracks: 5, geometricEvery: 4 },
  { id: 2, detectIntervalMs: 2200, inputWidth: 192, maxTracks: 4, geometricEvery: 5 },
  { id: 3, detectIntervalMs: 3400, inputWidth: 160, maxTracks: 3, geometricEvery: 8 },
];

export interface PerfSignals {
  /** 本輪推論耗時（ms） */
  inferenceMs: number | null;
  /** 近期 rAF 幀率中位數 */
  fpsMedian: number | null;
}

export interface PerfGovernorOptions {
  /** 推論超過此值（ms）視為負載高 */
  slowInferenceMs?: number;
  /** 幀率低於此值視為卡頓 */
  lowFps?: number;
  /** 恢復條件需連續穩定的時間（ms） */
  recoverMs?: number;
  now?: () => number;
}

export const PERF_DEFAULTS: Required<Omit<PerfGovernorOptions, "now">> = {
  slowInferenceMs: 260,
  lowFps: 17,
  recoverMs: 45000,
};

/**
 * 單調等級調整器：負載高 → 立即降一級；持續穩定 recoverMs → 升一級。
 * 純邏輯（時間由 now 注入），可完整單元測試。
 */
export class PerfGovernor {
  private level = 0;
  private stableSince: number | null = null;
  private opts: Required<Omit<PerfGovernorOptions, "now">>;
  private now: () => number;

  constructor(opts: PerfGovernorOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.opts = {
      slowInferenceMs: opts.slowInferenceMs ?? PERF_DEFAULTS.slowInferenceMs,
      lowFps: opts.lowFps ?? PERF_DEFAULTS.lowFps,
      recoverMs: opts.recoverMs ?? PERF_DEFAULTS.recoverMs,
    };
  }

  get levelId(): 0 | 1 | 2 | 3 {
    return PERF_LEVELS[this.level].id;
  }

  get config(): PerfLevel {
    return PERF_LEVELS[this.level];
  }

  reset(): void {
    this.level = 0;
    this.stableSince = null;
  }

  /** 回傳等級是否變更 */
  record(signals: PerfSignals): boolean {
    const now = this.now();
    const overloaded =
      (signals.inferenceMs !== null && signals.inferenceMs > this.opts.slowInferenceMs) ||
      (signals.fpsMedian !== null && signals.fpsMedian < this.opts.lowFps);

    if (overloaded) {
      this.stableSince = null;
      if (this.level < PERF_LEVELS.length - 1) {
        this.level++;
        return true;
      }
      return false;
    }

    const healthy =
      (signals.inferenceMs === null || signals.inferenceMs < this.opts.slowInferenceMs * 0.6) &&
      (signals.fpsMedian === null || signals.fpsMedian > 24);

    if (healthy) {
      if (this.stableSince === null) this.stableSince = now;
      if (now - this.stableSince >= this.opts.recoverMs && this.level > 0) {
        this.level--;
        this.stableSince = now;
        return true;
      }
    } else {
      this.stableSince = null;
    }
    return false;
  }
}
