import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Pill.module.css";

export type PillTone = "neutral" | "accent" | "success" | "danger";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  children: ReactNode;
}

export function Pill({ tone = "neutral", className, children, ...rest }: PillProps) {
  return (
    <span className={[styles.pill, styles[tone], className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  );
}
