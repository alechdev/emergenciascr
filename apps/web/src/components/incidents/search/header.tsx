import { CaretDownIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  DateRangeFilterContent,
  DateRangeFilterPopover
} from "@/components/incidents/search/date-range-filter";
import {
  IncidentTypeFilterContent,
  IncidentTypeFilterPopover
} from "@/components/incidents/search/incident-type-filter";
import {
  StationFilterContent,
  StationFilterPopover
} from "@/components/incidents/search/station-filter";
import { LogoIcon } from "@/components/layout/logo-icon";
import { MobileHeaderNav } from "@/components/layout/mobile-header-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { Route } from "@/routes/_incidents/incidentes";

import type { ListIncidentTypesResponse, ListStationsResponse } from "@/lib/api/types.gen";

export function IncidentsSearchHeader({
  stations,
  incidentTypes
}: {
  stations: ListStationsResponse["data"];
  incidentTypes: ListIncidentTypesResponse["items"];
}) {
  const [autoAnimating, setAutoAnimating] = useState(false);
  const search = Route.useSearch();
  const { q } = search;
  const navigate = Route.useNavigate();
  const [searchInputValue, setSearchInputValue] = useState(q ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeFiltersCount =
    (search.stations?.length ?? 0) +
    (search.incidentCodes?.length ?? 0) +
    (search.start || search.end ? 1 : 0) +
    (search.open != null ? 1 : 0);

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

  useEffect(() => {
    setSearchInputValue(q ?? "");
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
        search: (prev) => ({ ...prev, q: value || undefined }),
        replace: true,
        resetScroll: false
      });
    }, 300);
  };

  const stationItems = stations.map((station) => ({
    value: station.id.toString(),
    label: station.name
  }));

  const handleResetFilters = () => {
    void navigate({
      search: (prev) => ({
        view: prev.view,
        q: prev.q,
        sort: prev.sort,
        zoom: prev.zoom,
        northBound: prev.northBound,
        southBound: prev.southBound,
        eastBound: prev.eastBound,
        westBound: prev.westBound
      }),
      replace: true,
      resetScroll: false
    });
  };

  return (
    <div className="flex items-center gap-4 max-md:justify-between max-md:p-4 md:px-4 md:py-2">
      <Link
        to="/"
        aria-label="Inicio"
        className="shrink-0 md:hidden">
        <LogoIcon
          className="size-6"
          autoAnimating={autoAnimating}
        />
      </Link>
      <Input
        className="min-w-0 flex-1 md:max-w-lg"
        placeholder="Buscar incidente..."
        type="search"
        value={searchInputValue}
        onChange={(e) => handleSearchChange(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <div className="max-md:hidden">
          <StationFilterPopover stationItems={stationItems} />
        </div>
        <div className="max-md:hidden">
          <IncidentTypeFilterPopover incidentTypes={incidentTypes} />
        </div>
        <div className="max-md:hidden">
          <DateRangeFilterPopover />
        </div>
        {activeFiltersCount > 0 && (
          <div className="max-md:hidden">
            <Button
              size="sm"
              variant="link"
              onClick={handleResetFilters}>
              Reestablecer filtros
            </Button>
          </div>
        )}
        <div className="md:hidden">
          <FilterSheet
            activeFiltersCount={activeFiltersCount}
            incidentTypes={incidentTypes}
            onResetFilters={handleResetFilters}
            stationItems={stationItems}
          />
        </div>
      </div>
      <MobileHeaderNav className="md:hidden" />
    </div>
  );
}

function FilterSheet({
  activeFiltersCount,
  stationItems,
  onResetFilters,
  incidentTypes
}: {
  activeFiltersCount: number;
  stationItems: { value: string; label: string }[];
  onResetFilters: () => void;
  incidentTypes: ListIncidentTypesResponse["items"];
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="sm"
          />
        }>
        <span>Filtros</span>
        {activeFiltersCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
            {activeFiltersCount}
          </span>
        )}
        <CaretDownIcon className="size-4" />
      </SheetTrigger>
      <SheetPopup
        side="right"
        className="h-dvh w-[100dvw] max-w-none overflow-hidden rounded-none border-none">
        <SheetHeader>
          <SheetTitle>Filtros</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetPanel>
            <div className="flex flex-col gap-6">
              <StationFilterContent
                inputId="stations-select-mobile"
                stationItems={stationItems}
              />
              <IncidentTypeFilterContent
                incidentTypes={incidentTypes}
                inputId="incident-types-select-mobile"
              />
              <DateRangeFilterContent />
            </div>
          </SheetPanel>
        </div>
        <SheetFooter>
          <SheetClose
            render={
              <Button
                className="w-full"
                disabled={activeFiltersCount === 0}
                variant="outline"
                onClick={onResetFilters}
              />
            }>
            Reestablecer filtros
          </SheetClose>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}
