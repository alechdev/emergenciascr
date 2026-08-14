import {
  CaretLeftIcon,
  CaretRightIcon,
  FireTruckIcon,
  MagnifyingGlassIcon,
  ShieldIcon,
  SpinnerIcon,
  TimerIcon
} from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { JsonLdScript } from "@/components/seo/json-ld-script";
import { StationCard, StationCardSkeleton } from "@/components/stations/station-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { StatCard, StatCardSkeleton } from "@/components/ui/stat-card";
import { getSystemOverviewOptions, listStationsOptions } from "@/lib/api/@tanstack/react-query.gen";
import { buildCollectionPageJsonLd } from "@/lib/json-ld";
import { SITE_URL } from "@/lib/site";
import { formatMinutesToHMS } from "@/lib/utils";

import type { ListStationsResponse } from "@/lib/api/types.gen";

const title = "Estaciones de Bomberos de Costa Rica | Emergencias CR";
const description =
  "Directorio de estaciones de bomberos de Costa Rica: ubicación, unidades y tiempos de respuesta del Cuerpo de Bomberos.";

const STATIONS_PER_PAGE = 9;

const DEFAULT_SEARCH = {
  q: undefined,
  page: 1,
  status: "operative",
  sort: "key-asc"
} as const;

export const Route = createFileRoute("/_dashboard/estaciones/")({
  head: () => {
    const stationsUrl = `${SITE_URL}/estaciones`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: stationsUrl },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:url", content: stationsUrl }
      ],
      links: [{ rel: "canonical", href: stationsUrl }]
    };
  },
  validateSearch: z.object({
    q: z.string().optional().catch(undefined),
    page: z.number().catch(1),
    status: z.enum(["all", "operative", "non-operative"]).catch("operative"),
    sort: z.enum(["name-asc", "name-desc", "key-asc", "key-desc"]).catch("key-asc")
  }),
  search: {
    middlewares: [stripSearchParams(DEFAULT_SEARCH)]
  },
  component: Page
});

function statusToOperative(status: "all" | "operative" | "non-operative"): string | undefined {
  if (status === "operative") return "true";
  if (status === "non-operative") return "false";
  return undefined;
}

const STATUS_OPTIONS = [
  { value: "operative", label: "Operativas" },
  { value: "non-operative", label: "No operativas" },
  { value: "all", label: "Todas" }
] as const;

const SORT_OPTIONS = [
  { value: "name-asc", label: "Nombre (A-Z)" },
  { value: "name-desc", label: "Nombre (Z-A)" },
  { value: "key-asc", label: "Código (A-Z)" },
  { value: "key-desc", label: "Código (Z-A)" }
] as const;

function sortToTuple(sort: "name-asc" | "name-desc" | "key-asc" | "key-desc"): [string, string] {
  const [field, direction] = sort.split("-") as [string, string];
  const apiField = field === "key" ? "stationKey" : field;
  return [apiField, direction];
}

function Page() {
  const { q, page, status, sort } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [searchInputValue, setSearchInputValue] = useState(q || "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: systemOverview, isPending: isSystemOverviewPending } = useQuery({
    ...getSystemOverviewOptions(),
    placeholderData: keepPreviousData
  });

  const operative = statusToOperative(status);
  const sortTuple = sortToTuple(sort);
  const { data, isPending, isFetching, isPlaceholderData } = useQuery({
    ...listStationsOptions({
      query: { limit: STATIONS_PER_PAGE, page, operative, q, sort: sortTuple }
    }),
    placeholderData: keepPreviousData
  });

  useEffect(() => {
    setSearchInputValue(q || "");
  }, [q]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchInputValue(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, q: value || undefined, page: 1 }),
        replace: true,
        resetScroll: false
      });
    }, 300);
  };

  const handleStatusChange = (newStatus: "all" | "operative" | "non-operative") => {
    void navigate({
      search: (prev) => ({ ...prev, status: newStatus, page: 1 }),
      replace: true,
      resetScroll: false
    });
  };

  const handleSortChange = (newSort: "name-asc" | "name-desc" | "key-asc" | "key-desc") => {
    void navigate({
      search: (prev) => ({ ...prev, sort: newSort, page: 1 }),
      replace: true,
      resetScroll: false
    });
  };

  const totalPages = data?.meta?.totalPages ?? 0;
  const stations = data?.data ?? [];
  const hasResults = totalPages > 0;
  const isFirstPage = page === 1;
  const isLastPage = page >= totalPages || !hasResults;

  const showSkeleton = isPending;
  const showEmptyState = !isPending && !isPlaceholderData && stations.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <JsonLdScript
        data={buildCollectionPageJsonLd({
          name: title,
          description,
          url: `${SITE_URL}/estaciones`
        })}
      />
      {isSystemOverviewPending && !systemOverview ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : systemOverview ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard
            title="Estaciones operativas"
            value={systemOverview.stationCount}
            icon={ShieldIcon}
          />
          <StatCard
            title="Vehículos activos"
            value={systemOverview.activeVehicleCount}
            icon={FireTruckIcon}
          />
          <StatCard
            title="Tiempo respuesta promedio"
            value={
              systemOverview.avgResponseTimeMinutes
                ? formatMinutesToHMS(systemOverview.avgResponseTimeMinutes)
                : "N/A"
            }
            icon={TimerIcon}
          />
        </div>
      ) : null}

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Estaciones de Bomberos de Costa Rica
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Directorio de estaciones del Cuerpo de Bomberos, con dirección, unidades y actividad
            reciente.
          </p>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Directorio</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <MagnifyingGlassIcon
                  className="size-4 text-muted-foreground"
                  weight="bold"
                />
              </div>
              <Input
                className="pl-9"
                placeholder="Buscar por nombre..."
                type="search"
                value={searchInputValue}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3 sm:contents">
              <Select
                value={status}
                items={STATUS_OPTIONS}
                onValueChange={(value) =>
                  handleStatusChange(value as "all" | "operative" | "non-operative")
                }>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectPopup>
                  {STATUS_OPTIONS.map(({ value, label }) => (
                    <SelectItem
                      key={value}
                      value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>

              <Select
                value={sort}
                items={SORT_OPTIONS}
                onValueChange={(value) =>
                  handleSortChange(value as "name-asc" | "name-desc" | "key-asc" | "key-desc")
                }>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Ordenar por" />
                </SelectTrigger>
                <SelectPopup>
                  {SORT_OPTIONS.map(({ value, label }) => (
                    <SelectItem
                      key={value}
                      value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <nav
              className="flex justify-end"
              aria-label="Paginación de estaciones">
              <Button
                variant="outline"
                size="icon"
                className="rounded-r-none"
                disabled={isFirstPage || isFetching}
                onClick={() => {
                  if (!isFirstPage && !isFetching)
                    void navigate({
                      search: (prev) => ({ ...prev, page: page - 1 }),
                      replace: true,
                      resetScroll: false
                    });
                }}
                aria-label="Página anterior">
                <CaretLeftIcon weight="bold" />
              </Button>
              <div className="flex min-w-20 items-center justify-center border-y border-input bg-background px-3 tabular-nums">
                {isFetching ? (
                  <SpinnerIcon className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-sm">{hasResults ? `${page} de ${totalPages}` : "—"}</span>
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="rounded-l-none"
                disabled={isLastPage || isFetching}
                onClick={() => {
                  if (!isLastPage && !isFetching)
                    void navigate({
                      search: (prev) => ({ ...prev, page: page + 1 }),
                      replace: true,
                      resetScroll: false
                    });
                }}
                aria-label="Página siguiente">
                <CaretRightIcon weight="bold" />
              </Button>
            </nav>
          </div>
        </div>

        {showSkeleton ? (
          <StationsListSkeleton />
        ) : showEmptyState ? (
          <StationsEmptyState />
        ) : (
          <StationsList stations={stations} />
        )}
      </section>
    </div>
  );
}

function StationsList({ stations }: { stations: ListStationsResponse["data"] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence mode="popLayout">
        {stations.map((station, index) => (
          <motion.div
            key={station.stationKey}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.2,
              delay: index * 0.03
            }}>
            <StationCard station={station} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function StationsEmptyState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/40 text-center">
      <MagnifyingGlassIcon className="size-10 text-muted-foreground/50" />
      <h3 className="mt-4 text-lg font-semibold">No se encontraron estaciones</h3>
      <p className="text-sm text-muted-foreground">Intenta con otros términos de búsqueda.</p>
    </div>
  );
}

function StationsListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: STATIONS_PER_PAGE }).map((_, i) => (
        <StationCardSkeleton key={i} />
      ))}
    </div>
  );
}
