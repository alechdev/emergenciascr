import { formatCostaRicaDate } from "@bomberoscr/lib/costa-rica-time";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getRelativeTime } from "@/lib/utils";

interface RelativeTimeProps {
  date: string;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const fullDate = formatCostaRicaDate(date, "longDatePaddedTime");

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
