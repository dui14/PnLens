export type HistoryGap = {
  market: string
  startMs: number
  endMs: number
}

export class HistoryGapTracker {
  gaps: HistoryGap[] = []

  reset(): void {
    this.gaps = []
  }

  record(market: string, startMs: number, endMs: number): void {
    this.gaps.push({ market, startMs, endMs })
  }
}
