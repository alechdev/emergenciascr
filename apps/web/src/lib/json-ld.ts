import { SITE_URL } from "@/lib/site";

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const DATASET_ID = `${SITE_URL}/#dataset`;

const ORGANIZATION_NAME = "Emergencias CR";
const ORGANIZATION_DESCRIPTION =
  "Sitio independiente de monitoreo en tiempo real de incidentes atendidos por el Cuerpo de Bomberos de Costa Rica. No es el sitio oficial del Benemérito Cuerpo de Bomberos.";

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function buildOrganizationNode() {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: ORGANIZATION_NAME,
    url: SITE_URL,
    description: ORGANIZATION_DESCRIPTION,
    logo: `${SITE_URL}/favicon.svg`,
    sameAs: ["https://github.com/alechdev/emergenciascr"]
  };
}

/** Homepage: Organization + WebSite + Dataset */
export function buildHomeJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      buildOrganizationNode(),
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: ORGANIZATION_NAME,
        url: SITE_URL,
        description:
          "Historial de incidentes del Cuerpo de Bomberos de Costa Rica, con estaciones y tiempos de respuesta.",
        inLanguage: "es-CR",
        publisher: { "@id": ORGANIZATION_ID },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/incidentes?q={search_term_string}`
          },
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@type": "Dataset",
        "@id": DATASET_ID,
        name: "Incidentes de Bomberos de Costa Rica",
        description:
          "Conjunto de datos de incidentes de emergencia atendidos por el Cuerpo de Bomberos de Costa Rica, sincronizados desde SIGAE. Incluye ubicación, tipo, estaciones despachadas y tiempos de respuesta.",
        url: SITE_URL,
        creator: { "@id": ORGANIZATION_ID },
        publisher: { "@id": ORGANIZATION_ID },
        isAccessibleForFree: true,
        inLanguage: "es-CR",
        keywords: [
          "bomberos",
          "Costa Rica",
          "emergencias",
          "incidentes",
          "SIGAE",
          "tiempos de respuesta"
        ],
        spatialCoverage: {
          "@type": "Place",
          name: "Costa Rica",
          address: {
            "@type": "PostalAddress",
            addressCountry: "CR"
          }
        },
        distribution: {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `${SITE_URL}/api`
        }
      }
    ]
  };
}

export function buildCollectionPageJsonLd(input: {
  name: string;
  description: string;
  url: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.name,
    description: input.description,
    url: input.url,
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORGANIZATION_ID },
    inLanguage: "es-CR"
  };
}

export function buildIncidentJsonLd(input: {
  title: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  isOpen: boolean;
  eeConsecutive: string;
  incidentId: number;
}) {
  const hasGeo =
    input.latitude != null &&
    input.longitude != null &&
    Number(input.latitude) !== 0 &&
    Number(input.longitude) !== 0;

  return {
    "@context": "https://schema.org",
    "@type": ["Report", "Article"],
    headline: input.title,
    name: input.title,
    description: input.description,
    url: input.url,
    mainEntityOfPage: input.url,
    inLanguage: "es-CR",
    isAccessibleForFree: true,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    identifier: [
      String(input.incidentId),
      `EE-${input.eeConsecutive}`,
      ...(input.isOpen ? ["estado:abierto"] : ["estado:cerrado"])
    ],
    author: { "@id": ORGANIZATION_ID },
    publisher: {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: ORGANIZATION_NAME,
      url: SITE_URL
    },
    ...(input.address || hasGeo
      ? {
          contentLocation: {
            "@type": "Place",
            name: input.address ?? undefined,
            ...(input.address
              ? {
                  address: {
                    "@type": "PostalAddress",
                    streetAddress: input.address,
                    addressCountry: "CR"
                  }
                }
              : {}),
            ...(hasGeo
              ? {
                  geo: {
                    "@type": "GeoCoordinates",
                    latitude: Number(input.latitude),
                    longitude: Number(input.longitude)
                  }
                }
              : {})
          }
        }
      : {})
  };
}

export function buildFireStationJsonLd(input: {
  name: string;
  url: string;
  stationKey: string;
  address?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  imageUrl?: string | null;
  isOperative?: boolean | null;
}) {
  const hasGeo =
    input.latitude != null &&
    input.longitude != null &&
    Number(input.latitude) !== 0 &&
    Number(input.longitude) !== 0;

  return {
    "@context": "https://schema.org",
    "@type": "FireStation",
    name: `Estación de Bomberos ${input.name}`,
    alternateName: input.stationKey,
    url: input.url,
    image: input.imageUrl ?? undefined,
    telephone: input.phoneNumber ?? undefined,
    email: input.email ?? undefined,
    publicAccess: true,
    ...(input.isOperative == null
      ? {}
      : {
          additionalProperty: {
            "@type": "PropertyValue",
            name: "operative",
            value: input.isOperative
          }
        }),
    ...(input.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: input.address,
            addressCountry: "CR"
          }
        }
      : {}),
    ...(hasGeo
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: Number(input.latitude),
            longitude: Number(input.longitude)
          }
        }
      : {}),
    parentOrganization: {
      "@type": "EmergencyService",
      name: "Cuerpo de Bomberos de Costa Rica",
      url: "https://www.bomberos.go.cr"
    }
  };
}
