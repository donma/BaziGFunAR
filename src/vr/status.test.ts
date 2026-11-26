import { describe, it, expect } from "vitest";
import { detectionStateOf, floorStatus, floorStatusText } from "./status";

describe("盤面可信度（誠實標示）", () => {
  it("預設一般模式只給朝向參考，不得宣稱住宅中心", () => {
    expect(floorStatus({ trusted: true, quality: "valid", homeAtCenter: false })).toBe("heading-ref");
  });

  it("使用者確認站於住宅中心且感測良好 → 住宅中心方位", () => {
    expect(floorStatus({ trusted: true, quality: "valid", homeAtCenter: true })).toBe("home-center");
  });

  it("感測不確定（相對方位／精度差）即使確認中心也不得標住宅中心", () => {
    expect(floorStatus({ trusted: true, quality: "uncertain", homeAtCenter: true })).toBe("heading-ref");
  });

  it("方位不可信（朝天凍結、感測中斷）→ 待校正", () => {
    expect(floorStatus({ trusted: false, quality: "valid", homeAtCenter: true })).toBe("pending");
  });

  it("文案與拍照紀錄狀態對應", () => {
    expect(floorStatusText("home-center")).toBe("住宅中心方位");
    expect(floorStatusText("pending")).toBe("方位待校正");
    expect(detectionStateOf("home-center", true)).toBe("confirmed-home");
    expect(detectionStateOf("heading-ref", true)).toBe("heading-ref");
    expect(detectionStateOf("pending", true)).toBe("pending");
    expect(detectionStateOf("pending", false)).toBe("none");
  });
});
