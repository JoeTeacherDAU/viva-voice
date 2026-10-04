import type { ButtonHTMLAttributes } from "react";

type Variant = "filled" | "outlined";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

// DESIGN.md: one filled primary action per screen; everything else outlined.
const styles: Record<Variant, string> = {
  filled: "bg-primary text-bg font-semibold border border-primary",
  outlined: "bg-transparent text-on-surface border border-outline-variant",
};

export function Button({ variant = "outlined", className = "", ...rest }: ButtonProps) {
  return (
    <button
      className={`rounded-control px-5 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    />
  );
}
