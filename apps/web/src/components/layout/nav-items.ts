import { GarageIcon, HouseLineIcon, SirenIcon } from "@phosphor-icons/react";

export const navItems = [
  {
    title: "Inicio",
    url: "/",
    icon: HouseLineIcon,
    enabled: true
  },
  {
    title: "Incidentes",
    url: "/incidentes",
    icon: SirenIcon,
    enabled: true
  },
  {
    title: "Estaciones",
    url: "/estaciones",
    icon: GarageIcon,
    enabled: true
  }
];
