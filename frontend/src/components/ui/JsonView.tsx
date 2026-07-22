import { useCallback, useMemo, useState } from "react";
import styles from "./JsonView.module.css";

export interface JsonViewProps {
  content: unknown;
  maxHeight?: number;
  copyButton?: boolean;
  className?: string;
}

function isEmptyObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

function isEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length === 0;
}

function JsonNode({ value, depth }: { value: unknown; depth: number }): JSX.Element {
  if (value === null) return <span className={styles.null}>null</span>;
  if (value === undefined) return <span className={styles.null}>undefined</span>;

  switch (typeof value) {
    case "string":
      return <span className={styles.str}>"{value}"</span>;
    case "number":
      return <span className={styles.num}>{String(value)}</span>;
    case "boolean":
      return <span className={styles.bool}>{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={styles.brace}>[]</span>;
    if (depth >= 3) {
      return (
        <span>
          <span className={styles.brace}>[</span>
          <span className={styles.null}>…{value.length} items</span>
          <span className={styles.brace}>]</span>
        </span>
      );
    }
    return (
      <span>
        <span className={styles.brace}>[</span>
        {value.map((item, i) => (
          <span key={i}>
            {"\n"}
            {"  ".repeat(depth + 1)}
            <JsonNode value={item} depth={depth + 1} />
            {i < value.length - 1 && <span className={styles.punc}>,</span>}
          </span>
        ))}
        {"\n"}
        {"  ".repeat(depth)}
        <span className={styles.brace}>]</span>
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className={styles.brace}>{'{}'}</span>;
    if (depth >= 3) {
      return (
        <span>
          <span className={styles.brace}>{'{'}</span>
          <span className={styles.null}>…{entries.length} keys</span>
          <span className={styles.brace}>{'}'}</span>
        </span>
      );
    }
    return (
      <span>
        <span className={styles.brace}>{'{'}</span>
        {entries.map(([k, v], i) => (
          <span key={k}>
            {"\n"}
            {"  ".repeat(depth + 1)}
            <span className={styles.key}>"{k}"</span>
            <span className={styles.punc}>: </span>
            <JsonNode value={v} depth={depth + 1} />
            {i < entries.length - 1 && <span className={styles.punc}>,</span>}
          </span>
        ))}
        {"\n"}
        {"  ".repeat(depth)}
        <span className={styles.brace}>{'}'}</span>
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

export function JsonView({ content, maxHeight = 320, copyButton = false, className }: JsonViewProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    if (typeof content === "string") return content;
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }, [content]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  const isTrivial = typeof content === "string" || isEmptyObject(content) || isEmptyArray(content);

  return (
    <div className={[styles.block, maxHeight > 0 ? styles.scrollable : "", className].filter(Boolean).join(" ")}>
      {copyButton && (
        <button className={styles.copyBtn} onClick={handleCopy} type="button">
          {copied ? "copied" : "copy"}
        </button>
      )}
      {isTrivial ? (
        <span>{text}</span>
      ) : (
        <JsonNode value={content} depth={0} />
      )}
    </div>
  );
}
