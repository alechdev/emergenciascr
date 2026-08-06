import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "takumi-js/response";

import type { IncidentStatistics } from "@api/lib/utils/incidents/statistics";
import type { DetailedIncident } from "@bomberoscr/db/queries/incidents";

const size = { width: 1200, height: 630 } as const;

function getAssetPath(filename: string) {
  return join(process.cwd(), "public", "assets", filename);
}

function toDataUrl(mimeType: string, buffer: Buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function createFilmGrainRects() {
  let seed = 29;

  const next = () => {
    seed = (seed * 48271) % 0x7fffffff;
    return seed / 0x7fffffff;
  };

  return Array.from({ length: 760 }, () => {
    const x = Math.floor(next() * 1200);
    const y = Math.floor(next() * 630);
    const width = next() > 0.64 ? 2 : 1;
    const height = next() > 0.66 ? 2 : 1;
    const opacity = (0.075 + next() * 0.09).toFixed(3);
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#2A1205" opacity="${opacity}" rx="1"/>`;
  }).join("");
}

function createIncidentBackgroundDataUrl() {
  const grain = createFilmGrainRects();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
      <rect width="1200" height="630" fill="#140a03"/>
      <rect x="0" y="0" width="100" height="630" fill="url(#left0)"/>
      <rect x="100" y="0" width="100" height="630" fill="url(#left1)"/>
      <rect x="200" y="0" width="100" height="630" fill="url(#left2)"/>
      <rect x="300" y="0" width="100" height="630" fill="url(#left3)"/>
      <rect x="400" y="0" width="100" height="630" fill="url(#left4)"/>
      <rect x="500" y="0" width="100" height="630" fill="url(#left5)"/>
      <rect x="600" y="0" width="100" height="630" fill="url(#right5)"/>
      <rect x="700" y="0" width="100" height="630" fill="url(#right4)"/>
      <rect x="800" y="0" width="100" height="630" fill="url(#right3)"/>
      <rect x="900" y="0" width="100" height="630" fill="url(#right2)"/>
      <rect x="1000" y="0" width="100" height="630" fill="url(#right1)"/>
      <rect x="1100" y="0" width="100" height="630" fill="url(#right0)"/>
      <rect width="1200" height="630" fill="url(#centerGlow)"/>
      <rect width="1200" height="630" fill="url(#softWash)"/>
      <rect width="1200" height="630" fill="url(#vignette)"/>
      <g opacity="0.84">
        ${grain}
      </g>
      <defs>
        <linearGradient id="left0" x1="50" y1="0" x2="50" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#231005"/>
          <stop offset="1" stop-color="#140A03"/>
        </linearGradient>
        <linearGradient id="left1" x1="150" y1="0" x2="150" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#361505"/>
          <stop offset="1" stop-color="#231005"/>
        </linearGradient>
        <linearGradient id="left2" x1="250" y1="0" x2="250" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#532006"/>
          <stop offset="1" stop-color="#351505"/>
        </linearGradient>
        <linearGradient id="left3" x1="350" y1="0" x2="350" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#783006"/>
          <stop offset="1" stop-color="#552106"/>
        </linearGradient>
        <linearGradient id="left4" x1="450" y1="0" x2="450" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#A34107"/>
          <stop offset="1" stop-color="#742D06"/>
        </linearGradient>
        <linearGradient id="left5" x1="550" y1="0" x2="550" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#DB6512"/>
          <stop offset="1" stop-color="#A13E08"/>
        </linearGradient>
        <linearGradient id="right5" x1="650" y1="630" x2="650" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#DB6512"/>
          <stop offset="1" stop-color="#A13E08"/>
        </linearGradient>
        <linearGradient id="right4" x1="750" y1="630" x2="750" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#A34107"/>
          <stop offset="1" stop-color="#742D06"/>
        </linearGradient>
        <linearGradient id="right3" x1="850" y1="630" x2="850" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#783006"/>
          <stop offset="1" stop-color="#552106"/>
        </linearGradient>
        <linearGradient id="right2" x1="950" y1="630" x2="950" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#532006"/>
          <stop offset="1" stop-color="#351505"/>
        </linearGradient>
        <linearGradient id="right1" x1="1050" y1="630" x2="1050" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#361505"/>
          <stop offset="1" stop-color="#231005"/>
        </linearGradient>
        <linearGradient id="right0" x1="1150" y1="630" x2="1150" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#231005"/>
          <stop offset="1" stop-color="#140A03"/>
        </linearGradient>
        <radialGradient id="centerGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(600 190) rotate(90) scale(360 520)">
          <stop stop-color="#FFD79B" stop-opacity="0.14"/>
          <stop offset="1" stop-color="#FFD79B" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="softWash" x1="600" y1="0" x2="600" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#2A1205" stop-opacity="0.05"/>
          <stop offset="0.5" stop-color="#2A1205" stop-opacity="0.1"/>
          <stop offset="1" stop-color="#2A1205" stop-opacity="0.07"/>
        </linearGradient>
        <linearGradient id="vignette" x1="600" y1="0" x2="600" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#140A03" stop-opacity="0.04"/>
          <stop offset="1" stop-color="#140A03" stop-opacity="0.18"/>
        </linearGradient>
      </defs>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("es-CR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function truncateText(text: string | null | undefined, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildLocationDisplay(incident: NonNullable<DetailedIncident>) {
  const hasGeoData = incident.province && incident.canton && incident.district;
  if (hasGeoData) {
    return `${incident.district?.name || ""}, ${incident.canton?.name || ""}, ${incident.province?.name || ""}`;
  }

  return truncateText(incident.address, 120);
}

function buildIncidentTitle(incident: NonNullable<DetailedIncident>) {
  return (
    incident.importantDetails ||
    incident.specificIncidentType?.name ||
    incident.incidentType?.name ||
    incident.specificDispatchIncidentType?.name ||
    incident.dispatchIncidentType?.name ||
    "Incidente atendido"
  );
}

export async function generateOgImage(
  incident: NonNullable<DetailedIncident>,
  _statistics: IncidentStatistics
): Promise<Response> {
  const [calSans, faviconSvg] = await Promise.all([
    readFile(getAssetPath("CalSans-Regular.ttf")),
    readFile(getAssetPath("home-og-favicon.svg"))
  ]);

  const stationsCount = incident.dispatchedStations?.length || 0;
  const vehiclesCount = incident.dispatchedVehicles?.length || 0;
  const responsibleStation = incident.dispatchedStations?.[0]?.station?.name;
  const locationDisplay = buildLocationDisplay(incident) || "Ubicación no disponible";
  const incidentTitle = truncateText(buildIncidentTitle(incident), 68);
  const dateDisplay = formatDate(incident.incidentTimestamp);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#140a03",
        color: "#fffaf2",
        fontFamily: "Cal Sans"
      }}>
      <img
        src={createIncidentBackgroundDataUrl()}
        width="1200"
        height="630"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          width: "100%",
          height: "100%"
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          backgroundColor: "rgba(24, 10, 3, 0.12)"
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px 58px"
        }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "18px"
            }}>
            <img
              src={toDataUrl("image/svg+xml", faviconSvg)}
              width="54"
              height="54"
              style={{
                display: "flex",
                width: "54px",
                height: "54px"
              }}
            />
            <div
              style={{
                display: "flex",
                fontSize: "34px",
                letterSpacing: "0.02em",
                textShadow: "0 6px 24px rgba(0, 0, 0, 0.28)"
              }}>
              Emergencias CR
            </div>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: "26px",
              color: "rgba(255, 245, 232, 0.82)",
              textShadow: "0 4px 20px rgba(0, 0, 0, 0.22)"
            }}>
            {dateDisplay}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            maxWidth: "1070px",
            marginTop: "18px",
            marginBottom: "28px"
          }}>
          <div
            style={{
              display: "flex",
              fontSize: "84px",
              lineHeight: 0.95,
              letterSpacing: "-0.03em",
              color: "#fff7ef",
              textShadow: "0 8px 32px rgba(0, 0, 0, 0.34)"
            }}>
            {incidentTitle}
          </div>

          <div
            style={{
              display: "flex",
              maxWidth: "1040px",
              fontSize: "35px",
              lineHeight: 1.14,
              color: "rgba(255, 245, 232, 0.9)",
              textShadow: "0 4px 20px rgba(0, 0, 0, 0.26)"
            }}>
            {locationDisplay}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "32px"
          }}>
          <div
            style={{
              display: "flex",
              gap: "18px"
            }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "16px 20px 14px",
                borderRadius: "20px",
                backgroundColor: "rgba(24, 10, 3, 0.18)",
                minWidth: "148px"
              }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "44px",
                  lineHeight: 1,
                  color: "#fff7ef"
                }}>
                {stationsCount}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: "8px",
                  fontSize: "22px",
                  color: "rgba(255, 245, 232, 0.82)"
                }}>
                {stationsCount === 1 ? "Estación" : "Estaciones"}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "16px 20px 14px",
                borderRadius: "20px",
                backgroundColor: "rgba(24, 10, 3, 0.18)",
                minWidth: "148px"
              }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "44px",
                  lineHeight: 1,
                  color: "#fff7ef"
                }}>
                {vehiclesCount}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: "8px",
                  fontSize: "22px",
                  color: "rgba(255, 245, 232, 0.82)"
                }}>
                {vehiclesCount === 1 ? "Vehículo" : "Vehículos"}
              </div>
            </div>
          </div>

          {responsibleStation ? (
            <div
              style={{
                display: "flex",
                maxWidth: "460px",
                textAlign: "right",
                fontSize: "26px",
                lineHeight: 1.2,
                color: "rgba(255, 245, 232, 0.82)",
                textShadow: "0 4px 18px rgba(0, 0, 0, 0.2)"
              }}>
              Estación responsable: {responsibleStation}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Cal Sans",
          data: calSans.buffer as ArrayBuffer,
          style: "normal",
          weight: 400
        }
      ]
    }
  );
}
