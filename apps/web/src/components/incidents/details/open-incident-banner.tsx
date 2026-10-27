import { cn } from "@/lib/utils";

interface OpenIncidentBannerProps {
  className?: string;
}

export default function OpenIncidentBanner({ className }: OpenIncidentBannerProps) {
  return (
    <p className={cn("flex items-center gap-2 text-sm font-bold text-destructive", className)}>
      <span
        className="size-1.5 shrink-0 rounded-full bg-destructive"
        aria-hidden="true"
      />
      En desarrollo
    </p>
  );
}
