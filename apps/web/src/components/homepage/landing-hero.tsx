import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Suspense, lazy, useId } from "react";

import { buttonVariants } from "@/components/ui/button";

const ParticlesMap = lazy(() => import("@/components/homepage/particles-map"));

export function LandingHero() {
  const patternId = useId();

  return (
    <section className="relative isolate py-10 sm:py-12">
      <div
        className="pointer-events-none absolute inset-y-0 -z-10"
        style={{
          left: "calc(-1 * (var(--viewport-inline-size) - 100%) / 2 + max((var(--viewport-inline-size) - var(--rails-max-width)) / 2, var(--content-gutter)))",
          right:
            "calc(-1 * (var(--viewport-inline-size) - 100%) / 2 + max((var(--viewport-inline-size) - var(--rails-max-width)) / 2, var(--content-gutter)))"
        }}>
        <svg
          className="size-full mask-[radial-gradient(ellipse_at_top,black_20%,transparent_70%)] text-foreground/10 select-none"
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

      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
          <h1 className="mt-5 max-w-3xl font-serif text-4xl leading-tight sm:text-5xl lg:text-[3.4rem] lg:leading-[1.04]">
            Bomberos de Costa Rica: Reporte de Incidentes en Tiempo Real
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Consulta el mapa de emergencias activas, ubicación de estaciones y estadísticas de
            respuesta del Cuerpo de Bomberos en todo el territorio nacional.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to="/incidentes"
              className={buttonVariants({
                size: "lg",
                className: "group"
              })}>
              Ver incidentes
              <ArrowUpRightIcon className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>

            <Link
              to="/estaciones"
              search={{
                page: 1,
                status: "operative",
                sort: "key-asc"
              }}
              className={buttonVariants({
                variant: "outline",
                size: "lg"
              })}>
              Explorar estaciones
            </Link>
          </motion.div>
        </motion.div>

        <div className="relative hidden min-h-[360px] overflow-visible pt-14 lg:block">
          <div className="absolute inset-0">
            <Suspense fallback={null}>
              <motion.div
                className="h-full w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}>
                <ParticlesMap
                  interactive
                  className="h-full items-end justify-end p-0 pt-10"
                  canvasClassName="h-auto w-full max-w-[520px] opacity-65 lg:translate-y-8 xl:translate-y-16 [mask-image:radial-gradient(circle_at_45%_50%,black_45%,transparent_82%)]"
                />
              </motion.div>
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  );
}
