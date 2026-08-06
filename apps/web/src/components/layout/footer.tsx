import { ArrowUpRightIcon, CopyrightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { LogoIcon } from "@/components/layout/logo-icon";
import { navItems } from "@/components/layout/nav-items";

const SOCIAL_LINKS = [
  {
    title: "GitHub",
    url: "https://github.com/alechdev/emergenciascr"
  },
  {
    title: "API",
    url: "https://emergencias.alech.dev/api"
  },
  {
    title: "Web oficial de Bomberos",
    url: "https://www.bomberos.go.cr"
  }
] as const;

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer rail-divider-top mt-20 bg-background px-6">
      <div className="mx-auto w-full max-w-6xl px-2 py-12 sm:px-0">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:gap-6">
          <div className="flex flex-col gap-4">
            <Link
              to="/"
              className="w-fit">
              <LogoIcon className="size-14 sm:size-16" />
              <span className="sr-only">Emergencias CR</span>
            </Link>
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <span>Emergencias CR</span>
              <CopyrightIcon
                size={14}
                weight="duotone"
              />
              <span>{currentYear}</span>
            </p>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              No relacionado al Benemérito Cuerpo de Bomberos de Costa Rica.
            </p>
          </div>

          <div className="flex flex-col gap-4 md:border-l md:pl-8">
            <h3 className="text-sm font-semibold tracking-tight">Navegación</h3>
            <nav className="flex flex-col gap-3">
              {navItems
                .filter((item) => item.enabled)
                .map((item) => (
                  <Link
                    key={item.url}
                    to={item.url}
                    className="w-fit text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {item.title}
                  </Link>
                ))}
            </nav>
          </div>

          <div className="flex flex-col gap-4 md:border-l md:pl-8">
            <h3 className="text-sm font-semibold tracking-tight">Enlaces</h3>
            <nav className="flex flex-col gap-3">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                  <span>{link.title}</span>
                  <ArrowUpRightIcon
                    size={14}
                    aria-hidden="true"
                  />
                </a>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
