import { Link, useLocation } from "@tanstack/react-router";

import { navItems } from "@/components/layout/nav-items";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const enabledNavItems = navItems.filter((item) => item.enabled);

export function HeaderNav({ className }: { className?: string }) {
  const location = useLocation();
  const pathname = location.pathname;

  const getActiveTab = () => {
    if (pathname === "/" || pathname === "") {
      return "inicio";
    }
    if (pathname.includes("/incidentes")) {
      return "incidentes";
    }
    if (pathname.includes("/estaciones")) {
      return "estaciones";
    }
    return "inicio";
  };

  return (
    <Tabs
      className={cn("py-2", className)}
      value={getActiveTab()}>
      <div>
        <TabsList
          variant="underline"
          className="h-auto gap-0 rounded-none bg-transparent px-1 py-1 text-foreground outline-none *:shrink-0 focus:outline-none focus-visible:outline-none">
          {enabledNavItems.map((item) => {
            const value = item.title.toLowerCase().replace(" ", "-");
            const Icon = item.icon;
            return (
              <TabsTab
                className="relative border-none hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-active:bg-transparent data-active:shadow-none data-active:hover:bg-accent"
                key={item.url}
                render={<Link to={item.url} />}
                value={value}>
                <Icon size={16} />
                {item.title}
              </TabsTab>
            );
          })}
        </TabsList>
      </div>
    </Tabs>
  );
}
