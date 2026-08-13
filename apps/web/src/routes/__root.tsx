import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useLocation
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect } from "react";

import { Header } from "@/components/layout/header";
import { STATIC_OG_IMAGE_URL } from "@/lib/site";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

const brandName = "Emergencias CR";
const defaultTitle = "Emergencias CR";
const description =
  "Dashboard interactivo con estadísticas, análisis de datos y mapa de incidentes atendidos por Bomberos de Costa Rica en tiempo real. Consulta tendencias, estaciones y tiempos de respuesta.";
const keywords = [
  "dashboard de emergencias",
  "Bomberos de Costa Rica",
  "incidentes en tiempo real",
  "respuesta de emergencias",
  "estadísticas de incidentes",
  "mapa de incidentes",
  "análisis operativo",
  "estaciones de bomberos",
  "tiempo de respuesta",
  "emergencias CR"
].join(", ");

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: defaultTitle },
      { name: "description", content: description },
      { name: "keywords", content: keywords },
      { name: "application-name", content: brandName },
      { name: "robots", content: "index, follow" },
      {
        name: "googlebot",
        content: "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
      },
      // Open Graph defaults (page routes set og:url / canonical themselves)
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: brandName },
      { property: "og:title", content: defaultTitle },
      { property: "og:description", content: description },
      { property: "og:image", content: STATIC_OG_IMAGE_URL },
      // Twitter defaults
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: defaultTitle },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: STATIC_OG_IMAGE_URL }
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "manifest", href: "/manifest.json" }
    ],
    scripts: import.meta.env.PROD
      ? [
          {
            defer: true,
            src: "https://u.alech.dev/script.js",
            "data-website-id": "6de5b3a0-67fc-41dd-9263-84b16e910ad7"
          }
        ]
      : []
  }),

  component: RootComponent
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isIncidentesPage = normalizedPathname === "/incidentes";

  useEffect(() => {
    const updateViewportInlineSize = () => {
      document.documentElement.style.setProperty(
        "--viewport-inline-size",
        `${document.documentElement.clientWidth}px`
      );
    };

    updateViewportInlineSize();
    window.addEventListener("resize", updateViewportInlineSize);

    return () => {
      window.removeEventListener("resize", updateViewportInlineSize);
    };
  }, []);

  return (
    <html
      lang="es-CR"
      className="dark">
      <head>
        <HeadContent />
      </head>
      <body className={`font-sans antialiased${isIncidentesPage ? " no-page-rails" : ""}`}>
        <Header />
        <main>{children}</main>
        <TanStackDevtools
          config={{
            position: "bottom-right"
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />
            },
            {
              name: "TanStack Query",
              render: <ReactQueryDevtoolsPanel />,
              defaultOpen: true
            }
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
