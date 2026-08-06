import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Icon } from "@phosphor-icons/react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: Icon;
  className?: string;
}

export function StatCard({ title, value, icon: Icon, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "relative flex h-32 flex-col justify-between overflow-hidden rounded-xl border bg-card p-6 text-card-foreground shadow-sm transition-all hover:shadow-md",
        className
      )}>
      <div className="z-10 flex justify-start">
        <span className="text-sm font-medium tracking-tight text-muted-foreground">{title}</span>
      </div>

      <div className="z-10">
        <span className="text-4xl font-bold tracking-tighter">{value}</span>
      </div>

      <Icon
        className="absolute top-1 right-1 h-24 w-24 text-muted-foreground/10"
        weight="thin"
      />
    </div>
  );
}

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex h-32 flex-col justify-between overflow-hidden rounded-xl border bg-card p-6 text-card-foreground shadow-sm",
        className
      )}>
      <div className="z-10 flex justify-start">
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="z-10">
        <Skeleton className="h-10 w-16" />
      </div>
    </div>
  );
}
