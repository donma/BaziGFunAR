import { describe, it, expect } from "vitest";
import { assetsFromModelJson, MODEL_JSON_URL } from "./modelRegistry";

describe("模型版本與資產路徑（規格 11）", () => {
  it("shard 相對路徑相對於 model.json 所在目錄解析（不可拼成 model.json/...）", () => {
    const json = JSON.stringify({
      modelTopology: {},
      weightsManifest: [{ paths: ["group1-shard1of5", "group1-shard2of5"] }],
    });
    const assets = assetsFromModelJson(json, MODEL_JSON_URL);
    expect(assets).toHaveLength(3);
    expect(assets[0].url).toBe(MODEL_JSON_URL);
    expect(assets[1].url).toBe("https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/group1-shard1of5");
    expect(assets[2].url).toBe("https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/group1-shard2of5");
    for (const a of assets.slice(1)) expect(a.url).not.toContain("model.json/");
  });

  it("無效 JSON 拋錯（失敗時不啟用模型）", () => {
    expect(() => assetsFromModelJson("not json", MODEL_JSON_URL)).toThrow();
  });
});
