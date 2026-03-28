import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = {
  default: "border-transparent bg-primary text-primary-foreground",
  success: "border-transparent bg-emerald-600 text-white",
  warning: "border-transparent bg-amber-500 text-white",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  outline: "text-foreground",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof badgeVariants;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
