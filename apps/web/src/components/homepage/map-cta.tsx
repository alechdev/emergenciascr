import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

export function MapCTA() {
  return (
    <Link
      to="/mapa"
      className="group relative block h-[300px] w-full overflow-hidden rounded-xl bg-black transition-all duration-300 hover:shadow-xl">
      <img
        src="/map-dark.png"
        alt="Mapa de incidentes en tiempo real"
        width={1000}
        height={1000}
        loading="lazy"
        className="size-full object-cover transition-all duration-300 group-hover:scale-105"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

      <div className="absolute right-0 bottom-0 left-0 p-6 font-serif lg:p-8">
        <div className="mb-4">
          <h2 className="text-xl leading-tight font-bold text-white lg:text-2xl xl:text-3xl">
            Mapa interactivo con incidentes en tiempo real
          </h2>
        </div>

        <Button
          variant="secondary"
          className="group/btn rounded-xl !bg-white text-black hover:!bg-white">
          Ver mapa
          <ArrowRightIcon className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
        </Button>
      </div>
    </Link>
  );
}
