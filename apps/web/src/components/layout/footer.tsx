import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { LogoIcon } from "@/components/layout/logo-icon";
import { navItems } from "@/components/layout/nav-items";
import { SERVER_URL } from "@/lib/site";

const SOCIAL_LINKS = [
  {
    title: "GitHub",
    url: "https://github.com/alechdev/emergenciascr"
  },
  {
    title: "API",
    url: SERVER_URL
  },
  {
    title: "Web oficial de Bomberos",
    url: "https://www.bomberos.go.cr"
  }
] as const;

export function Footer() {
  const currentYear = new Date().getFullYear();
  const enabledNavItems = navItems.filter((item) => item.enabled);

  return (
    <footer className="app-footer rail-divider-top mt-20 bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-8 py-14 text-center xl:px-0">
        <Link to="/">
          <LogoIcon className="size-7" />
          <span className="sr-only">Emergencias CR</span>
        </Link>
        <p className="font-serif text-xl tracking-tight text-foreground">Emergencias CR</p>

        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {enabledNavItems.map((item, index) => (
            <span
              key={item.url}
              className="flex items-center gap-3">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="text-xs text-muted-foreground/50">
                  ·
                </span>
              )}
              <Link
                to={item.url}
                className="w-fit text-sm text-muted-foreground transition-colors hover:text-foreground">
                {item.title}
              </Link>
            </span>
          ))}
        </nav>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {SOCIAL_LINKS.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground">
              <span>{link.title}</span>
              <ArrowUpRightIcon
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            </a>
          ))}
        </nav>

        <div className="mt-2 flex w-full flex-col items-center gap-1.5 border-t pt-6">
          <p className="font-mono text-xs text-muted-foreground">© {currentYear} Emergencias CR</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/80">
            No relacionado al Benemérito Cuerpo de Bomberos de Costa Rica.
          </p>
        </div>
      </div>
    </footer>
  );
}
