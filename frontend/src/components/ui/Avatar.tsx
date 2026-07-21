import type { HTMLAttributes } from "react";
import styles from "./Avatar.module.css";

export type AvatarRole = "user" | "assistant";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  role: AvatarRole;
}

const INITIAL: Record<AvatarRole, string> = { user: "Y", assistant: "AI" };
const LABEL: Record<AvatarRole, string> = { user: "You", assistant: "Assistant" };

export function Avatar({ role, className, ...rest }: AvatarProps) {
  return (
    <span
      className={[styles.avatar, styles[role], className].filter(Boolean).join(" ")}
      aria-label={LABEL[role]}
      {...rest}
    >
      {INITIAL[role]}
    </span>
  );
}
