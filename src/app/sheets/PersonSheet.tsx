/** 人物面板：新增／編輯（規格 4）／切換／刪除，全部只存本機。 */
import { useEffect, useState } from "react";
import { KUA_TABLE, kuaTitle } from "../../domain/bazhai/mingGua";
import type { LSData, Person } from "../../storage/storage";
import { BottomSheet } from "../ui";
import { PersonFields, emptyFields, type PersonFieldValues } from "./PersonFields";

export interface PersonSheetProps {
  open: boolean;
  onClose: () => void;
  ls: LSData;
  selectPerson: (id: string) => void;
  removePerson: (id: string) => void;
  addPerson: AddPerson;
  editPerson: (id: string, name: string, birthDate: string, birthTime: string | null, sex: "male" | "female") => void;
}

type AddPerson = (name: string, birthDate: string, birthTime: string | null, sex: "male" | "female") => Person;

export function PersonSheet(p: PersonSheetProps) {
  const [formOpen, setFormOpen] = useState<"add" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [fields, setFields] = useState<PersonFieldValues>(emptyFields());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!p.open) {
      setFormOpen(null);
      setErr(null);
    }
  }, [p.open]);

  const openAdd = () => {
    setFields(emptyFields());
    setEditId(null);
    setFormOpen("add");
    setErr(null);
  };

  const openEdit = (person: Person) => {
    setFields({
      name: person.name,
      date: person.birthDate,
      time: person.birthTime ?? "",
      sex: person.sex,
    });
    setEditId(person.id);
    setFormOpen("edit");
    setErr(null);
  };

  const submit = () => {
    if (!fields.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
      setErr("請填寫名稱與國曆生日（YYYY-MM-DD）");
      return;
    }
    try {
      if (formOpen === "edit" && editId) {
        p.editPerson(editId, fields.name.trim(), fields.date, fields.time || null, fields.sex);
      } else {
        p.addPerson(fields.name.trim(), fields.date, fields.time || null, fields.sex);
      }
      setFormOpen(null);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <BottomSheet open={p.open} onClose={p.onClose} title="人物" subtitle="僅存本機・切換後立即以該命卦計算">
      <div className="sheet-section">
        {p.ls.persons.map((person) => {
          const info = KUA_TABLE[person.kua];
          const current = person.id === p.ls.settings.currentPersonId;
          return (
            <div className={`list-card ${current ? "is-current" : ""}`} key={person.id}>
              <button className="list-main" onClick={() => { p.selectPerson(person.id); p.onClose(); }}>
                <div className="list-title">
                  {person.name}
                  {current && <span className="current-dot">目前</span>}
                </div>
                <div className="list-sub">
                  {person.birthDate}・{kuaTitle(person.kua)}・{info.group === "east4" ? "東四命" : "西四命"}
                </div>
              </button>
              <div className="list-actions">
                <button className="btn mini-btn" onClick={() => openEdit(person)}>編輯</button>
                <button className="btn mini-btn danger" onClick={() => p.removePerson(person.id)}>刪除</button>
              </div>
            </div>
          );
        })}
        {p.ls.persons.length === 0 && <p className="hint">尚無人物，請先新增。</p>}
      </div>

      {!formOpen && (
        <button className="btn primary wide" onClick={openAdd}>＋ 新增人物</button>
      )}

      {formOpen && (
        <div className="form-card">
          <h3>{formOpen === "edit" ? "編輯人物" : "新增人物"}</h3>
          <PersonFields value={fields} onChange={setFields} />
          <p className="hint">年界以立春交節時刻判定（時區：Asia/Taipei）。</p>
          {err && <div className="form-err">{err}</div>}
          <div className="btn-row">
            <button className="btn primary" onClick={submit}>確認</button>
            <button className="btn" onClick={() => setFormOpen(null)}>取消</button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
