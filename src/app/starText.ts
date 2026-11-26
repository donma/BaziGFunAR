/**
 * 八星文案：Sticker 一句說明、Bottom Sheet 完整解讀與佈局參考。
 * 文案立場：傳統文化參考，不寫成已經科學證實的因果事實（規格 9）。
 */
import type { StarKey } from "../domain/bazhai/bazhai";

/** Sticker 卡片上的一句精簡說明（規格 8） */
export const STAR_SHORT: Record<StarKey, string> = {
  fuWei: "利穩定休息",
  shengQi: "利開創活力",
  tianYi: "利健康和諧",
  yanNian: "利感情長久",
  liuSha: "留意是非波動",
  wuGui: "留意口舌變動",
  huoHai: "留意壓力疲憊",
  jueMing: "留意阻礙風險",
};

/** 吉凶完整說明（沿用原版 STAR_DESC） */
export const STAR_DESC: Record<StarKey, string> = {
  fuWei: "適合：休息、穩定、累積。利於守成、養氣、提升整體運勢。",
  shengQi: "適合：積極、開創、活力。有利於事業拓展與人脈。",
  tianYi: "適合：健康、療癒、人際和諧。有利於身心調養。",
  yanNian: "適合：和諧、長久、穩定。有利於感情與合作。",
  liuSha: "留意：人際是非與情緒波動，重要座位宜避開。",
  wuGui: "留意：變動、口舌與專注力受干擾，配置宜謹慎。",
  huoHai: "留意：壓力與是非，長期停留容易疲憊。",
  jueMing: "留意：阻礙與決策風險，重要座位宜避開。",
};

/** 佈局參考（傳統八宅用法，文化參考） */
export const STAR_LAYOUT: Record<StarKey, string> = {
  fuWei: "傳統上可作為休息、靜坐或收納的安穩位置；床頭或神位亦常安排於此。",
  shengQi: "傳統上視為最具開創性的位置，辦公座位、大門或書桌常朝此方規劃。",
  tianYi: "傳統上與健康相關，床位、廚房或餐區常朝此方安排。",
  yanNian: "傳統上與感情及人際長久相關，主臥或客廳座位常朝此方規劃。",
  liuSha: "傳統上建議減少久坐久留；可安排儲物、走道等較次要功能。",
  wuGui: "傳統上建議避免作為床頭或辦公主位；可安排廁所、儲物等壓制用法。",
  huoHai: "傳統上建議避免長時間停留；走道或次要收納為常見安排。",
  jueMing: "傳統上為最需留意的方位；重要作息位置宜避開，常以次要功能處理。",
};
