import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "takumi-js/response";

const size = { width: 1200, height: 630 } as const;

const title = "Emergencias CR";
const description =
  "Detalles, análisis y estadísticas de las emergencias atendidas por Bomberos en tiempo real.";

function getAssetPath(filename: string) {
  return join(process.cwd(), "public", "assets", filename);
}

function toDataUrl(mimeType: string, buffer: Buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function createFilmGrainRects() {
  let seed = 17;

  const next = () => {
    seed = (seed * 48271) % 0x7fffffff;
    return seed / 0x7fffffff;
  };

  return Array.from({ length: 820 }, () => {
    const x = Math.floor(next() * 1200);
    const y = Math.floor(next() * 630);
    const width = next() > 0.62 ? 2 : 1;
    const height = next() > 0.64 ? 2 : 1;
    const opacity = (0.08 + next() * 0.1).toFixed(3);
    const fill = "#2A1205";
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" opacity="${opacity}" rx="1"/>`;
  }).join("");
}

function createStripedBackgroundDataUrl() {
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
      <g opacity="0.88">
        ${grain}
      </g>
      <defs>
        <linearGradient id="left0" x1="50" y1="0" x2="50" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#241006"/>
          <stop offset="1" stop-color="#140A03"/>
        </linearGradient>
        <linearGradient id="left1" x1="150" y1="0" x2="150" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#3A1806"/>
          <stop offset="1" stop-color="#241006"/>
        </linearGradient>
        <linearGradient id="left2" x1="250" y1="0" x2="250" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#5B2507"/>
          <stop offset="1" stop-color="#381605"/>
        </linearGradient>
        <linearGradient id="left3" x1="350" y1="0" x2="350" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#873809"/>
          <stop offset="1" stop-color="#5A2206"/>
        </linearGradient>
        <linearGradient id="left4" x1="450" y1="0" x2="450" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#BB4B0C"/>
          <stop offset="1" stop-color="#7E3107"/>
        </linearGradient>
        <linearGradient id="left5" x1="550" y1="0" x2="550" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#F07A18"/>
          <stop offset="1" stop-color="#B6490B"/>
        </linearGradient>
        <linearGradient id="right5" x1="650" y1="630" x2="650" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#F07A18"/>
          <stop offset="1" stop-color="#B6490B"/>
        </linearGradient>
        <linearGradient id="right4" x1="750" y1="630" x2="750" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#BB4B0C"/>
          <stop offset="1" stop-color="#7E3107"/>
        </linearGradient>
        <linearGradient id="right3" x1="850" y1="630" x2="850" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#873809"/>
          <stop offset="1" stop-color="#5A2206"/>
        </linearGradient>
        <linearGradient id="right2" x1="950" y1="630" x2="950" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#5B2507"/>
          <stop offset="1" stop-color="#381605"/>
        </linearGradient>
        <linearGradient id="right1" x1="1050" y1="630" x2="1050" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#3A1806"/>
          <stop offset="1" stop-color="#241006"/>
        </linearGradient>
        <linearGradient id="right0" x1="1150" y1="630" x2="1150" y2="0" gradientUnits="userSpaceOnUse">
          <stop stop-color="#241006"/>
          <stop offset="1" stop-color="#140A03"/>
        </linearGradient>
        <radialGradient id="centerGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(600 190) rotate(90) scale(360 520)">
          <stop stop-color="#FFD79B" stop-opacity="0.18"/>
          <stop offset="1" stop-color="#FFD79B" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="softWash" x1="600" y1="0" x2="600" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#2A1205" stop-opacity="0.04"/>
          <stop offset="0.5" stop-color="#2A1205" stop-opacity="0.08"/>
          <stop offset="1" stop-color="#2A1205" stop-opacity="0.06"/>
        </linearGradient>
        <linearGradient id="vignette" x1="600" y1="0" x2="600" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#140A03" stop-opacity="0.06"/>
          <stop offset="1" stop-color="#140A03" stop-opacity="0.18"/>
        </linearGradient>
      </defs>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function generateMainPageOgImage(): Promise<Response> {
  const [calSans, faviconSvg] = await Promise.all([
    readFile(getAssetPath("CalSans-Regular.ttf")),
    readFile(getAssetPath("home-og-favicon.svg"))
  ]);

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
        src={createStripedBackgroundDataUrl()}
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
          boxShadow: "inset 0 0 120px rgba(0, 0, 0, 0.18)"
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "72px 120px 86px",
          textAlign: "left"
        }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            display: "flex",
            backgroundColor: "rgba(24, 10, 3, 0.12)"
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: "24px",
            marginBottom: "44px",
            width: "100%",
            maxWidth: "930px"
          }}>
          <img
            src={toDataUrl("image/svg+xml", faviconSvg)}
            width="108"
            height="108"
            style={{
              display: "flex",
              width: "108px",
              height: "108px"
            }}
          />

          <div
            style={{
              display: "flex",
              fontSize: "94px",
              fontFamily: "Cal Sans",
              fontWeight: 400,
              letterSpacing: "0.022em",
              lineHeight: 1,
              textShadow: "0 6px 28px rgba(0, 0, 0, 0.34)"
            }}>
            {title}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            width: "100%",
            maxWidth: "930px",
            fontSize: "40px",
            fontFamily: "Cal Sans",
            fontWeight: 400,
            lineHeight: 1.25,
            color: "rgba(255, 245, 232, 0.9)",
            textShadow: "0 4px 22px rgba(0, 0, 0, 0.28)"
          }}>
          {description}
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
