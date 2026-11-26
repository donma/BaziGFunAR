/** 八宅命卦與方位分析面板（面板內容原版移植，只換成底部卡容器）。 */
import { useEffect, useState } from "react";
import { MingGuaPanel } from "../../analysis/MingGuaPanel";
import type { MingGuaResult } from "../../domain/bazhai/mingGua";
import type { DirectionDeg, StarKey } from "../../domain/bazhai/bazhai";
import type { Person } from "../../storage/storage";
import { BottomSheet } from "../ui";

export function AnalysisSheet(p: {
  open: boolean;
  onClose: () => void;
  person: Person | null;
  mingGua: MingGuaResult | null;
  wheel: Record<DirectionDeg, StarKey> | null;
}) {
  const [highlight, setHighlight] = useState<DirectionDeg | null>(null);
  useEffect(() => {
    if (!p.open) setHighlight(null);
  }, [p.open]);

  return (
    <BottomSheet open={p.open} onClose={p.onClose} title="八宅命卦與方位" subtitle="上北下南・方位示意">
      <MingGuaPanel
        person={p.person}
        mingGua={p.mingGua}
        wheel={p.wheel}
        highlightDeg={highlight}
        onHighlight={setHighlight}
      />
    </BottomSheet>
  );
}
