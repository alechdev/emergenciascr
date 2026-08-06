import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type BrailleSpinnerProps = {
  children?: React.ReactNode;
  className?: string;
};

function BrailleSpinner({ children, className }: BrailleSpinnerProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const label = useMemo(() => (typeof children === "string" ? children : "Cargando"), [children]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setAnimate(!media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!animate) {
      return;
    }

    const interval = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, 80);

    return () => window.clearInterval(interval);
  }, [animate]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-2 text-muted-foreground", className)}>
      <span
        aria-hidden="true"
        className="font-mono">
        {animate ? frames[frameIndex] : "⋯"}
      </span>
      {children ? <span>{children}</span> : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export { BrailleSpinner };
