import * as React from "react";
import { cn } from "@/lib/utils";

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement>;

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("relative overflow-y-auto overflow-x-hidden", className)} {...props}>
    {children}
  </div>
));
ScrollArea.displayName = "ScrollArea";
