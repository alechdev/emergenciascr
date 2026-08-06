import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { navItems } from "@/components/layout/nav-items";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const enabledNavItems = navItems.filter((item) => item.enabled);

export function MobileHeaderNav({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const pathname = location.pathname;

  useEffect(() => {
    const handleScroll = () => {
      if (open) {
        setOpen(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [open]);

  const isActive = (url: string) => {
    if (url === "/") {
      return pathname === "/" || pathname === "";
    }
    return pathname.includes(url);
  };

  return (
    <nav className={className}>
      <Popover
        onOpenChange={setOpen}
        open={open}>
        <PopoverTrigger
          render={
            <Button
              className="extend-touch-target h-8 touch-manipulation items-center justify-start gap-2.5 border-none p-0! hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 active:bg-transparent dark:hover:bg-transparent"
              variant="link"
            />
          }>
          <div className="relative flex h-8 w-4 items-center justify-center">
            <div className="relative size-4">
              <span
                className={cn(
                  "absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100",
                  open ? "top-[0.4rem] -rotate-45" : "top-1"
                )}
              />
              <span
                className={cn(
                  "absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100",
                  open ? "top-[0.4rem] rotate-45" : "top-2.5"
                )}
              />
            </div>
            <span className="sr-only">Toggle Menu</span>
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          alignOffset={0}
          className="h-[calc(100dvh-var(--app-header-height))] w-[100dvw] overflow-y-auto rounded-none border-none bg-background/90 shadow-none backdrop-blur duration-100 before:rounded-none"
          noPadding
          positionerClassName="!h-auto !w-auto !max-w-none left-0!"
          side="bottom"
          sideOffset={8}>
          <div className="flex flex-col gap-6 overflow-auto px-6 py-6">
            <div className="flex flex-col gap-3">
              {enabledNavItems.map((item) => (
                <MobileLink
                  href={item.url}
                  isActive={isActive(item.url)}
                  key={item.url}
                  onClick={() => setOpen(false)}>
                  {item.title}
                </MobileLink>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </nav>
  );
}

function MobileLink({
  href,
  className,
  children,
  isActive,
  onClick
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={href}
      className={cn("relative text-2xl font-medium", className)}
      onClick={onClick}>
      {children}
      <span
        className={cn(
          "absolute -bottom-1 left-0 h-0.5 w-6 origin-left bg-primary transition-transform duration-200 ease-in-out",
          isActive ? "scale-x-100" : "scale-x-0"
        )}
      />
    </Link>
  );
}
