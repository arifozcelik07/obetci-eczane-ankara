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

async function fetchDutyPharmacies() {
  const url = "https://api.collectapi.com/health/dutyPharmacy?il=ankara";

  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: "apikey " + import.meta.env.VITE_COLLECTAPI_KEY,
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

  window.L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });

  return window.L;
}

function Toast({ msg }) {
  return msg ? (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900 border border-green-500 text-green-400 text-sm font-semibold px-5 py-2.5 rounded-xl shadow-2xl whitespace-nowrap animate-bounce-in">
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
    const googleMode = travelMode === "walk" ? "walking" : travelMode === "bus" ? "transit" : "driving";
    const appleMode = travelMode === "walk" ? "w" : travelMode === "bus" ? "r" : "d";
    const origin = `${userLocation.lat},${userLocation.lng}`;
    const destination = `${p.lat},${p.lng}`;

    const url =
      provider === "google"
        ? `http://maps.google.com/maps?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(destination)}&dirflg=${googleMode}`
        : `https://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(destination)}&t=${appleMode}`;

    window.open(url, "_blank", "noopener,noreferrer");
    onToast(provider === "google" ? "Google Haritalar'da açılıyor..." : "Apple Haritalar'da açılıyor...");
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
      {active && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-violet-500" />}

      <div className="flex items-start justify-between mb-2">
        <div className="font-bold text-white text-sm leading-snug flex-1 mr-2">💊 {p.name}</div>
        <span className="bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-bold px-2.5 py-1 rounded-lg shrink-0">
          {p.badgeText || p.dist || "—"}
        </span>
      </div>

      <p className="text-xs text-gray-400 mb-1.5 leading-relaxed">📍 {p.addr}</p>
      <p className="text-xs text-blue-400 font-semibold mb-3">📞 {p.phone}</p>
      {p.distanceText ? <p className="text-[11px] text-violet-300 font-semibold mb-2">📏 {p.distanceText}</p> : null}

      <div className="flex gap-1.5 mb-3">
        <TravelChip icon="🚶" label="Yaya" selected={travelMode === "walk"} onClick={(e) => { e.stopPropagation(); onTravelChange("walk"); onSelect(p.id); onToast("🚶 Yaya rotası çiziliyor..."); }} />
        <TravelChip icon="🚗" label="Araç" selected={travelMode === "car"} onClick={(e) => { e.stopPropagation(); onTravelChange("car"); onSelect(p.id); onToast("🚗 Araç rotası çiziliyor..."); }} />
        <TravelChip icon="🚌" label="Otobüs" selected={travelMode === "bus"} onClick={(e) => { e.stopPropagation(); onTravelChange("bus"); onSelect(p.id); onToast("🚌 Otobüs rotası (araç) çiziliyor..."); }} />
      </div>

      <div className="flex gap-1.5 mb-3">
        <button onClick={(e) => { e.stopPropagation(); onToast("📞 " + p.phone + " aranıyor..."); }} className="flex-1 h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-green-500/10 border border-green-500/35 text-green-400 hover:bg-green-500 hover:text-white transition-all">📞 Hemen Ara</button>
        <button onClick={(e) => { e.stopPropagation(); onToast("💬 WhatsApp açılıyor..."); }} className="flex-1 h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all">💬 WhatsApp'tan Sor</button>
      </div>

      <div className="bg-gray-950 border border-gray-700 rounded-xl p-3">
        <p className="text-xs text-gray-400 font-medium mb-2">📍 Şu an buradasın, eczane açık mı?</p>
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); onVote("yes"); }} className={`flex-1 h-7 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-1 ${userVote === "yes" ? "bg-green-500 border-green-500 text-white" : "bg-green-500/10 border-green-500/35 text-green-400 hover:bg-green-500 hover:text-white"}`}>✓ Evet, Açık</button>
          <button onClick={(e) => { e.stopPropagation(); onVote("no"); }} className={`flex-1 h-7 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-1 ${userVote === "no" ? "bg-red-500 border-red-500 text-white" : "bg-red-500/10 border-red-500/35 text-red-400 hover:bg-red-500 hover:text-white"}`}>✗ Hayır, Kapalı</button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-2">{hasVoted ? "Teşekkürler, oy kaydedildi" : "Oy vermek için seçin"}</p>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button onClick={(e) => { e.stopPropagation(); openExternalNavigation("google"); }} className="h-11 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 bg-blue-600 border border-blue-500 text-white hover:bg-blue-500 transition-all">🗺 Google Haritalar ile Git</button>
        <button onClick={(e) => { e.stopPropagation(); openExternalNavigation("apple"); }} className="h-11 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 bg-slate-700 border border-slate-500 text-white hover:bg-slate-600 transition-all">🍎 Apple Haritalar ile Git</button>
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
      run();
      const raf = requestAnimationFrame(run);
      const t = setTimeout(run, 120);
      let ro = null;
      if (containerEl && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => run());
        ro.observe(containerEl);
      }
      return () => { cancelAnimationFrame(raf); clearTimeout(t); if (ro) ro.disconnect(); };
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
        const map = L.map(containerRef.current, { zoomControl: true }).setView(defaultCenter, 12);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '© OpenStreetMap contributors',
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
      try { if (mapRef.current) mapRef.current.remove(); } catch { }
      mapRef.current = null; leafletRef.current = null; markersRef.current = []; userMarkerRef.current = null; routingControlRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    markersRef.current.forEach((m) => { try { map.removeLayer(m); } catch { } });
    markersRef.current = [];

    pharmacies.forEach((p) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      const isActive = p.id === activeId;
      const color = isActive ? "#60a5fa" : "#3b82f6";
      const bg = isActive ? "rgba(96,165,250,0.25)" : "rgba(59,130,246,0.18)";
      const html = `<div style="width:30px;height:30px;border-radius:15px;background:${bg};border:2px solid ${color};display:flex;align-items:center;justify-content:center;color:${color};font-weight:900;box-shadow:0 10px 24px rgba(0,0,0,0.25);">💊</div>`;
      
      const icon = L.divIcon({ html, className: "", iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.on("click", () => onSelect(p.id));
      marker.bindTooltip(p.name, { direction: "top", offset: [0, -10] });
      markersRef.current.push(marker);
    });

    if (userMarkerRef.current) { try { map.removeLayer(userMarkerRef.current); } catch { } }
    userMarkerRef.current = null;

    if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(userLocation.lng)) {
      const userIcon = L.divIcon({ className: "", html: `<div class="user-live-wrapper"><div class="user-live-ring"></div><div class="user-live-dot"></div></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(map);
      userMarkerRef.current.bindTooltip("SİZ", { permanent: true, direction: "top", offset: [0, -10] });
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
    if (!map || !userLocation || !Number.isFinite(userLocation.lat)) return;
    map.setView([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 15), { animate: true });
  }, [focusToUserSeq, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    const active = pharmacies.find((p) => p.id === activeId);
    if (!active) return;

    if (!userLocation || !Number.isFinite(userLocation.lat)) {
      const now = Date.now();
      if (now - lastNoLocationToastRef.current > 30000) {
        lastNoLocationToastRef.current = now;
        onToast?.("Rota çizmek için önce konumunuzu alın.");
      }
      return;
    }

    if (!L.Routing || !L.Routing.control) return;

    if (routingControlRef.current) { try { map.removeControl(routingControlRef.current); } catch { } routingControlRef.current = null; }
    setRouteInfo(null);

    const isWalk = travelMode === "walk";
    const serviceUrl = isWalk ? "https://router.project-osrm.org/route/v1/foot" : "https://router.project-osrm.org/route/v1/driving";

    const control = L.Routing.control({
      waypoints: [ L.latLng(userLocation.lat, userLocation.lng), L.latLng(active.lat, active.lng) ],
      router: L.Routing.osrmv1({ serviceUrl, profile: "" }),
      addWaypoints: false, draggableWaypoints: false, routeWhileDragging: false, fitSelectedRoutes: true, show: false, createMarker: () => null,
      lineOptions: { styles: isWalk ? [{ color: "#16a34a", opacity: 0.95, weight: 5, dashArray: "10, 8" }] : [{ color: "#2563eb", opacity: 0.98, weight: 7 }] },
    }).addTo(map);

    control.on("routesfound", (e) => {
      const route = e?.routes?.[0];
      if (!route?.summary) { setRouteInfo(null); return; }
      setRouteInfo({ durationMin: Math.max(1, Math.round(route.summary.totalTime / 60)), distKm: (route.summary.totalDistance / 1000).toFixed(1) });
    });
    control.on("routingerror", () => { setRouteInfo(null); onToast?.("Rota alınamadı."); });
    routingControlRef.current = control;

    return () => { if (routingControlRef.current) { try { map.removeControl(routingControlRef.current); } catch { } routingControlRef.current = null; } };
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
  const [activeId, setActiveId] = useState(null); // AYAR 1: Başlangıçta null (boş seçim)
  const [travelModes, setTravelModes] = useState({});
  const [userVotes, setUserVotes] = useState({});
  const [userLocation, setUserLocation] = useState(null);
  const [focusToUserSeq, setFocusToUserSeq] = useState(0);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  const [apiError, setApiError] = useState("");

  const [toast, setToast] = useState("");
  const [view, setView] = useState("split");
  const [searchVal, setSearchVal] = useState(""); // AYAR 2: Başlangıç boş
  const [sortType, setSortType] = useState("distance"); // AYAR 3: Sıralama durumu eklendi
  const [locating, setLocating] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const autoFocusedRef = useRef(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const performSearch = async () => {
    setLoadingPharmacies(true);
    setApiError("");
    try {
      const data = await fetchDutyPharmacies();
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
      setActiveId(null); // AYAR 1: Her yenilemede seçimi sıfırla
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
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(next);
        if (!autoFocusedRef.current) {
          autoFocusedRef.current = true;
          setFocusToUserSeq((v) => v + 1);
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleLocate = () => {
    setLocating(true);
    showToast("📍 GPS konumu alınıyor...");
    if (!navigator.geolocation) {
      setLocating(false);
      showToast("Bu tarayıcı GPS’i desteklemiyor.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFocusToUserSeq((v) => v + 1);
        setLocating(false);
        setSortType("distance"); // Konum bulununca mesafeye göre sıralamayı otomatik seç
        showToast("✅ Konum başarıyla alındı!");
      },
      (err) => {
        setLocating(false);
        showToast(`Konum alınamadı: ${err?.message || "Lütfen izin verin"}`);
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

  // AYAR 2 VE 3: Anlık Arama/Filtreleme ve Sıralama Logic'i
  const pharmaciesView = useMemo(() => {
    // 1. Önce mesafe hesaplamalarını yap
    let mapped = pharmacies.map((p) => {
      let badgeText = p.dist || "—";
      let distanceKm = null;
      if (userLocation && Number.isFinite(userLocation.lat) && Number.isFinite(p.lat)) {
        const km = calcDistanceKm(userLocation.lat, userLocation.lng, p.lat, p.lng);
        distanceKm = km;
        badgeText = `${km.toFixed(1)} km`;
      }
      return {
        ...p,
        badgeText,
        distanceKm,
        distanceText: distanceKm !== null ? `Size ${distanceKm.toFixed(1)} km uzaklıkta` : "",
      };
    });

    // 2. Anlık Filtreleme (İlçe veya Ada göre)
    if (searchVal.trim() !== "") {
      const lowerSearch = searchVal.toLowerCase();
      mapped = mapped.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerSearch) ||
          (p.dist && p.dist.toLowerCase().includes(lowerSearch))
      );
    }

    // 3. Sıralama (Mesafeye veya Ada göre)
    mapped.sort((a, b) => {
      if (sortType === "name") {
        return a.name.localeCompare(b.name, "tr");
      } else if (sortType === "distance") {
        // Konum yoksa olanları yukarıda tut
        if (a.distanceKm === null && b.distanceKm === null) return 0;
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      }
      return 0;
    });

    return mapped;
  }, [pharmacies, userLocation, searchVal, sortType]);

  const activeTravelMode = activeId ? travelModes[activeId] || "walk" : "walk";

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white font-sans overflow-hidden">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2.5 flex items-center gap-3 shrink-0 z-10">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-lg shrink-0">💊</div>
          <div>
            <div className="text-sm font-bold leading-none">NöbetEczane</div>
            <div className="text-blue-400 text-xs font-semibold tracking-wide mt-0.5">ANKARA</div>
          </div>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 h-9">
            <span className="text-gray-500 text-sm">🔍</span>
            <input
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)} // Anlık filtreleme yapar
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder-gray-500"
              placeholder="Ankara içi ilçe veya eczane ara..."
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
            <button key={v} onClick={() => setView(v)} className={`h-9 px-3 text-xs font-bold transition-all ${view === v ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-green-500/8 border-b border-green-500/20 px-4 py-1.5 flex items-center gap-2 shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
        <span className="text-green-400 text-xs font-medium">Canlı — CollectAPI dutyPharmacy</span>
        <span className="ml-auto text-gray-500 text-xs">
          {loadingPharmacies ? "Yükleniyor..." : apiError ? "Hata: " + apiError : `${pharmaciesView.length} eczane listeleniyor`}
        </span>
      </div>

      <div className="relative flex-1 flex overflow-hidden">
        {view !== "list" && (
          <div className={`${view === "split" ? "flex-1 w-full h-screen md:h-full md:min-h-[520px]" : "w-full h-screen md:h-full md:min-h-[560px]"} overflow-hidden z-0`}>
            <LeafletMapView pharmacies={pharmaciesView} activeId={activeId} onSelect={handleSelect} travelMode={activeTravelMode} userLocation={userLocation} focusToUserSeq={focusToUserSeq} onToast={showToast} />
          </div>
        )}

        {view !== "map" && (
          <div className={`fixed bottom-0 left-0 right-0 z-[700] bg-gray-900/95 border-t border-gray-800 flex flex-col overflow-hidden backdrop-blur-sm max-h-[24vh] md:static md:z-auto md:backdrop-blur-none md:border-t-0 md:border-l md:max-h-none ${view === "list" ? "md:w-full" : "md:w-80 xl:w-96"} md:shrink-0`}>
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900/95 z-10">
              <span className="text-sm font-bold">💊 {pharmaciesView.length} Eczane</span>
              
              {/* AYAR 3: Dinamik Sıralama Seçicisi */}
              <select 
                value={sortType}
                onChange={(e) => {
                  if (e.target.value === "distance" && !userLocation) {
                    showToast("⚠️ Mesafeye göre sıralamak için önce konum izni vermelisiniz.");
                    handleLocate();
                  }
                  setSortType(e.target.value);
                }}
                className="bg-gray-800 border border-gray-700 rounded-lg text-gray-400 text-xs px-2 py-1 outline-none"
              >
                <option value="distance">En yakın önce</option>
                <option value="name">Ada göre</option>
              </select>
              
            </div>
            <div className="flex-1 overflow-y-auto p-2 md:p-3 scrollbar-thin max-h-[calc(24vh-52px)] md:max-h-none">
              {pharmaciesView.map((p) => (
                <div id={"card-" + p.id} key={p.id}>
                  <PharmacyCard p={p} active={activeId === p.id} travelMode={travelModes[p.id] || "walk"} userVote={userVotes[p.id]} userLocation={userLocation} onSelect={handleSelect} onTravelChange={(mode) => setTravelModes((t) => ({ ...t, [p.id]: mode }))} onVote={(type) => handleVote(p.id, type)} onToast={showToast} />
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