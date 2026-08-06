import { SpinnerIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<typeof SpinnerIcon>) {
  return (
    <SpinnerIcon
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
