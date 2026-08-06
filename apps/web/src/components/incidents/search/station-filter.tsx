import { CaretDownIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxClear,
  ComboboxChips,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Route } from "@/routes/_incidents/incidentes";

export type StationOption = {
  value: string;
  label: string;
};

export function StationFilterContent({
  stationItems,
  inputId = "stations-select",
  className
}: {
  stationItems: StationOption[];
  inputId?: string;
  className?: string;
}) {
  const navigate = Route.useNavigate();
  const { stations } = Route.useSearch();

  const selectedItems = (stations ?? [])
    .map((name) => stationItems.find((item) => item.value === name))
    .filter((item): item is StationOption => item != null);

  const handleSelect = (value: StationOption[]) => {
    const selectedStations = value.map((item) => item.value);

    void navigate({
      search: (prev) => ({
        ...prev,
        stations: selectedStations.length > 0 ? selectedStations : undefined
      }),
      replace: true,
      resetScroll: false
    });
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={inputId}>Estaciones</Label>
      <Combobox
        items={stationItems}
        multiple
        value={selectedItems}
        onValueChange={handleSelect}>
        <ComboboxChips startAddon={<MagnifyingGlassIcon />}>
          <ComboboxValue>
            {(value: StationOption[]) => {
              const selected = value ?? [];
              return (
                <>
                  {selected.map((item) => (
                    <ComboboxChip
                      aria-label={item.label}
                      key={item.value}>
                      {item.label}
                    </ComboboxChip>
                  ))}
                  <ComboboxInput
                    id={inputId}
                    aria-label="Seleccionar estaciones"
                    placeholder={selected.length > 0 ? undefined : "Seleccionar estaciones..."}
                  />
                  {selected.length > 0 && (
                    <ComboboxClear
                      aria-label="Limpiar estaciones"
                      className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent opacity-80 transition-opacity outline-none hover:opacity-100 [&_svg]:size-4">
                      <XIcon />
                    </ComboboxClear>
                  )}
                </>
              );
            }}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxPopup>
          <ComboboxEmpty>No se encontraron estaciones.</ComboboxEmpty>
          <ComboboxList>
            {(item) => (
              <ComboboxItem
                key={item.value}
                value={item}>
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}

export function StationFilterPopover({
  stationItems,
  inputId = "stations-select-desktop",
  triggerLabel = "Estaciones",
  triggerClassName
}: {
  stationItems: StationOption[];
  inputId?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { stations } = Route.useSearch();
  const selectedCount = stations?.length ?? 0;

  return (
    <Popover
      onOpenChange={setOpen}
      open={open}>
      <PopoverTrigger
        render={
          <Button
            className={triggerClassName}
            size="sm"
            variant="outline"
          />
        }>
        <span>{triggerLabel}</span>
        {selectedCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
            {selectedCount}
          </span>
        )}
        <CaretDownIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(26rem,calc(100vw-2rem))] p-0"
        sideOffset={8}>
        <StationFilterContent
          inputId={inputId}
          stationItems={stationItems}
        />
      </PopoverContent>
    </Popover>
  );
}
