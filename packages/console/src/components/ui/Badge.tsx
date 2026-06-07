import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type Variant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline" | "accent";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  default: "bg-primary/10 text-primary",
  secondary: "bg-secondary/10 text-secondary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
  outline: "border border-border text-foreground",
  accent: "bg-accent/15 text-accent-foreground",
};

export function Badge({ className, variant = "default", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5",
        "text-xs font-medium",
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
