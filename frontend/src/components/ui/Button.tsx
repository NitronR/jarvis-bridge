import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = "default", className, ...rest }: ButtonProps) {
  const variantClass = variant !== "default" ? styles[variant] : "";
  return (
    <button
      className={[styles.button, variantClass, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
