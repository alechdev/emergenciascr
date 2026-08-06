import { cn } from "@/lib/utils";

const LOGO_RAY_ANGLES = [90, 45, 0, 315, 270, 225, 180, 135];

type LogoIconProps = {
  className?: string;
  autoAnimating?: boolean;
};

export function LogoIcon({ className, autoAnimating = false }: LogoIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 41 41"
      className={cn("shrink-0", className)}>
      <g>
        {LOGO_RAY_ANGLES.map((angle, index) => (
          <g
            key={angle}
            transform={`rotate(${angle} 20.5 20.5)`}>
            <path
              className={cn("logo-ray", { "logo-ray-animate": autoAnimating })}
              d="M17.5 3.5 C17.5 7 18.4 11.5 19.6 15.5 L19.6 20.7 L21.4 20.7 L21.4 15.5 C22.6 11.5 23.5 7 23.5 3.5 Z"
              fill="#E66100"
              style={{ animationDelay: `${index * 70}ms` }}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
