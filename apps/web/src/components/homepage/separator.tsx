import { useId } from "react";

export function Separator() {
  const patternId = useId();

  return (
    <div className="rail-divider-y h-8">
      <div
        className="absolute top-0 bottom-0 overflow-hidden"
        style={{
          left: "max(calc((var(--viewport-inline-size) - var(--rails-max-width)) / 2), var(--content-gutter))",
          right:
            "max(calc((var(--viewport-inline-size) - var(--rails-max-width)) / 2), var(--content-gutter))"
        }}>
        <svg
          className="pointer-events-none size-full text-foreground/6 select-none"
          aria-hidden="true">
          <defs>
            <pattern
              id={patternId}
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)">
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="4"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill={`url(#${patternId})`}
          />
        </svg>
      </div>
    </div>
  );
}
