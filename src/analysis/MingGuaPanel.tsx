/**
 * 「八宅命卦與方位」分析面板：個人命卦卡＋上北下南 3×3 方位圖＋命卦與方位簡介。
 * 完整資料來自版本化引擎（命卦、立春計算年、大遊年吉凶），非硬編碼。
 */
import { KUA_TABLE, ganzhiYear, type MingGuaResult, type KuaNumber } from "../domain/bazhai/mingGua";
import {
  PALACES,
  STARS,
  type DirectionDeg,
  type StarKey,
} from "../domain/bazhai/bazhai";
import type { Person } from "../storage/storage";

export interface MingGuaPanelProps {
  person: Person | null;
  mingGua: MingGuaResult | null;
  wheel: Record<DirectionDeg, StarKey> | null;
  highlightDeg: DirectionDeg | null;
  onHighlight: (deg: DirectionDeg | null) => void;
}

const DIR_NAME: Record<number, string> = Object.fromEntries(
  PALACES.map((p) => [p.deg, p.branch]),
) as Record<number, string>;

/** 上北下南・方位示意：左→右、上→下 */
const GRID: Array<Array<DirectionDeg | null>> = [
  [315, 0, 45],
  [270, null, 90],
  [225, 180, 135],
];

function TrigramBars({ lines, small = false }: { lines: [number, number, number]; small?: boolean }) {
  return (
    <div className={`mg-bars ${small ? "mg-bars-small" : ""}`} aria-hidden="true">
      {[...lines].reverse().map((yang, i) => (
        <div key={i} className="mg-bar-row">
          {yang ? (
            <span className="mg-bar mg-bar-solid" />
          ) : (
            <>
              <span className="mg-bar" />
              <span className="mg-bar" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function MingGuaPanel({ person, mingGua, wheel, highlightDeg, onHighlight }: MingGuaPanelProps) {
  if (!person || !mingGua || !wheel) {
    return <p style={{ fontSize: 13, color: "var(--c-ink-soft)" }}>請先建立人物</p>;
  }

  const info = KUA_TABLE[mingGua.kua as KuaNumber];
  const groupName = info.group === "east4" ? "東四命" : "西四命";
  const houseName = info.group === "east4" ? "東四宅" : "西四宅";
  const byOrder = (a: { deg: DirectionDeg }, b: { deg: DirectionDeg }) => {
    const order = ["fuWei", "shengQi", "tianYi", "yanNian", "jueMing", "liuSha", "wuGui", "huoHai"];
    return order.indexOf(wheel[a.deg]) - order.indexOf(wheel[b.deg]);
  };
  const goodList = PALACES.filter((p) =>
    ["shengQi", "tianYi", "yanNian", "fuWei"].includes(wheel[p.deg]),
  ).sort(byOrder);
  const badList = PALACES.filter((p) =>
    ["huoHai", "liuSha", "wuGui", "jueMing"].includes(wheel[p.deg]),
  ).sort(byOrder);
  const sexLabel = person.sex === "female" ? "女性" : "男性";
  const stemBranch = ganzhiYear(mingGua.guaYear);

  return (
    <div className="mg-panel">
      <div className="mg-title-row">
        <h2 className="mg-title">八宅命卦與方位</h2>
        <span className="mg-note">上北下南・方位示意</span>
      </div>

      <div className="mg-main">
        {/* 左：個人命卦 */}
        <div className="mg-person mg-card">
          <div className="mg-person-label">個人命卦</div>
          <TrigramBars lines={info.trigramLines} />
          <div className="mg-gua-name">{info.name}卦</div>
          <div className="mg-group-pill">{groupName}</div>
          <div className="mg-element">卦五行：{info.element}</div>
          {mingGua.isWuHuang && (
            <div className="mg-wuhuang">五黃命・{groupName === "西四命" ? "寄坤二" : "寄艮八"}</div>
          )}
          <div className="mg-year">立春換年，計算年 {mingGua.guaYear} 年</div>
        </div>

        {/* 右：3×3 方位圖 */}
        <div className="mg-grid">
          {GRID.map((row, ri) =>
            row.map((deg, ci) => {
              if (deg === null) {
                return (
                  <div className="mg-center mg-card" key={`c${ri}${ci}`}>
                    <TrigramBars lines={info.trigramLines} small />
                    <div className="mg-center-name">{info.name}卦</div>
                  </div>
                );
              }
              const star = wheel[deg];
              const starInfo = STARS[star];
              const good = ["shengQi", "tianYi", "yanNian", "fuWei"].includes(star);
              return (
                <button
                  type="button"
                  key={`c${ri}${ci}`}
                  className={`mg-cell mg-card ${good ? "mg-good" : "mg-bad"} ${highlightDeg === deg ? "mg-highlight" : ""}`}
                  onClick={() => onHighlight(highlightDeg === deg ? null : deg)}
                  aria-label={`${DIR_NAME[deg]}方 ${starInfo.name} ${good ? "吉方" : "凶方"}`}
                >
                  <div className="mg-cell-dir">{DIR_NAME[deg]}</div>
                  <div className="mg-cell-star">{starInfo.name}</div>
                  <div className={`mg-cell-luck ${good ? "good" : "bad"}`}>
                    {good ? "吉方" : "凶方"}
                  </div>
                </button>
              );
            }),
          )}
        </div>
      </div>

      {/* 簡介 */}
      <div className="mg-intro">
        <div className="mg-intro-title">命卦與方位簡介</div>
        <ul>
          <li>
            本命卦：依出生年份與性別（{sexLabel}）換算，命卦計算年為 {mingGua.guaYear} 年（{stemBranch}年，立春換年），本命卦為「{info.name}卦」，卦五行屬{info.element}。
          </li>
          <li>
            命卦分類：「{info.name}卦」屬於「{groupName}」；依八宅命卦宅相配的原則，可參考{houseName}。
          </li>
          <li>
            吉方：{goodList.map((p) => `${p.branch}方（${STARS[wheel[p.deg]].name}）`).join("、")}，可作為床頭、辦公座位與居家配置的參考。
          </li>
          <li>
            凶方：{badList.map((p) => `${p.branch}方（${STARS[wheel[p.deg]].name}）`).join("、")}，傳統上安排主臥或辦公座位時，可多加留意。
          </li>
        </ul>
      </div>
      <div className="mg-disclaimer">
        八宅風水與八字四柱是不同系統；住宅的東四宅或西四宅須依房屋坐向判定，大門位置也須依格局判斷。方位圖不會自動偵測居家方向，僅供參考。
      </div>
    </div>
  );
}
