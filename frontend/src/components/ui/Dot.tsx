import type { HTMLAttributes } from "react";
import styles from "./Dot.module.css";

export type DotStatus = "idle" | "ok" | "bad" | "progress";

export interface DotProps extends HTMLAttributes<HTMLSpanElement> {
  status?: DotStatus;
}

export function Dot({ status = "idle", className, ...rest }: DotProps) {
  return (
    <span
      className={[styles.dot, styles[status], className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
