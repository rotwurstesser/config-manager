import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-zinc-700 text-zinc-200",
        secondary:
          "bg-zinc-800 text-zinc-400",
        destructive:
          "bg-red-900/50 text-red-300",
        outline: "border border-zinc-700 text-zinc-400",
        success:
          "bg-emerald-900/50 text-emerald-300",
        warning:
          "bg-amber-900/50 text-amber-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
