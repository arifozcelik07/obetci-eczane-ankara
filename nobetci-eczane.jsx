import { useEffect, useMemo, useRef, useState } from "react";

function calcDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function parseLoc(loc) {
  if (!loc) return null;
  const parts = String(loc).split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]); const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parseIlIlce(input) {
  const cleaned = String(input || "").replace("(GPS)", "").trim();
  const parts = cleaned.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { il: parts[0], ilce: parts[1] };
  return { il: parts[0] || "", ilce: "" };
}

async function fetchDutyPharmacies(il, ilce) {
  let url = `https://api.collectapi.com/health/dutyPharmacy?il=${encodeURIComponent(il)}`;
  if (ilce) url += `&ilce=${encodeURIComponent(ilce)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { authorization: "apikey 4q1ZMO4lF6Yw7CROtq8xBj:4aSRD0VrbbbRod52SQeKva", "content-type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success !== true) throw new Error("API Hatası");
  return Array.isArray(data?.result) ? data.result : [];
}

async function ensureLeafletLoaded() {
  if (typeof window === "undefined") return null;
  if (window.L && window.L.map) return window.L;
  const cssHref = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  const jsSrc = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  if (!document.querySelector('link[data-leaflet-css="true"]')) {
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = cssHref; link.setAttribute("data-leaflet-css", "true"); document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-leaflet-js="true"]')) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = jsSrc; script.async = true; script.defer = true; script.setAttribute("data-leaflet-js", "true"); script.onload = resolve; script.onerror = reject; document.body.appendChild(script);
    });
  }
  if (!window.L || !window.L.map) throw new Error("Leaflet yüklenemedi.");
  
  if (!document.querySelector('style[data-user-live-pulse="true"]')) {
    const style = document.createElement("style"); style.setAttribute("data-user-live-pulse", "true");
    style.textContent = `
      @keyframes userLivePulse { 0% { transform: scale(0.6); opacity: 0.95; } 70% { transform: scale(1.8); opacity: 0.08; } 100% { transform: scale(2.1); opacity: 0; } }
      .user-live-wrapper { position: relative; width: 22px; height: 22px; }
      .user-live-ring { position: absolute; inset: 0; border-radius: 9999px; background: rgba(59, 130, 246, 0.28); animation: userLivePulse 1.8s ease-out infinite; }
      .user-live-dot { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; transform: translate(-50%, -50%); border-radius: 9999px; background: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22); }
      @keyframes confirmPop { 0% { transform: scale(0.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      .confirm-badge { animation: confirmPop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
    `;
    document.head.appendChild(style);
  }

  if (!document.querySelector('link[data-lrm-css="true"]')) {
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css"; link.setAttribute("data-lrm-css", "true"); document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-lrm-js="true"]')) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"; script.async = true; script.defer = true; script.setAttribute("data-lrm-js", "true"); script.onload = resolve; script.onerror = reject; document.body.appendChild(script);
    });
  }
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
    <button onClick={onClick} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] md:text-xs font-semibold border transition-all ${selected ? "bg-blue-500/20 border-blue-500 text-blue-300" : "bg-gray-800 border-gray-700 text-gray-400 hover:border-blue-500/50"}`}>
      <span>{icon}</span> {label}
    </button>
  );
}

function PharmacyCard({ p, active, travelMode, userVote, userLocation, onSelect, onTravelChange, onVote, onToast }) {
  const hasVoted = userVote === "yes" || userVote === "no";
  const hasUserLoc = userLocation && Number.isFinite(userLocation.lat);

  // 📞 ARAMA MOTORU
  const handleCall = (e, phone) => {
    e.stopPropagation(); 
    if (!phone) return;
    const cleanedPhone = phone.replace(/\D/g, ''); 
    window.location.href = `tel:${cleanedPhone}`;
  };

  // 💬 WHATSAPP MOTORU
  const handleWhatsApp = (e, phone) => {
    e.stopPropagation(); 
    if (!phone) return;
    let cleanedPhone = phone.replace(/\D/g, '');
    if (cleanedPhone.startsWith('0')) {
      cleanedPhone = '90' + cleanedPhone.substring(1);
    } else if (!cleanedPhone.startsWith('90')) {
      cleanedPhone = '90' + cleanedPhone;
    }
    window.open(`https://wa.me/${cleanedPhone}`, '_blank');
  };

  const openExternalNavigation = (provider) => {
    if (!hasUserLoc) { onToast("⚠️ Önce konumunuzu almalısınız."); return; }
    const googleMode = travelMode === "walk" ? "walking" : travelMode === "bus" ? "transit" : "driving";
    const appleMode = travelMode === "walk" ? "w" : travelMode === "bus" ? "r" : "d";
    const origin = `${userLocation.lat},${userLocation.lng}`;
    const destination = `${p.lat},${p.lng}`;
    const url = provider === "google" 
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${googleMode}` 
      : `https://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(destination)}&dirflg=${appleMode}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onToast("Haritalar açılıyor...");
  };

  return (
    <div onClick={() => onSelect(p.id)} className={`relative rounded-2xl p-3 md:p-4 mb-2 md:mb-3 cursor-pointer border transition-all overflow-hidden group w-full ${active ? "bg-gray-800 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.1)]" : "bg-gray-900 border-gray-700 hover:border-blue-500/60 hover:bg-gray-800"}`}>
      {active && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-violet-500" />}
      
      {userVote === "yes" && (
        <div className="confirm-badge absolute top-2 right-2 flex items-center gap-1 bg-green-500/20 border border-green-500/40 px-2 py-0.5 rounded-full z-10 shadow-[0_0_15px_rgba(34,197,94,0.2)]">
          <span className="text-green-400 text-[9px] md:text-[10px] font-extrabold uppercase">✓ TEYİT EDİLDİ</span>
        </div>
      )}

      <div className="flex items-start justify-between mb-2 w-full pt-1">
        <div className="font-bold text-white text-sm md:text-base leading-snug flex-1 mr-2 break-words">💊 {p.name}</div>
        <span className="bg-blue-500/15 border border-blue-500/40 text-blue-300 text-[10px] md:text-xs font-bold px-2 py-1 rounded-lg shrink-0 whitespace-nowrap">{p.badgeText}</span>
      </div>

      <p className="text-xs text-gray-400 mb-1.5 leading-relaxed break-words">📍 {p.addr}</p>
      <p className="text-xs text-blue-400 font-semibold mb-3">📞 {p.phone}</p>
      {p.distanceText ? <p className="text-[11px] text-violet-300 font-bold mb-2">📏 {p.distanceText}</p> : null}
      
      <div className="flex gap-1.5 mb-3 w-full">
        <TravelChip icon="🚶" label="Yaya" selected={travelMode === "walk"} onClick={(e) => { e.stopPropagation(); onTravelChange("walk"); onSelect(p.id); }} />
        <TravelChip icon="🚗" label="Araç" selected={travelMode === "car"} onClick={(e) => { e.stopPropagation(); onTravelChange("car"); onSelect(p.id); }} />
        <TravelChip icon="🚌" label="Otobüs" selected={travelMode === "bus"} onClick={(e) => { e.stopPropagation(); onTravelChange("bus"); onSelect(p.id); }} />
      </div>
      
      <div className="flex gap-1.5 mb-3 w-full">
        <button onClick={(e) => handleCall(e, p.phone)} className="flex-1 h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-green-500/10 border border-green-500/35 text-green-400 hover:bg-green-500 hover:text-white transition-all">Hemen Ara</button>
        <button onClick={(e) => handleWhatsApp(e, p.phone)} className="flex-1 h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all">WhatsApp</button>
      </div>

      <div className="bg-gray-950 border border-gray-700 rounded-xl p-3 w-full mb-3">
        <p className="text-[10px] md:text-[11px] text-gray-400 font-medium mb-2">Açık mı? Teyit ederek başkalarına yardımcı ol.</p>
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); onVote("yes"); }} className={`flex-1 h-7 rounded-lg text-xs font-bold transition-all border ${userVote === "yes" ? "bg-green-500 border-green-500 text-white shadow-lg" : "bg-green-500/10 border-green-500/35 text-green-400"}`}>Evet, Açık</button>
          <button onClick={(e) => { e.stopPropagation(); onVote("no"); }} className={`flex-1 h-7 rounded-lg text-xs font-bold transition-all border ${userVote === "no" ? "bg-red-500 border-red-500 text-white" : "bg-red-500/10 border-red-500/35 text-red-400"}`}>Hayır</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 w-full">
        <button onClick={(e) => { e.stopPropagation(); openExternalNavigation("google"); }} className="h-10 rounded-xl text-[11px] md:text-xs font-extrabold flex items-center justify-center gap-2 bg-blue-600 border border-blue-500 text-white">🗺 Google</button>
        <button onClick={(e) => { e.stopPropagation(); openExternalNavigation("apple"); }} className="h-10 rounded-xl text-[11px] md:text-xs font-extrabold flex items-center justify-center gap-2 bg-slate-700 border border-slate-500 text-white">🍎 Apple</button>
      </div>
    </div>
  );
}

function LeafletMapView({ pharmacies, activeId, onSelect, travelMode, userLocation, focusToUserSeq, onToast }) {
  function MapResizer({ map, containerEl }) {
    useEffect(() => {
      if (!map) return;
      const run = () => map.invalidateSize(); run();
      const raf = requestAnimationFrame(run);
      let ro = null; if (containerEl && typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(() => run()); ro.observe(containerEl); }
      return () => { cancelAnimationFrame(raf); if (ro) ro.disconnect(); };
    }, [map, containerEl]);
    return null;
  }
  const containerRef = useRef(null); const mapRef = useRef(null); const leafletRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef([]); const userMarkerRef = useRef(null); const routingControlRef = useRef(null);
  const [routeInfo, setRouteInfo] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        const L = await ensureLeafletLoaded(); leafletRef.current = L;
        const map = L.map(containerRef.current, { zoomControl: true }).setView([39.9334, 32.8597], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© OSM' }).addTo(map);
        mapRef.current = map; setMapReady(true);
      } catch { onToast?.("Harita yüklenemedi."); }
    };
    init();
    return () => { if (mapRef.current) mapRef.current.remove(); };
  }, []);

  useEffect(() => {
    const map = mapRef.current; const L = leafletRef.current; if (!map || !L) return;
    markersRef.current.forEach(m => map.removeLayer(m)); markersRef.current = [];
    pharmacies.forEach((p) => {
      const isActive = p.id === activeId; const color = isActive ? "#60a5fa" : "#3b82f6";
      const icon = L.divIcon({ html: `<div style="width:30px;height:30px;border-radius:15px;background:rgba(59,130,246,0.18);border:2px solid ${color};display:flex;align-items:center;justify-content:center;color:${color};font-weight:900;">💊</div>`, className: "", iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
      marker.on("click", () => onSelect(p.id)); marker.bindTooltip(p.name, { direction: "top", offset: [0, -10] });
      markersRef.current.push(marker);
    });
    
    if (userMarkerRef.current) map.removeLayer(userMarkerRef.current);
    if (userLocation?.lat) {
      const userIcon = L.divIcon({ className: "", html: `<div class="user-live-wrapper"><div class="user-live-ring"></div><div class="user-live-dot"></div></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(map);
      userMarkerRef.current.bindTooltip("SİZ", { permanent: true, direction: "top", offset: [0, -10] });
    }
  }, [pharmacies, activeId, userLocation]);

  useEffect(() => { if (mapRef.current && userLocation?.lat) mapRef.current.setView([userLocation.lat, userLocation.lng], 15, { animate: true }); }, [focusToUserSeq]);

  return (
    <div className="relative w-full h-[500px] md:h-full bg-gray-950 flex-1">
      <div ref={containerRef} className="w-full h-full bg-gray-950" />
      {mapReady ? <MapResizer map={mapRef.current} containerEl={containerRef.current} /> : null}
    </div>
  );
}

export default function App() {
  const [pharmacies, setPharmacies] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [travelModes, setTravelModes] = useState({});
  const [userLocation, setUserLocation] = useState(null);
  const [focusToUserSeq, setFocusToUserSeq] = useState(0);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  const [apiError, setApiError] = useState("");
  const [toast, setToast] = useState("");
  const [view, setView] = useState("split");
  const [searchVal, setSearchVal] = useState("");
  const [allLocations, setAllLocations] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sortType, setSortType] = useState("distance");
  const [locating, setLocating] = useState(false);
  
  const [userVotes, setUserVotes] = useState(() => {
    const saved = localStorage.getItem("nobetci_eczane_votes");
    return saved ? JSON.parse(saved) : {};
  });

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  useEffect(() => {
    handleLocate(); 
    fetch("https://turkiyeapi.dev/api/v1/provinces")
      .then(res => res.json()).then(data => {
        if (data?.data) {
          const locs = []; data.data.forEach(city => {
            locs.push({ label: city.name, il: city.name, ilce: "" });
            city.districts?.forEach(dist => locs.push({ label: `${city.name}, ${dist.name}`, il: city.name, ilce: dist.name }));
          });
          setAllLocations(locs);
        }
      });
  }, []);

  const handleLocate = () => {
    setLocating(true);
    if (!navigator.geolocation) { showToast("GPS desteklenmiyor."); setLocating(false); return; }
    
    const watchId = navigator.geolocation.watchPosition((pos) => {
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (!autoFocusedRef.current) { autoFocusedRef.current = true; setFocusToUserSeq(v => v + 1); }
      setLocating(false);
    }, (err) => {
      setLocating(false);
      if (err.code === 1) showToast("⚠️ Lütfen konum izni verin (Mesafe için şart)");
    }, { enableHighAccuracy: true, timeout: 10000 });
    
    return () => navigator.geolocation.clearWatch(watchId);
  };
  const autoFocusedRef = useRef(false);

  const handleSearchInput = (e) => {
    const val = e.target.value; setSearchVal(val);
    if (val === "") { setShowSuggestions(false); setActiveId(null); return; }
    if (val.trim().length > 1) {
      const lowerVal = val.toLocaleLowerCase('tr-TR');
      setSuggestions(allLocations.filter(l => l.label.toLocaleLowerCase('tr-TR').includes(lowerVal)).slice(0, 15));
      setShowSuggestions(true);
    } else setShowSuggestions(false);
  };

  const performSearch = async (queryVal = searchVal) => {
    const { il, ilce } = parseIlIlce(queryVal); if (!il) return;
    setLoadingPharmacies(true); setApiError(""); setShowSuggestions(false);
    try {
      const data = await fetchDutyPharmacies(il, ilce);
      const mapped = data.map((x) => {
        const coords = parseLoc(x.loc); if (!coords) return null;
        return { id: String(x.loc || x.name).replace(/[^a-zA-Z0-9_-]/g, "_"), name: x.name, addr: x.address, phone: x.phone, dist: x.dist, lat: coords.lat, lng: coords.lng };
      }).filter(Boolean);
      setPharmacies(mapped); setActiveId(null);
    } catch { setApiError("Hata oluştu"); } finally { setLoadingPharmacies(false); }
  };

  const handleVote = (id, type) => {
    if (userVotes[id]) { showToast("Zaten oy kullandınız"); return; }
    const newVotes = { ...userVotes, [id]: type };
    setUserVotes(newVotes);
    localStorage.setItem("nobetci_eczane_votes", JSON.stringify(newVotes));
    showToast(type === "yes" ? "✅ Teyit edildi, teşekkürler!" : "⚠️ Kapalı bildirildi.");
  };

  const handleSelect = (id) => { setActiveId(id); const el = document.getElementById("card-" + id); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); };

  const pharmaciesView = useMemo(() => {
    let mapped = pharmacies.map((p) => {
      let distanceKm = null; let badgeText = p.dist || "—";
      if (userLocation && p.lat) { 
        const km = calcDistanceKm(userLocation.lat, userLocation.lng, p.lat, p.lng); 
        distanceKm = km; 
        badgeText = `${km.toFixed(1)} km`; 
      }
      return { ...p, badgeText, distanceKm, distanceText: distanceKm ? `Sana ${distanceKm.toFixed(1)} km uzaklıkta` : "" };
    });
    mapped.sort((a, b) => {
      if (sortType === "distance" && userLocation) return (a.distanceKm - b.distanceKm);
      return a.name.localeCompare(b.name, "tr");
    });
    return mapped;
  }, [pharmacies, userLocation, sortType]);

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-950 text-white font-sans overflow-hidden w-full max-w-[100vw]">
      <div className="bg-gray-900 border-b border-gray-800 p-2 flex items-center gap-2 shrink-0 z-50 w-full shadow-lg">
        <div className="flex-1 flex items-center gap-1.5 relative min-w-0">
          <div className="flex-1 flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg px-2 h-9 relative min-w-0">
            <span className="text-gray-500 text-xs shrink-0">🔍</span>
            <input value={searchVal} onChange={handleSearchInput} onFocus={() => searchVal.length > 1 && setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} className="flex-1 bg-transparent text-xs text-white outline-none w-full" placeholder="İl veya İlçe Ara (Örn: Çankaya)"/>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute top-11 left-0 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-[9999] max-h-60 overflow-y-auto border-t-0 rounded-t-none">
              {suggestions.map((s, i) => <li key={i} onClick={() => { setSearchVal(s.label); performSearch(s.label); }} className="px-3 py-2.5 text-xs text-gray-300 hover:bg-blue-600 hover:text-white cursor-pointer border-b border-gray-700 last:border-none transition-colors">📍 {s.label}</li>)}
            </ul>
          )}
          <button onClick={() => { handleLocate(); setFocusToUserSeq(v => v + 1); }} className={`h-9 px-3 rounded-lg text-sm flex items-center justify-center border shrink-0 transition-all ${userLocation ? "bg-blue-600 border-blue-500" : "bg-gray-800 border-gray-700 animate-pulse"}`}>📍</button>
        </div>
      </div>

      <div className="bg-blue-500/5 border-b border-blue-500/20 px-3 py-1.5 flex items-center gap-2 shrink-0">
        <span className={`w-2 h-2 rounded-full ${userLocation ? "bg-green-400" : "bg-yellow-400 animate-pulse"} shrink-0`} />
        <span className="text-blue-200 text-[10px] font-bold uppercase tracking-wider">{userLocation ? "GPS AKTİF" : "GPS ARANIYOR..."}</span>
      </div>

      <div className="relative flex-1 flex flex-col md:flex-row overflow-hidden w-full">
        {view !== "list" && (
          <div className="flex-1 w-full overflow-hidden z-0 flex flex-col relative">
            <LeafletMapView pharmacies={pharmaciesView} activeId={activeId} onSelect={handleSelect} travelMode={activeId ? travelModes[activeId] || "walk" : "walk"} userLocation={userLocation} focusToUserSeq={focusToUserSeq} onToast={showToast} />
            <div className="absolute top-4 left-4 z-[400] flex flex-col gap-2">
              <button onClick={() => setView(view === "split" ? "map" : "split")} className="p-2 bg-gray-900/90 rounded-lg border border-gray-700 text-xs hidden md:block">🖥 Görünümü Değiştir</button>
            </div>
          </div>
        )}
        {view !== "map" && (
          <div className="fixed bottom-0 left-0 right-0 z-[700] bg-gray-900/98 border-t border-gray-800 flex flex-col overflow-hidden h-[45vh] md:static md:h-full md:w-96 w-full shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/98 z-10 shrink-0">
              <span className="text-sm font-extrabold text-blue-300">{pharmaciesView.length} ECZANE</span>
              <select value={sortType} onChange={(e) => setSortType(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-[10px] px-2 py-1.5 outline-none font-bold">
                <option value="distance">MESAFEYE GÖRE</option>
                <option value="name">A'DAN Z'YE</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-2 pb-10 w-full scroll-smooth">
              {pharmaciesView.map((p) => (
                <div id={"card-" + p.id} key={p.id} className="w-full">
                  <PharmacyCard p={p} active={activeId === p.id} travelMode={travelModes[p.id] || "walk"} userVote={userVotes[p.id]} userLocation={userLocation} onSelect={handleSelect} onTravelChange={(mode) => setTravelModes(t => ({ ...t, [p.id]: mode }))} onVote={(type) => handleVote(p.id, type)} onToast={showToast} />
                </div>
              ))}
              {pharmaciesView.length === 0 && !loadingPharmacies && <div className="p-10 text-center text-gray-500 text-xs">Aradığınız bölgede nöbetçi bulunamadı.</div>}
            </div>
          </div>
        )}
      </div>
      <Toast msg={toast} />
    </div>
  );
}