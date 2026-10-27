import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  id: string;
  title: string;
  className?: string;
}

export function SectionHeading({ id, title, className }: SectionHeadingProps) {
  return (
    <h2
      id={id}
      className={cn("scroll-mt-20 font-serif text-2xl leading-tight", className)}>
      {title}
    </h2>
  );
}
