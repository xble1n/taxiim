import { createFileRoute } from "@tanstack/react-router";

function mapbox(style: string, z: string, x: string, y: string) {
  const token = process.env.MAPBOX_ACCESS_TOKEN?.trim() || process.env.MAP_API_KEY?.trim();
  if (!token) return null;
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/256/${z}/${x}/${y}?access_token=${encodeURIComponent(token)}`;
}

const ESRI_STREET = (z: string, y: string, x: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
const ESRI_SAT = (z: string, y: string, x: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const KINDS = {
  street: (z: string, x: string, y: string) => mapbox("dark-v11", z, x, y) ?? ESRI_STREET(z, y, x),
  sat: (z: string, x: string, y: string) => mapbox("satellite-v9", z, x, y) ?? ESRI_SAT(z, y, x),
  sat2: (z: string, x: string, y: string) =>
    `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`,
} as const;

export const Route = createFileRoute("/api/tiles")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const kind = url.searchParams.get("k") ?? "";
        const z = url.searchParams.get("z") ?? "";
        const x = url.searchParams.get("x") ?? "";
        const y = url.searchParams.get("y") ?? "";
        const build = KINDS[kind as keyof typeof KINDS];
        const zoom = Number(z);
        if (!build || !Number.isInteger(zoom) || zoom < 0 || zoom > 19) return new Response("Bad tile", { status: 400 });
        if (!/^\d{1,8}$/.test(x) || !/^\d{1,8}$/.test(y)) return new Response("Bad tile", { status: 400 });
        const limit = 2 ** zoom;
        if (Number(x) >= limit || Number(y) >= limit) return new Response("Bad tile", { status: 400 });
        const upstream = await fetch(build(z, x, y), { headers: { Accept: "image/jpeg,image/png,*/*" } });
        if (!upstream.ok) return new Response("Tile unavailable", { status: 502 });
        return new Response(upstream.body, {
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
            "cache-control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
