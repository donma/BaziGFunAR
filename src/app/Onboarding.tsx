/**
 * 首次引導（決策 29A：新專案重新建立人物，無舊版匯入）：
 * 建立人物 → 說明權限與 AR 流程 → 進入 AR（AR 按鈕點擊時才請求方向權限，符合 iOS 手勢要求）。
 */
import { useState } from "react";
import { APP_VERSION } from "./version";
import { PersonFields, emptyFields, type PersonFieldValues } from "./sheets/PersonFields";

export interface AddPerson {
  (name: string, birthDate: string, birthTime: string | null, sex: "male" | "female"): unknown;
}

export function Onboarding({
  onAddPerson,
  personCount,
  onFinish,
}: {
  onAddPerson: AddPerson;
  personCount: number;
  onFinish: () => void;
}) {
  const [fields, setFields] = useState<PersonFieldValues>(emptyFields());
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(personCount > 0);
  const [intro, setIntro] = useState(false);

  const submit = () => {
    if (!fields.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
      setErr("請填寫名稱與國曆生日（YYYY-MM-DD）");
      return;
    }
    try {
      onAddPerson(fields.name.trim(), fields.date, fields.time || null, fields.sex);
      setReady(true);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-brand">
        <div className="brand-mark" aria-hidden="true">☰</div>
        <h1>BaziGFun AR</h1>
        <p>八宅命卦・實景 AR 貼紙</p>
        <span className="onboarding-version">v{APP_VERSION}｜本機離線・不上傳資料</span>
      </div>

      <div className="glass onboarding-card">
        {!ready ? (
          <>
            <h2>建立量測對象</h2>
            <p>人物資料只存在這台裝置。姓名、生日與性別用來計算命卦，出生時辰可留空（接近立春時建議填寫）。</p>
            <PersonFields value={fields} onChange={setFields} />
            {err && <div className="form-err">{err}</div>}
            <button className="btn primary wide" onClick={submit}>
              建立人物（已有 {personCount} 人）
            </button>
          </>
        ) : !intro ? (
          <>
            <h2>準備好了</h2>
            <p>進入 AR 時，瀏覽器會請求相機與「動作與方向」感測權限；兩者都具備才會顯示實景貼紙。若拒絕，其他功能仍可使用。</p>
            <ul className="onboarding-list">
              <li>相機畫面優先顯示，模型在背景自動載入。</li>
              <li>物件貼紙分為「朝向參考」與「住宅宮位已確認」，不會混淆。</li>
              <li>按一次快門同時保存原始實景照與 AR 合成照。</li>
            </ul>
            <button className="btn wide" onClick={() => setIntro(true)}>下一步</button>
          </>
        ) : (
          <>
            <h2>開始實景量測</h2>
            <p>手持手機水平，看向想參考的方向。貼紙可拖曳修正，點一下可查看詳細解讀。你可以隨時在設定中校正或啟用住宅定位。</p>
            <button className="btn primary wide" onClick={onFinish}>進入 AR</button>
          </>
        )}
      </div>

      {ready && !intro && personCount > 0 && (
        <button className="btn wide" onClick={onFinish}>略過，直接進入</button>
      )}
      <p className="onboarding-foot">八宅風水為傳統文化參考，不宣稱科學驗證。</p>
    </div>
  );
}
