/**
 * 辨識目標類別定義（規格 6）。
 *
 * 誠實邊界（規格 6／11）：
 * - 本機 COCO-SSD（lite_mobilenet_v2）支援的家具類別：床、沙發、桌子、椅子、電視、冰箱、水槽。
 * - COCO-SSD **不支援**門與窗：門／窗改以「幾何候選＋使用者確認」處理（規格 6 明文允許），
 *   未確認前一律顯示淡金色待確認標記，不冒充已辨識。
 * - 牆面／地板：第一版不呈現（決策 14 不做地板投影；牆面無獨立可靠本機模型，不偽裝）。
 */

export type ObjectKind = "bed" | "sofa" | "table" | "chair" | "tv" | "fridge" | "sink" | "door" | "window";

export interface ObjectDef {
  kind: ObjectKind;
  zh: string;
  /** COCO-SSD 類別名稱；undefined 表示需要幾何候選＋人機確認 */
  coco?: string;
  /** 標籤優先權（大者優先顯示）；門窗依八宅意義給高權重 */
  priority: number;
  /** 是否需要使用者確認類別（幾何候選） */
  needsConfirm: boolean;
}

export const OBJECT_DEFS: Record<ObjectKind, ObjectDef> = {
  door: { kind: "door", zh: "門", priority: 10, needsConfirm: true },
  window: { kind: "window", zh: "窗", priority: 9, needsConfirm: true },
  bed: { kind: "bed", zh: "床", coco: "bed", priority: 8, needsConfirm: false },
  sofa: { kind: "sofa", zh: "沙發", coco: "couch", priority: 8, needsConfirm: false },
  table: { kind: "table", zh: "桌子", coco: "dining table", priority: 7, needsConfirm: false },
  chair: { kind: "chair", zh: "椅子", coco: "chair", priority: 5, needsConfirm: false },
  tv: { kind: "tv", zh: "電視", coco: "tv", priority: 5, needsConfirm: false },
  fridge: { kind: "fridge", zh: "冰箱", coco: "refrigerator", priority: 5, needsConfirm: false },
  sink: { kind: "sink", zh: "水槽", coco: "sink", priority: 4, needsConfirm: false },
};

/** COCO-SSD 類別 → 本專案物件（其餘 COCO 類別一律忽略，不亂標） */
export const COCO_TO_KIND: Record<string, ObjectKind> = {};
for (const def of Object.values(OBJECT_DEFS)) {
  if (def.coco) COCO_TO_KIND[def.coco] = def.kind;
}

/** 幾何候選可被使用者確認成的類別（規格 6：傳統幾何法加人機確認） */
export const GEO_CONFIRM_KINDS: ObjectKind[] = ["door", "window"];

export function defOf(kind: ObjectKind): ObjectDef {
  return OBJECT_DEFS[kind];
}
