/** 人物欄位（沿用原版欄位：姓名、性別、國曆生日、出生時辰選填） */
export interface PersonFieldValues {
  name: string;
  date: string;
  time: string;
  sex: "male" | "female";
}

export function PersonFields({
  value,
  onChange,
}: {
  value: PersonFieldValues;
  onChange: (v: PersonFieldValues) => void;
}) {
  const set = (patch: Partial<PersonFieldValues>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="field">
        <label>名稱</label>
        <input value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="例：媽媽" />
      </div>
      <div className="field">
        <label>國曆生日（必填）</label>
        <input type="date" value={value.date} onChange={(e) => set({ date: e.target.value })} />
      </div>
      <div className="field">
        <label>出生時間（選填，立春臨界建議填）</label>
        <input type="time" value={value.time} onChange={(e) => set({ time: e.target.value })} />
      </div>
      <div className="field">
        <label>性別</label>
        <select value={value.sex} onChange={(e) => set({ sex: e.target.value as "male" | "female" })}>
          <option value="male">男</option>
          <option value="female">女</option>
        </select>
      </div>
    </>
  );
}

export function emptyFields(): PersonFieldValues {
  return { name: "", date: "", time: "", sex: "male" };
}
