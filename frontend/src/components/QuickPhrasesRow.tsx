import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./QuickPhrasesRow.module.css";

export interface QuickPhrasesRowProps {
  phrases: string[];
  onSubmit: (phrase: string) => void;
  onAdd: (phrase: string) => void;
  onDelete: (index: number) => void;
}

const GAP = 4;

export function QuickPhrasesRow({ phrases, onSubmit, onAdd, onDelete }: QuickPhrasesRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const addWrapRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const overflowWrapRef = useRef<HTMLDivElement>(null);
  const overflowToggleRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(phrases.length);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    const recompute = () => {
      const container = containerRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;
      const addWidth = addWrapRef.current?.offsetWidth ?? 0;
      const containerWidth = container.clientWidth - (addWidth ? addWidth + GAP : 0);
      const pillEls = Array.from(measure.querySelectorAll<HTMLElement>("[data-pill]"));
      const overflowEl = measure.querySelector<HTMLElement>("[data-overflow]");
      const overflowWidth = overflowEl ? overflowEl.offsetWidth : 0;

      let used = 0;
      let count = 0;
      for (let i = 0; i < pillEls.length; i++) {
        const w = pillEls[i].offsetWidth;
        const withGap = used === 0 ? w : used + GAP + w;
        const hasMore = i < pillEls.length - 1;
        const total = withGap + (hasMore ? GAP + overflowWidth : 0);
        if (i === 0 || total <= containerWidth) {
          used = withGap;
          count = i + 1;
        } else {
          break;
        }
      }
      setVisibleCount(count);
    };

    recompute();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [phrases, adding]);

  const closeOverflow = () => setOverflowOpen(false);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!overflowWrapRef.current?.contains(e.target as Node)) closeOverflow();
    };
    const onDocKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        closeOverflow();
        overflowToggleRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [overflowOpen]);

  const openAdd = () => {
    setAdding(true);
    requestAnimationFrame(() => addInputRef.current?.focus());
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraft("");
  };

  const commitAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      cancelAdd();
      return;
    }
    onAdd(trimmed);
    setDraft("");
  };

  const onAddKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAdd();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelAdd();
    }
  };

  const visible = phrases.slice(0, visibleCount);
  const hidden = phrases.slice(visibleCount);

  return (
    <div className={styles.row} ref={containerRef} role="group" aria-label="Quick phrases">
      <div className={styles.addWrap} ref={addWrapRef}>
        {adding ? (
          <input
            ref={addInputRef}
            className={styles.addInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onAddKeyDown}
            onBlur={cancelAdd}
            placeholder="New quick phrase…"
          />
        ) : (
          <button type="button" className={styles.addButton} onClick={openAdd} title="Add quick phrase" aria-label="Add quick phrase">
            +
          </button>
        )}
      </div>
      {visible.map((p, idx) => (
        <Pill key={idx} text={p} onSubmit={() => onSubmit(p)} onDelete={() => onDelete(idx)} />
      ))}
      {hidden.length > 0 && (
        <div
          className={styles.overflowWrap}
          ref={overflowWrapRef}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) closeOverflow();
          }}
        >
          <button
            ref={overflowToggleRef}
            type="button"
            className={styles.overflow}
            aria-haspopup="true"
            aria-expanded={overflowOpen}
            aria-label={`${hidden.length} more quick phrases`}
            onClick={() => setOverflowOpen((v) => !v)}
          >
            +{hidden.length}
          </button>
          {overflowOpen && (
            <div className={styles.overflowPopup}>
              <div className={styles.overflowPopupInner}>
                {hidden.map((p, idx) => (
                  <Pill
                    key={idx}
                    text={p}
                    onSubmit={() => { onSubmit(p); closeOverflow(); }}
                    onDelete={() => onDelete(visibleCount + idx)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {phrases.length > 0 && (
        <div className={styles.measure} ref={measureRef} aria-hidden="true">
          {phrases.map((p, idx) => (
            <div key={idx} data-pill className={styles.pill}>
              <span>{p}</span>
              <button type="button" tabIndex={-1} className={styles.delete}>×</button>
            </div>
          ))}
          <div data-overflow className={styles.overflow}>+{phrases.length}</div>
        </div>
      )}
    </div>
  );
}

function Pill({ text, onSubmit, onDelete }: { text: string; onSubmit: () => void; onDelete: () => void }) {
  return (
    <div className={styles.pill}>
      <button type="button" className={styles.pillText} onClick={onSubmit} title={text}>
        {text}
      </button>
      <button
        type="button"
        className={styles.delete}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label={`Remove quick phrase: ${text}`}
      >
        ×
      </button>
    </div>
  );
}
