import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getRelativeTime } from "@/lib/utils";

interface RelativeTimeProps {
  date: string;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const fullDate = new Date(date).toLocaleString("es-CR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={className}
              suppressHydrationWarning
            />
          }>
          {getRelativeTime(date)}
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-mono">{fullDate}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
