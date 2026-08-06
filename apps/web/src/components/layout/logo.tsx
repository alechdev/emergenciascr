import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LogoIcon } from "@/components/layout/logo-icon";

export function Logo() {
  const [autoAnimating, setAutoAnimating] = useState(false);

  useEffect(() => {
    let startTimeout: number;
    let stopTimeout: number;

    const scheduleNext = () => {
      const delay = 4000 + Math.random() * 8000;
      startTimeout = window.setTimeout(() => {
        setAutoAnimating(true);
        stopTimeout = window.setTimeout(() => {
          setAutoAnimating(false);
          scheduleNext();
        }, 1500);
      }, delay);
    };

    scheduleNext();

    return () => {
      window.clearTimeout(startTimeout);
      window.clearTimeout(stopTimeout);
    };
  }, []);

  return (
    <Link
      to="/"
      className="group flex items-center gap-2">
      <LogoIcon
        className="size-6"
        autoAnimating={autoAnimating}
      />
      <span className="text-sm font-medium text-foreground">Emergencias CR</span>
    </Link>
  );
}
