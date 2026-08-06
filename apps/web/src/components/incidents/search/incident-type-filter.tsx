import { CaretDownIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { Fragment, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxClear,
  ComboboxChips,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSeparator,
  ComboboxValue
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Route } from "@/routes/_incidents/incidentes";

import type { ListIncidentTypesResponse } from "@/lib/api/types.gen";

type IncidentType = ListIncidentTypesResponse["items"][number];

type IncidentTypeOption = {
  value: string;
  label: string;
  code: string;
};

type IncidentTypeGroup = {
  value: string;
  label: string;
  items: IncidentTypeOption[];
};

function compareIncidentCodes(a: string, b: string) {
  const aParts = a.split(".").map((part) => Number.parseInt(part, 10));
  const bParts = b.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];

    if (aPart == null) {
      return -1;
    }

    if (bPart == null) {
      return 1;
    }

    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return a.localeCompare(b);
}

function getRootType(type: IncidentType, typesByCode: Map<string, IncidentType>) {
  let current = type;

  while (current.parentCode) {
    const parent = typesByCode.get(current.parentCode);
    if (!parent) {
      break;
    }

    current = parent;
  }

  return current;
}

function buildIncidentTypeGroups(incidentTypes: IncidentType[]): IncidentTypeGroup[] {
  const typesByCode = new Map(incidentTypes.map((type) => [type.code, type]));
  const groupsByCode = new Map<string, IncidentTypeGroup>();

  for (const type of incidentTypes) {
    if (type.level <= 1) {
      continue;
    }

    const rootType = getRootType(type, typesByCode);
    const existingGroup = groupsByCode.get(rootType.code);

    if (existingGroup) {
      existingGroup.items.push({
        value: type.code,
        label: type.name,
        code: type.code
      });
      continue;
    }

    groupsByCode.set(rootType.code, {
      value: rootType.code,
      label: rootType.name,
      items: [
        {
          value: type.code,
          label: type.name,
          code: type.code
        }
      ]
    });
  }

  return Array.from(groupsByCode.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => compareIncidentCodes(a.code, b.code))
    }))
    .sort((a, b) => compareIncidentCodes(a.value, b.value));
}

export function IncidentTypeFilterContent({
  incidentTypes,
  inputId = "incident-types-select",
  className
}: {
  incidentTypes: IncidentType[];
  inputId?: string;
  className?: string;
}) {
  const navigate = Route.useNavigate();
  const { incidentCodes } = Route.useSearch();

  const groupedItems = useMemo(() => buildIncidentTypeGroups(incidentTypes), [incidentTypes]);
  const optionsByCode = useMemo(
    () => new Map(groupedItems.flatMap((group) => group.items.map((item) => [item.value, item]))),
    [groupedItems]
  );

  const selectedItems = (incidentCodes ?? [])
    .map((code) => optionsByCode.get(code))
    .filter((item): item is IncidentTypeOption => item != null);

  const handleSelect = (value: IncidentTypeOption[]) => {
    const selectedCodes = value.map((item) => item.value);

    void navigate({
      search: (prev) => ({
        ...prev,
        incidentCodes: selectedCodes.length > 0 ? selectedCodes : undefined
      }),
      replace: true,
      resetScroll: false
    });
  };

  const lastGroupCode = groupedItems.at(-1)?.value;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={inputId}>Tipo de incidente</Label>
      <Combobox
        items={groupedItems}
        multiple
        value={selectedItems}
        onValueChange={handleSelect}>
        <ComboboxChips startAddon={<MagnifyingGlassIcon />}>
          <ComboboxValue>
            {(value: IncidentTypeOption[]) => {
              const selected = value ?? [];
              return (
                <>
                  {selected.map((item) => (
                    <ComboboxChip
                      aria-label={`${item.label} (${item.code})`}
                      key={item.value}>
                      {item.label}
                    </ComboboxChip>
                  ))}
                  <ComboboxInput
                    id={inputId}
                    aria-label="Seleccionar tipos de incidente"
                    placeholder={
                      selected.length > 0 ? undefined : "Seleccionar tipos de incidente..."
                    }
                  />
                  {selected.length > 0 && (
                    <ComboboxClear
                      aria-label="Limpiar tipos de incidente"
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
          <ComboboxEmpty>No se encontraron tipos de incidente.</ComboboxEmpty>
          <ComboboxList scrollFade="bottom">
            {(group: IncidentTypeGroup) => (
              <Fragment key={group.value}>
                <ComboboxGroup items={group.items}>
                  <ComboboxGroupLabel className="sticky top-0 z-10 bg-popover">
                    {group.label}
                  </ComboboxGroupLabel>
                  <ComboboxCollection>
                    {(item: IncidentTypeOption) => (
                      <ComboboxItem
                        key={item.value}
                        value={item}>
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="line-clamp-1">{item.label}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {item.code}
                          </span>
                        </div>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
                {group.value !== lastGroupCode && <ComboboxSeparator />}
              </Fragment>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}

export function IncidentTypeFilterPopover({
  incidentTypes,
  inputId = "incident-types-select-desktop",
  triggerLabel = "Tipo",
  triggerClassName
}: {
  incidentTypes: IncidentType[];
  inputId?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { incidentCodes } = Route.useSearch();
  const selectedCount = incidentCodes?.length ?? 0;

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
        className="w-[min(30rem,calc(100vw-2rem))] p-0"
        sideOffset={8}>
        <IncidentTypeFilterContent
          incidentTypes={incidentTypes}
          inputId={inputId}
        />
      </PopoverContent>
    </Popover>
  );
}
