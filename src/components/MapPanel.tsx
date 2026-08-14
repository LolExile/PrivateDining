"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { RankedVenue } from "@/lib/types";
import { formatMinutes } from "@/lib/geo";

interface MapPanelProps {
  origin: { lat: number; lng: number; label: string } | null;
  results: RankedVenue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  commuteMode: string;
}

function rankIcon(rank: number, highlighted: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="rank-marker ${rank <= 3 ? "top" : ""}" style="${highlighted ? "transform:scale(1.25);" : ""}">${rank}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
  });
}

const originIcon = L.divIcon({
  className: "",
  html: `<div class="origin-marker"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function FitToResults({ origin, results }: Pick<MapPanelProps, "origin" | "results">) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [];
    if (origin) pts.push([origin.lat, origin.lng]);
    for (const r of results) pts.push([r.venue.lat, r.venue.lng]);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 15);
    } else {
      map.fitBounds(L.latLngBounds(pts).pad(0.18));
    }
  }, [map, origin, results]);
  return null;
}

export default function MapPanel({
  origin,
  results,
  selectedId,
  onSelect,
  commuteMode,
}: MapPanelProps) {
  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToResults origin={origin} results={results} />
      {origin && (
        <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
          <Popup>
            <strong>Your address</strong>
            <br />
            {origin.label}
          </Popup>
        </Marker>
      )}
      {results.map((r) => (
        <Marker
          key={r.venue.id}
          position={[r.venue.lat, r.venue.lng]}
          icon={rankIcon(r.rank, r.venue.id === selectedId)}
          eventHandlers={{ click: () => onSelect(r.venue.id) }}
        >
          <Popup>
            <strong>
              #{r.rank} · {r.venue.name}
            </strong>
            <br />
            {r.venue.address}
            <br />
            {formatMinutes(r.commuteMinutes)} {commuteMode}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
