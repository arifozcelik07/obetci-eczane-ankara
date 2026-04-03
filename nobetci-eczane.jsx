import { useEffect, useMemo, useRef, useState } from "react";

function calcDistanceKm(lat1, lon1, lat2, lon2) {
  // Haversine distance (km)
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function parseLoc(loc) {
  // CollectAPI returns: "lat,lon"
  if (!loc) return null;
  const parts = String(loc)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parseIlIlce(input) {
  const cleaned = String(input || "").replace("(GPS)", "").trim();
  const parts = cleaned
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length >= 2) return { il: parts[0], ilce: parts[1] };
  return { il: parts[0] || "", ilce: "" };
}

// CollectAPI: dutyPharmacy (Vite proxy üzerinden)
const COLLECTAPI_APIKEY = "4q1ZMO4lF6Yw7CROtq8xBj:4aSRD0VrbbbRod52SQeKva";
const COLLECTAPI_BASE = "/api/collect/health";

async function fetchDutyPharmacies({ il, ilce }) {
  const params = new URLSearchParams();
  params.set("il", il);
  if (ilce) params.set("ilce", ilce);

  const url = `${COLLECTAPI_BASE}/dutyPharmacy?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `apikey ${COLLECTAPI_APIKEY}`,
      "content-type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success !== true) {
    throw new Error(
      data?.message ||
        data?.error?.message ||
        `CollectAPI hatası (HTTP ${res.status})`
    );
  }

  return Array.isArray(data?.result) ? data.result : [];
}

async function ensureLeafletLoaded() {
  if (typeof window === "undefined") return null;
  if (window.L && window.L.map) return window.L;

  const cssHref = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  const jsSrc = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

  if (!document.querySelector('link[data-leaflet-css="true"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssHref;
    link.setAttribute("data-leaflet-css", "true");
    document.head.appendChild(link);
  }

  if (!document.querySelector('script[data-leaflet-js="true"]')) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = jsSrc;
      script.async = true;
      script.defer = true;
      script.setAttribute("data-leaflet-js", "true");
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  if (!window.L || !window.L.map) throw new Error("Leaflet yüklenemedi.");

  if (!document.querySelector('style[data-user-live-pulse="true"]')) {
    const style = document.createElement("style");
    style.setAttribute("data-user-live-pulse", "true");
    style.textContent = `
      @keyframes userLivePulse {
        0% { transform: scale(0.6); opacity: 0.95; }
        70% { transform: scale(1.8); opacity: 0.08; }
        100% { transform: scale(2.1); opacity: 0; }
      }
      .user-live-wrapper {
        position: relative;
        width: 22px;
        height: 22px;
      }
      .user-live-ring {
        position: absolute;
        inset: 0;
        border-radius: 9999px;
        background: rgba(59, 130, 246, 0.28);
        animation: userLivePulse 1.8s ease-out infinite;
      }
      .user-live-dot {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 10px;
        height: 10px;
        transform: translate(-50%, -50%);
        border-radius: 9999px;
        background: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22);
      }
    `;
    document.head.appendChild(style);
  }

  if (!document.querySelector('link[data-lrm-css="true"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css";
    link.setAttribute("data-lrm-css", "true");
    document.head.appendChild(link);
  }

  if (!document.querySelector('script[data-lrm-js="true"]')) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js";
      script.async = true;
      script.defer = true;
      script.setAttribute("data-lrm-js", "true");
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  // Make default marker icons work with CDN-loaded Leaflet.
  window.L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });

  return window.L;
}

function Toast({ msg }) {
  return msg ? (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-green-500 text-green-400 text-sm font-semibold px-5 py-2.5 rounded-xl shadow-2xl whitespace-nowrap animate-bounce-in">
      {msg}
    </div>
  ) : null;
}

function TravelChip({ icon, label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all ${
        selected
          ? "bg-blue-500/20 border-blue-500 text-blue-300"
          : "bg-gray-800 border-gray-700 text-gray-400 hover:border-blue-500/50"
      }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

function PharmacyCard({
  p,
  active,
  travelMode,
  userVote,
  userLocation,
  onSelect,
  onTravelChange,
  onVote,
  onToast,
}) {
  const hasVoted = userVote === "yes" || userVote === "no";
  const hasUserLoc =
    userLocation &&
    Number.isFinite(userLocation.lat) &&
    Number.isFinite(userLocation.lng);

  const openExternalNavigation = (provider) => {
    if (!hasUserLoc) {
      onToast("Önce konumunuzu alın.");
      return;
    }
    const googleMode =
      travelMode === "walk"
        ? "walking"
        : travelMode === "bus"
          ? "transit"
          : "driving";
    const appleMode =
      travelMode === "walk"
        ? "w"
        : travelMode === "bus"
          ? "r"
          : "d";
    const origin = `${userLocation.lat},${userLocation.lng}`;
    const destination = `${p.lat},${p.lng}`;

    const url =
      provider === "google"
        ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${googleMode}`
        : `https://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(destination)}&t=${appleMode}`;

    window.open(url, "_blank", "noopener,noreferrer");
    onToast(
      provider === "google"
        ? "Google Haritalar'da navigasyon açıldı."
        : "Apple Haritalar'da navigasyon açıldı."
    );
  };

  return (
    <div
      onClick={() => onSelect(p.id)}
      className={`relative rounded-2xl p-3 md:p-4 mb-2 md:mb-3 cursor-pointer border transition-all overflow-hidden group ${
        active
          ? "bg-gray-800 border-blue-500"
          : "bg-gray-900 border-gray-700 hover:border-blue-500/60 hover:bg-gray-800"
      }`}
    >
      {active && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-violet-500" />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="font-bold text-white text-sm leading-snug flex-1 mr-2">
          💊 {p.name}
        </div>
        <span className="bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-bold px-2.5 py-1 rounded-lg shrink-0">
          {p.badgeText || p.dist || "—"}
        </span>
      </div>

      {/* Address */}
      <p className="text-xs text-gray-400 mb-1.5 leading-relaxed">📍 {p.addr}</p>
      <p className="text-xs text-blue-400 font-semibold mb-3">📞 {p.phone}</p>
      {p.distanceText ? (
        <p className="text-[11px] text-violet-300 font-semibold mb-2">📏 {p.distanceText}</p>
      ) : null}

      <p className="text-[11px] text-gray-500 font-semibold mb-3">📡 CollectAPI verisi</p>

      {/* Travel Modes */}
      <div className="flex gap-1.5 mb-3">
        <TravelChip
          icon="🚶"
          label="Yaya"
          selected={travelMode === "walk"}
          onClick={(e) => {
            e.stopPropagation();
            onTravelChange("walk");
            onSelect(p.id);
            onToast("🚶 Yaya rotası çiziliyor...");
          }}
        />
        <TravelChip
          icon="🚗"
          label="Araç"
          selected={travelMode === "car"}
          onClick={(e) => {
            e.stopPropagation();
            onTravelChange("car");
            onSelect(p.id);
            onToast("🚗 Araç rotası çiziliyor...");
          }}
        />
        <TravelChip
          icon="🚌"
          label="Otobüs"
          selected={travelMode === "bus"}
          onClick={(e) => {
            e.stopPropagation();
            onTravelChange("bus");
            onSelect(p.id);
            onToast("🚌 Otobüs rotası (araç) çiziliyor...");
          }}
        />
      </div>

      {/* Call / WhatsApp */}
      <div className="flex gap-1.5 mb-3">
        <button
          onClick={(e) => { e.stopPropagation(); onToast("📞 " + p.phone + " aranıyor..."); }}
          className="flex-1 h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-green-500/10 border border-green-500/35 text-green-400 hover:bg-green-500 hover:text-white transition-all"
        >
          📞 Hemen Ara
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToast("💬 WhatsApp açılıyor..."); }}
          className="flex-1 h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"
        >
          💬 WhatsApp'tan Sor
        </button>
      </div>

      {/* Vote Section */}
      <div className="bg-gray-950 border border-gray-700 rounded-xl p-3">
        <p className="text-xs text-gray-400 font-medium mb-2">📍 Şu an buradasın, eczane açık mı?</p>
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onVote("yes"); }}
            className={`flex-1 h-7 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-1 ${
              userVote === "yes"
                ? "bg-green-500 border-green-500 text-white"
                : "bg-green-500/10 border-green-500/35 text-green-400 hover:bg-green-500 hover:text-white"
            }`}
          >
            ✓ Evet, Açık
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onVote("no"); }}
            className={`flex-1 h-7 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-1 ${
              userVote === "no"
                ? "bg-red-500 border-red-500 text-white"
                : "bg-red-500/10 border-red-500/35 text-red-400 hover:bg-red-500 hover:text-white"
            }`}
          >
            ✗ Hayır, Kapalı
          </button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-2">
          {hasVoted ? "Teşekkürler, oy kaydedildi" : "Oy vermek için seçin"}
        </p>
      </div>

      {/* External Navigation Buttons - mobile-friendly bottom actions */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            openExternalNavigation("google");
          }}
          className="h-11 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 bg-blue-600 border border-blue-500 text-white hover:bg-blue-500 transition-all"
        >
          🗺 Google Haritalar ile Git
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openExternalNavigation("apple");
          }}
          className="h-11 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 bg-slate-700 border border-slate-500 text-white hover:bg-slate-600 transition-all"
        >
          🍎 Apple Haritalar ile Git
        </button>
      </div>
    </div>
  );
}

function MapView({ pharmacies, activeId, onSelect }) {
  return (
    <div className="relative w-full h-full bg-gray-950 overflow-hidden">
      <svg viewBox="0 0 700 500" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        <rect width="700" height="500" fill="#080d16" />
        {/* Blocks */}
        {[
          [60,40,120,70],[200,30,90,55],[310,50,140,80],[480,35,100,65],
          [50,160,100,90],[170,150,130,100],[320,170,110,75],[450,150,140,95],[610,145,80,110],
          [60,300,115,85],[195,295,95,90],[310,305,120,80],[450,290,130,100],[600,300,90,80],
          [80,420,140,70],[240,410,110,80],[370,415,130,75],[520,400,100,90],
        ].map(([x,y,w,h],i) => (
          <rect key={i} x={x} y={y} width={w} height={h} rx="6" fill="#111827" stroke="#1e2d40" strokeWidth="0.5" />
        ))}
        {/* Parks */}
        <rect x="155" y="255" width="70" height="35" rx="8" fill="rgba(34,197,94,0.07)" stroke="rgba(34,197,94,0.18)" strokeWidth="1" />
        <rect x="450" y="395" width="65" height="40" rx="8" fill="rgba(34,197,94,0.07)" stroke="rgba(34,197,94,0.18)" strokeWidth="1" />
        {/* Roads */}
        <path d="M0 130 Q80 120 160 130 Q240 140 350 128 Q460 118 560 130 Q640 138 700 126" stroke="#1e2d40" strokeWidth="8" fill="none" />
        <path d="M0 270 Q100 260 200 270 Q300 280 400 268 Q500 256 600 270 Q660 278 700 265" stroke="#1e2d40" strokeWidth="8" fill="none" />
        <path d="M0 395 Q120 385 230 395 Q340 405 450 392 Q550 380 700 390" stroke="#1a2535" strokeWidth="6" fill="none" />
        <path d="M145 0 Q138 100 145 200 Q152 300 145 400 Q140 450 145 500" stroke="#1e2d40" strokeWidth="7" fill="none" />
        <path d="M295 0 Q288 80 295 160 Q302 240 295 320 Q288 400 295 500" stroke="#1e2d40" strokeWidth="7" fill="none" />
        <path d="M450 0 Q443 100 450 200 Q457 300 450 400 Q445 450 450 500" stroke="#1e2d40" strokeWidth="7" fill="none" />
        <path d="M610 0 Q605 100 610 200 Q615 300 610 500" stroke="#1a2535" strokeWidth="5" fill="none" />
        {/* User pin */}
        <circle cx="350" cy="252" r="22" fill="rgba(167,139,250,0.15)" />
        <circle cx="350" cy="252" r="12" fill="rgba(167,139,250,0.25)" />
        <circle cx="350" cy="252" r="7" fill="#a78bfa" />
        <circle cx="350" cy="252" r="3" fill="white" />
        <text x="364" y="240" fill="#a78bfa" fontSize="10" fontWeight="700" fontFamily="sans-serif">SİZ</text>
        {/* Pharmacy pins */}
        {pharmacies.map((p) => {
          const isActive = p.id === activeId;
          return (
            <g key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: "pointer" }} transform={`translate(${p.mapX},${p.mapY})`}>
              {isActive && <circle r="22" fill="rgba(59,130,246,0.2)" />}
              <path
                d="M0,-18 C-10,-18 -16,-12 -16,-6 C-16,4 0,18 0,18 C0,18 16,4 16,-6 C16,-12 10,-18 0,-18"
                fill={isActive ? "#60a5fa" : "#3b82f6"}
              />
              <circle r="5" cy="-6" fill="white" />
              <text y="-22" textAnchor="middle" fill="#e2e8f0" fontSize="9" fontWeight="700" fontFamily="sans-serif">
                {p.dist}
              </text>
            </g>
          );
        })}
        <text x="10" y="494" fill="rgba(255,255,255,0.1)" fontSize="9" fontFamily="sans-serif">
          © Simülasyon Haritası — Gerçek veriler API'den çekilir
        </text>
      </svg>
      {/* Zoom controls */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-2">
        {["+","−","🧭"].map((s,i) => (
          <div key={i} className="w-9 h-9 rounded-xl bg-gray-900/90 border border-gray-700 flex items-center justify-center text-gray-300 text-sm cursor-pointer hover:border-blue-500 hover:text-blue-400 transition-all backdrop-blur-sm">
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

function LeafletMapView({
  pharmacies,
  activeId,
  onSelect,
  travelMode,
  userLocation,
  focusToUserSeq,
  onToast,
}) {
  function MapResizer({ map, containerEl }) {
    useEffect(() => {
      if (!map) return;
      const run = () => map.invalidateSize();
      // Ensure first paint + immediate reflow cases are covered.
      run();
      const raf = requestAnimationFrame(run);
      const t = setTimeout(run, 120);

      let ro = null;
      if (containerEl && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => run());
        ro.observe(containerEl);
      }

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t);
        if (ro) ro.disconnect();
      };
    });

    return null;
  }

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const markersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const routingControlRef = useRef(null);
  const lastNoLocationToastRef = useRef(0);
  const [routeInfo, setRouteInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const L = await ensureLeafletLoaded();
        if (cancelled || !L) return;
        leafletRef.current = L;

        const defaultCenter = [39.9334, 32.8597]; // Ankara
        const map = L.map(containerRef.current, { zoomControl: true }).setView(
          defaultCenter,
          12
        );

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        mapRef.current = map;
        setMapReady(true);
        setTimeout(() => map.invalidateSize(), 0);
      } catch {
        if (!cancelled) onToast?.("Harita yüklenemedi.");
      }
    };

    init();

    return () => {
      cancelled = true;
      try {
        if (mapRef.current) mapRef.current.remove();
      } catch {
        // ignore
      }
      mapRef.current = null;
      leafletRef.current = null;
      markersRef.current = [];
      userMarkerRef.current = null;
      routingControlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    markersRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {
        // ignore
      }
    });
    markersRef.current = [];

    pharmacies.forEach((p) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      const isActive = p.id === activeId;

      const color = isActive ? "#60a5fa" : "#3b82f6";
      const bg = isActive ? "rgba(96,165,250,0.25)" : "rgba(59,130,246,0.18)";

      const html = `
        <div style="
          width:30px;height:30px;border-radius:15px;
          background:${bg};
          border:2px solid ${color};
          display:flex;align-items:center;justify-content:center;
          color:${color};
          font-weight:900;
          box-shadow:0 10px 24px rgba(0,0,0,0.25);
        ">💊</div>
      `;

      const icon = L.divIcon({
        html,
        className: "",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.on("click", () => onSelect(p.id));
      marker.bindTooltip(p.name, { direction: "top", offset: [0, -10] });
      markersRef.current.push(marker);
    });

    if (userMarkerRef.current) {
      try {
        map.removeLayer(userMarkerRef.current);
      } catch {
        // ignore
      }
    }
    userMarkerRef.current = null;

    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
      const userIcon = L.divIcon({
        className: "",
        html: `<div class="user-live-wrapper"><div class="user-live-ring"></div><div class="user-live-dot"></div></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(map);

      userMarkerRef.current.bindTooltip("SİZ", {
        permanent: true,
        direction: "top",
        offset: [0, -10],
      });
    }

    const active = pharmacies.find((p) => p.id === activeId);
    const bounds = [];
    if (userLocation) bounds.push([userLocation.lat, userLocation.lng]);
    if (active?.lat && active?.lng) bounds.push([active.lat, active.lng]);

    if (bounds.length >= 2) map.fitBounds(bounds, { padding: [20, 20] });
    else if (bounds.length === 1) map.setView(bounds[0], 13);
    setTimeout(() => map.invalidateSize(), 0);
  }, [pharmacies, activeId, userLocation, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;
    if (!Number.isFinite(userLocation.lat) || !Number.isFinite(userLocation.lng)) return;
    map.setView([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 15), {
      animate: true,
    });
  }, [focusToUserSeq, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    const active = pharmacies.find((p) => p.id === activeId);
    if (!active) return;

    if (
      !userLocation ||
      !Number.isFinite(userLocation.lat) ||
      !Number.isFinite(userLocation.lng)
    ) {
      const now = Date.now();
      if (now - lastNoLocationToastRef.current > 30000) {
        lastNoLocationToastRef.current = now;
        onToast?.("Rota çizmek için önce konumunuzu alın.");
      }
      return;
    }

    if (!L.Routing || !L.Routing.control) {
      onToast?.("Routing modülü yüklenemedi.");
      return;
    }

    if (routingControlRef.current) {
      try {
        map.removeControl(routingControlRef.current);
      } catch {
        // ignore
      }
      routingControlRef.current = null;
    }
    setRouteInfo(null);

    const isWalk = travelMode === "walk";
    const serviceUrl = isWalk
      ? "https://router.project-osrm.org/route/v1/foot"
      : "https://router.project-osrm.org/route/v1/driving";

    const control = L.Routing.control({
      waypoints: [
        L.latLng(userLocation.lat, userLocation.lng),
        L.latLng(active.lat, active.lng),
      ],
      router: L.Routing.osrmv1({
        // Mode-specific OSRM endpoint
        serviceUrl,
        // serviceUrl already contains profile segment (driving/foot)
        profile: "",
      }),
      addWaypoints: false,
      draggableWaypoints: false,
      routeWhileDragging: false,
      fitSelectedRoutes: true,
      show: false,
      createMarker: () => null,
      lineOptions: {
        styles: isWalk
          ? [
              {
                color: "#16a34a",
                opacity: 0.95,
                weight: 5,
                dashArray: "10, 8",
              },
            ]
          : [
              {
                color: "#2563eb",
                opacity: 0.98,
                weight: 7,
              },
            ],
      },
    }).addTo(map);

    control.on("routesfound", (e) => {
      const route = e?.routes?.[0];
      if (!route?.summary) {
        setRouteInfo(null);
        return;
      }
      const durationMin = Math.max(1, Math.round(route.summary.totalTime / 60));
      const distKm = (route.summary.totalDistance / 1000).toFixed(1);
      setRouteInfo({
        durationMin,
        distKm,
      });
    });

    control.on("routingerror", () => {
      setRouteInfo(null);
      onToast?.("Rota alınamadı.");
    });

    routingControlRef.current = control;

    return () => {
      if (routingControlRef.current) {
        try {
          map.removeControl(routingControlRef.current);
        } catch {
          // ignore
        }
        routingControlRef.current = null;
      }
    };
  }, [pharmacies, activeId, travelMode, userLocation, onToast]);

  return (
    <div className="relative w-full h-[500px] md:h-full bg-gray-950">
      <div ref={containerRef} className="w-full h-[500px] md:h-full bg-gray-950" />
      {mapReady ? <MapResizer map={mapRef.current} containerEl={containerRef.current} /> : null}
      {routeInfo ? (
        <div className="absolute top-3 right-3 z-[500] bg-gray-900/90 border border-blue-500/35 text-blue-200 text-xs font-semibold px-3 py-2 rounded-xl backdrop-blur-sm shadow-lg">
          <div>🧭 {routeInfo.durationMin} dakikada varabilirsiniz</div>
          <div className="text-[11px] text-gray-300 mt-0.5">Mesafe: {routeInfo.distKm} km</div>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [pharmacies, setPharmacies] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [travelModes, setTravelModes] = useState({});
  const [userVotes, setUserVotes] = useState({});
  const [userLocation, setUserLocation] = useState(null);
  const [focusToUserSeq, setFocusToUserSeq] = useState(0);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  const [apiError, setApiError] = useState("");

  const [toast, setToast] = useState("");
  const [view, setView] = useState("split");
  const [searchVal, setSearchVal] = useState("Ankara, Çankaya");
  const [locating, setLocating] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const autoFocusedRef = useRef(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const performSearch = async () => {
    const { il, ilce } = parseIlIlce(searchVal);
    if (!il) {
      showToast("İl bilgisi girin (örn: Ankara).");
      return;
    }

    setLoadingPharmacies(true);
    setApiError("");
    try {
      const data = await fetchDutyPharmacies({ il, ilce });
      const mapped = data
        .map((x) => {
          const coords = parseLoc(x.loc);
          if (!coords) return null;

          const rawId = x.loc || `${x.name}-${x.address}`;
          const id = String(rawId).replace(/[^a-zA-Z0-9_-]/g, "_");
          return {
            id,
            name: x.name || "Eczane",
            addr: x.address || "",
            phone: x.phone || "",
            dist: x.dist || "",
            lat: coords.lat,
            lng: coords.lng,
          };
        })
        .filter(Boolean);

      setPharmacies(mapped);
      setApiError(mapped.length ? "" : "Sonuç bulunamadı.");
      setLastUpdatedAt(Date.now());
      setActiveId((prev) => (prev === null ? mapped?.[0]?.id || null : prev));
    } catch (e) {
      setPharmacies([]);
      setApiError(e?.message || "API hatası oluştu.");
      setActiveId(null);
    } finally {
      setLoadingPharmacies(false);
    }
  };

  useEffect(() => {
    performSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return undefined;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLocation(next);
        if (!autoFocusedRef.current) {
          autoFocusedRef.current = true;
          setFocusToUserSeq((v) => v + 1);
        }
      },
      () => {
        // Sessiz geç: kullanıcı izin vermezse butonla tekrar isteyebilir.
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleLocate = () => {
    setLocating(true);
    // Kullanıcının arama kutusunda yazdığı il/ilçeye göre eczaneleri güncelle
    performSearch();
    showToast("📍 GPS konumu alınıyor...");
    if (!navigator.geolocation) {
      setLocating(false);
      showToast("Bu tarayıcı GPS’i desteklemiyor.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setFocusToUserSeq((v) => v + 1);
        setLocating(false);
        showToast("✅ Konum başarıyla alındı!");
      },
      (err) => {
        setLocating(false);
        showToast(`Konum alınamadı: ${err?.message || "izin verin"}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  };

  const handleVote = (id, type) => {
    if (userVotes[id]) { showToast("Zaten oy kullandınız"); return; }
    setUserVotes((v) => ({ ...v, [id]: type }));
    showToast(type === "yes" ? "✅ Açık olduğunu bildirdiniz!" : "⚠️ Kapalı olduğunu bildirdiniz!");
  };

  const handleSelect = (id) => {
    setActiveId(id);
    const el = document.getElementById("card-" + id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const pharmaciesView = useMemo(() => {
    return pharmacies.map((p) => {
      let badgeText = p.dist || "—";
      let distanceKm = null;
      if (
        userLocation &&
        Number.isFinite(userLocation.lat) &&
        Number.isFinite(userLocation.lng) &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng)
      ) {
        const km = calcDistanceKm(
          userLocation.lat,
          userLocation.lng,
          p.lat,
          p.lng
        );
        distanceKm = km;
        badgeText = `${km.toFixed(1)} km`;
      }
      return {
        ...p,
        badgeText,
        distanceKm,
        distanceText:
          distanceKm !== null ? `Size ${distanceKm.toFixed(1)} km uzaklıkta` : "",
      };
    });
  }, [pharmacies, userLocation]);

  const activeTravelMode = activeId ? travelModes[activeId] || "walk" : "walk";

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white font-sans overflow-hidden">

      {/* Topbar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2.5 flex items-center gap-3 shrink-0 z-10">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-lg shrink-0">💊</div>
          <div>
            <div className="text-sm font-bold leading-none">NöbetEczane</div>
            <div className="text-blue-400 text-xs font-semibold tracking-wide mt-0.5">TÜRKİYE</div>
          </div>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 h-9">
            <span className="text-gray-500 text-sm">🔍</span>
            <input
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") performSearch();
              }}
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder-gray-500"
              placeholder="İl veya ilçe giriniz..."
            />
          </div>
          <button
            onClick={handleLocate}
            className={`h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all shrink-0 ${
              locating
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-blue-500/10 border-blue-500 text-blue-400 hover:bg-blue-600 hover:text-white"
            }`}
          >
            📍 {locating ? "Alınıyor..." : "Konumumu Bul"}
          </button>
        </div>
        <div className="hidden sm:flex bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shrink-0">
          {[["split","🗺 Harita+Liste"],["map","🗺 Harita"],["list","☰ Liste"]].map(([v,l]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`h-9 px-3 text-xs font-bold transition-all ${view === v ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-green-500/8 border-b border-green-500/20 px-4 py-1.5 flex items-center gap-2 shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
        <span className="text-green-400 text-xs font-medium">Canlı — CollectAPI dutyPharmacy</span>
        <span className="ml-auto text-gray-500 text-xs">
          {loadingPharmacies
            ? "Yükleniyor..."
            : apiError
              ? "Hata: " + apiError
              : `Son güncelleme: ${
                  lastUpdatedAt
                    ? `${Math.max(1, Math.round((Date.now() - lastUpdatedAt) / 60000))} dk önce`
                    : "—"
                } · ${pharmaciesView.length} nöbetçi bulundu`}
        </span>
      </div>

      {/* Main */}
      <div className="relative flex-1 flex overflow-hidden">

        {/* Map */}
        {view !== "list" && (
          <div
            className={`${
              view === "split"
                ? "flex-1 w-full h-screen md:h-full md:min-h-[520px]"
                : "w-full h-screen md:h-full md:min-h-[560px]"
            } overflow-hidden z-0`}
          >
            <LeafletMapView
              pharmacies={pharmaciesView}
              activeId={activeId}
              onSelect={handleSelect}
              travelMode={activeTravelMode}
              userLocation={userLocation}
              focusToUserSeq={focusToUserSeq}
              onToast={showToast}
            />
          </div>
        )}

        {/* Sidebar / List */}
        {view !== "map" && (
          <div
            className={`fixed bottom-0 left-0 right-0 z-[700] bg-gray-900/95 border-t border-gray-800 flex flex-col overflow-hidden backdrop-blur-sm
              max-h-[24vh]
              md:static md:z-auto md:backdrop-blur-none md:border-t-0 md:border-l md:max-h-none
              ${view === "list" ? "md:w-full" : "md:w-80 xl:w-96"} md:shrink-0`}
          >
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900/95 z-10">
              <span className="text-sm font-bold">💊 {pharmaciesView.length} Nöbetçi Eczane</span>
              <select className="bg-gray-800 border border-gray-700 rounded-lg text-gray-400 text-xs px-2 py-1 outline-none">
                <option>En yakın önce</option>
                <option>Ada göre</option>
                <option>Teyit sayısına göre</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-2 md:p-3 scrollbar-thin max-h-[calc(24vh-52px)] md:max-h-none">
              {pharmaciesView.map((p) => (
                <div id={"card-" + p.id} key={p.id}>
                  <PharmacyCard
                    p={p}
                    active={activeId === p.id}
                    travelMode={travelModes[p.id] || "walk"}
                    userVote={userVotes[p.id]}
                    userLocation={userLocation}
                    onSelect={handleSelect}
                    onTravelChange={(mode) => setTravelModes((t) => ({ ...t, [p.id]: mode }))}
                    onVote={(type) => handleVote(p.id, type)}
                    onToast={showToast}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Toast msg={toast} />
    </div>
  );
}