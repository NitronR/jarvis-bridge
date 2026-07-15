import { useEffect, useState } from "react";
import type { ChatPatch, ElicitationField } from "../api/types";
import styles from "./ElicitationModal.module.css";

type ElicitationRequestPatch = Extract<ChatPatch, { type: "elicitation-request" }>;

type FieldValue = string | string[];

function initialValues(fields: ElicitationField[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of fields) out[f.key] = f.kind === "multi-select" ? [] : "";
  return out;
}

function toContent(fields: ElicitationField[], values: Record<string, FieldValue>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.kind === "multi-select") {
      if (Array.isArray(v) && v.length > 0) content[f.key] = v;
    } else if (typeof v === "string" && v.trim() !== "") {
      content[f.key] = v;
    }
  }
  return content;
}

export function ElicitationModal({
  patch,
  onResolve,
}: {
  patch: ElicitationRequestPatch | null;
  onResolve: (requestId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, FieldValue>>({});

  useEffect(() => {
    if (patch) setValues(initialValues(patch.fields));
  }, [patch?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!patch) return null;

  const setValue = (key: string, v: FieldValue) => {
    setValues((cur) => ({ ...cur, [key]: v }));
  };

  const toggleMultiSelect = (key: string, optionValue: string) => {
    setValues((cur) => {
      const current = Array.isArray(cur[key]) ? (cur[key] as string[]) : [];
      const next = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue];
      return { ...cur, [key]: next };
    });
  };

  const onSubmit = () => {
    onResolve(patch.requestId, "accept", toContent(patch.fields, values));
  };

  const onSkip = () => {
    onResolve(patch.requestId, "decline");
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <header className={styles.header}><h2>{patch.message || "The agent has a question"}</h2></header>
        <div className={styles.body}>
          {patch.fields.map((field) => (
            <div key={field.key} className={styles.field}>
              {field.title && <div className={styles.fieldTitle}>{field.title}</div>}
              {field.description && <div className={styles.fieldDescription}>{field.description}</div>}
              {field.kind === "select" && (
                <div className={styles.options}>
                  {(field.options ?? []).map((opt) => (
                    <label key={opt.value} className={styles.option}>
                      <input
                        type="radio"
                        name={field.key}
                        checked={values[field.key] === opt.value}
                        onChange={() => setValue(field.key, opt.value)}
                      />
                      <span>{opt.label}</span>
                      {opt.description && <span className={styles.optionDescription}>{opt.description}</span>}
                    </label>
                  ))}
                </div>
              )}
              {field.kind === "multi-select" && (
                <div className={styles.options}>
                  {(field.options ?? []).map((opt) => (
                    <label key={opt.value} className={styles.option}>
                      <input
                        type="checkbox"
                        checked={Array.isArray(values[field.key]) && (values[field.key] as string[]).includes(opt.value)}
                        onChange={() => toggleMultiSelect(field.key, opt.value)}
                      />
                      <span>{opt.label}</span>
                      {opt.description && <span className={styles.optionDescription}>{opt.description}</span>}
                    </label>
                  ))}
                </div>
              )}
              {field.kind === "text" && (
                <input
                  type="text"
                  className={styles.textInput}
                  value={typeof values[field.key] === "string" ? (values[field.key] as string) : ""}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  placeholder={field.title}
                />
              )}
            </div>
          ))}
          <div className={styles.actions}>
            <button type="button" onClick={onSubmit}>Submit</button>
            <button type="button" className="danger" onClick={onSkip}>Skip</button>
          </div>
        </div>
      </div>
    </div>
  );
}
