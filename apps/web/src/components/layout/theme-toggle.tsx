import { MoonIcon, SunIcon } from "@phosphor-icons/react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseTheme, useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      aria-label="Tema"
      className={className}
      size="sm"
      variant="outline"
      value={[theme]}
      onValueChange={(value) => {
        // Pressing the active option again would leave the group empty; keep the current theme.
        if (value.length > 0) {
          setTheme(parseTheme(value[0]));
        }
      }}>
      <ToggleGroupItem
        value="light"
        className="px-2.5">
        <SunIcon aria-hidden="true" />
        Claro
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        className="px-2.5">
        <MoonIcon aria-hidden="true" />
        Oscuro
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
