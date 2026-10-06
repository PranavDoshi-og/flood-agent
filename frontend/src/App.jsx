import React, { useState, useEffect, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMapEvents,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import {
  Waves,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  MapPin,
  RefreshCw,
  Send,
  Droplets,
  Layers,
  Info,
  CheckCircle2,
  Navigation,
  Activity,
  PlusCircle,
  X,
  Search,
  Printer,
  Share2,
  FileText,
  Mountain,
  Gauge,
  PhoneCall,
  Sparkles,
  Filter,
  Compass,
  Copy,
  Check,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const CARTO_KEY = import.meta.env.VITE_CARTO_API_KEY || 'cb1_45uz_1_e25d64c324c2459646a88fac';

const MAP_STYLES = {
  dark: {
    name: 'Dark Matter',
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ''}`,
    subdomains: 'abcd',
  },
  voyager: {
    name: 'Voyager',
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ''}`,
    subdomains: 'abcd',
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
  },
};

const PRESET_CITIES = [
  { name: 'Mumbai, IN', lat: 19.076, lon: 72.8777, desc: 'Monsoon coastal basin' },
  { name: 'Jakarta, ID', lat: -6.2088, lon: 106.8456, desc: 'Rapidly sinking delta' },
  { name: 'Houston, US', lat: 29.7604, lon: -95.3698, desc: 'Bayou flood network' },
  { name: 'Venice, IT', lat: 45.4408, lon: 12.3155, desc: 'Acqua Alta lagoon surge' },
  { name: 'London, UK', lat: 51.5074, lon: -0.1278, desc: 'Thames estuary basin' },
  { name: 'Tokyo, JP', lat: 35.6762, lon: 139.6503, desc: 'Lowland storm surge zone' },
];

// Custom pulsating SVG marker for selected assessment point
const createSelectedIcon = () =>
  L.divIcon({
    className: 'custom-selected-marker',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-9 h-9 bg-sky-500/30 rounded-full animate-ping"></div>
        <div class="w-8 h-8 bg-gradient-to-tr from-sky-600 to-cyan-400 border-2 border-white rounded-full shadow-xl flex items-center justify-center text-slate-950 font-bold">
          <svg class="w-4 h-4 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7z"/><circle cx="12" cy="9" r="2.5" fill="currentColor"/></svg>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });

// Marker for citizen reports
const createReportIcon = (depth) => {
  const isHigh = depth === 'waist' || depth === 'impassable';
  const isKnee = depth === 'knee';
  const color = isHigh
    ? 'bg-rose-500 shadow-rose-500/50'
    : isKnee
    ? 'bg-amber-500 shadow-amber-500/50'
    : 'bg-emerald-500 shadow-emerald-500/50';

  return L.divIcon({
    className: 'custom-report-marker',
    html: `
      <div class="w-6 h-6 ${color} border-2 border-slate-950 rounded-full shadow-lg flex items-center justify-center text-white text-[10px] font-bold transition-transform hover:scale-125">
        💧
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};

// Map click listener
function MapClickHandler({ onSelectCoord }) {
  useMapEvents({
    click(e) {
      onSelectCoord(parseFloat(e.latlng.lat.toFixed(4)), parseFloat(e.latlng.lng.toFixed(4)));
    },
  });
  return null;
}

// Map smooth fly-to helper
function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, Math.max(map.getZoom(), 12), { duration: 1.2 });
    }
  }, [center, map]);
  return null;
}

export default function App() {
  const [selectedCoord, setSelectedCoord] = useState({ lat: 19.076, lon: 72.8777 });
  const [mapStyle, setMapStyle] = useState('dark');
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [dossierModalOpen, setDossierModalOpen] = useState(false);
  const [backendHealth, setBackendHealth] = useState(null);
  const [activeTab, setActiveTab] = useState('assessment'); // 'assessment' | 'telemetry' | 'protocols' | 'reports'
  const [showRadius, setShowRadius] = useState(true);
  const [showCitizenMarkers, setShowCitizenMarkers] = useState(true);
  const [depthFilter, setDepthFilter] = useState('all'); // 'all' | 'knee' | 'waist'
  const [copiedCoords, setCopiedCoords] = useState(false);

  // Search geocoding state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  // Report form state
  const [reportForm, setReportForm] = useState({
    water_depth: 'ankle',
    description: '',
    reporter_name: '',
  });
  const [submittingReport, setSubmittingReport] = useState(false);

  // Mount
  useEffect(() => {
    checkHealth();
    fetchReports();
  }, []);

  // Close search dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        setBackendHealth(data);
      } else {
        setBackendHealth({ status: 'unhealthy' });
      }
    } catch {
      setBackendHealth({ status: 'offline' });
    }
  };

  const fetchReports = async () => {
    try {
      const res = await fetch(`${API_BASE}/reports?limit=100`);
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch (err) {
      console.warn('Could not load reports:', err);
    }
  };

  const runAssessment = async (lat = selectedCoord.lat, lon = selectedCoord.lon) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server returned HTTP ${res.status}`);
      }
      const data = await res.json();
      setAssessment(data);
      fetchReports();
    } catch (err) {
      setError(err.message || 'Failed to complete assessment');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCoord = (lat, lon, label = null) => {
    setSelectedCoord({ lat, lon });
    if (label) {
      setSearchQuery(label);
    }
    runAssessment(lat, lon);
  };

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchOpen(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&limit=5&addressdetails=1`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data || []);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (item) => {
    const lat = parseFloat(parseFloat(item.lat).toFixed(4));
    const lon = parseFloat(parseFloat(item.lon).toFixed(4));
    handleSelectCoord(lat, lon, item.display_name.split(',')[0]);
    setSearchOpen(false);
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handleSelectCoord(
          parseFloat(pos.coords.latitude.toFixed(4)),
          parseFloat(pos.coords.longitude.toFixed(4)),
          'My Device Location'
        );
      },
      (err) => {
        alert(`Location access denied: ${err.message}`);
      }
    );
  };

  const handleCopyCoords = () => {
    const coordStr = `${selectedCoord.lat.toFixed(4)}, ${selectedCoord.lon.toFixed(4)}`;
    navigator.clipboard.writeText(coordStr);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  const handleSubmitReport = async (e) => {
    e.preventDefault();
    setSubmittingReport(true);
    try {
      const payload = {
        lat: selectedCoord.lat,
        lon: selectedCoord.lon,
        water_depth: reportForm.water_depth,
        description: reportForm.description.trim() || 'No additional details',
        reporter_name: reportForm.reporter_name.trim() || 'Anonymous Citizen',
      };
      const res = await fetch(`${API_BASE}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to submit report');
      setReportForm({ water_depth: 'ankle', description: '', reporter_name: '' });
      setReportModalOpen(false);
      await fetchReports();
      runAssessment(selectedCoord.lat, selectedCoord.lon);
    } catch (err) {
      alert(`Error submitting report: ${err.message}`);
    } finally {
      setSubmittingReport(false);
    }
  };

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'high':
        return {
          bg: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
          badge: 'bg-rose-500 text-white',
          glow: 'shadow-[0_0_25px_rgba(244,63,94,0.35)]',
          circleBorder: '#f43f5e',
          circleFill: '#f43f5e',
          icon: <ShieldAlert className="w-5 h-5 text-rose-400" />,
        };
      case 'medium':
        return {
          bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
          badge: 'bg-amber-500 text-slate-950 font-bold',
          glow: 'shadow-[0_0_25px_rgba(245,158,11,0.35)]',
          circleBorder: '#f59e0b',
          circleFill: '#f59e0b',
          icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
        };
      default:
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
          badge: 'bg-emerald-500 text-slate-950 font-bold',
          glow: 'shadow-[0_0_25px_rgba(16,185,129,0.35)]',
          circleBorder: '#10b981',
          circleFill: '#10b981',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
        };
    }
  };

  const riskStyle = getRiskColor(assessment?.risk_level);

  // Filter reports
  const filteredReports = reports.filter((r) => {
    if (depthFilter === 'waist') return r.water_depth === 'waist' || r.water_depth === 'impassable';
    if (depthFilter === 'knee')
      return r.water_depth === 'knee' || r.water_depth === 'waist' || r.water_depth === 'impassable';
    return true;
  });

  const telemetry = assessment?.telemetry;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#080d1a] text-slate-100 font-sans">
      {/* Top Header */}
      <header className="h-16 border-b border-[#1e2e56] bg-[#0b1329]/95 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 via-sky-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-sky-500/25 ring-1 ring-white/20">
            <Waves className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-sky-200 via-sky-400 to-cyan-300 bg-clip-text text-transparent">
                FLOOD AGENT
              </h1>
              <span className="hidden sm:inline text-[10px] tracking-wider font-semibold uppercase px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/30">
                Earth Flood Intelligence
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Autonomous multi-sensor risk synthesis for any global coordinate
            </p>
          </div>
        </div>

        {/* Status & Quick Actions */}
        <div className="flex items-center gap-2.5">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111c38] border border-[#1e2e56] text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                backendHealth?.status === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
            <span className="text-slate-300 font-mono text-[11px]">
              ENGINE: {backendHealth?.status === 'healthy' ? 'ONLINE (STRANDS AI)' : 'OFFLINE'}
            </span>
          </div>

          <button
            onClick={() => setDossierModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111c38] hover:bg-[#19274e] text-slate-200 border border-[#1e2e56] text-xs font-semibold transition"
            title="Export Emergency Incident Dossier"
          >
            <Printer className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline">Export Dossier</span>
          </button>

          <button
            onClick={handleGeolocate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-semibold transition"
            title="Use Current Device GPS Location"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">My Location</span>
          </button>
        </div>
      </header>

      {/* Main Layout: Map & Intelligence Drawer */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        {/* Left Map View */}
        <div className="flex-1 h-[50vh] lg:h-full relative z-10">
          <MapContainer
            center={[selectedCoord.lat, selectedCoord.lon]}
            zoom={12}
            zoomControl={false}
            scrollWheelZoom={true}
            className="h-full w-full"
          >
            <ZoomControl position="bottomright" />
            <TileLayer
              key={mapStyle}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={MAP_STYLES[mapStyle].url}
              subdomains={MAP_STYLES[mapStyle]?.subdomains || 'abcd'}
              maxZoom={19}
            />
            <MapClickHandler onSelectCoord={handleSelectCoord} />
            <MapRecenter center={[selectedCoord.lat, selectedCoord.lon]} />

            {/* Assessment Perimeter Radius (2.5 km) */}
            {showRadius && (
              <Circle
                center={[selectedCoord.lat, selectedCoord.lon]}
                radius={2500}
                pathOptions={{
                  color: riskStyle.circleBorder,
                  fillColor: riskStyle.circleFill,
                  fillOpacity: assessment ? 0.12 : 0.06,
                  weight: 2,
                  dashArray: assessment?.risk_level === 'high' ? '6, 6' : undefined,
                }}
              />
            )}

            {/* Selected Assessment Target Marker */}
            <Marker
              position={[selectedCoord.lat, selectedCoord.lon]}
              icon={createSelectedIcon()}
            >
              <Popup>
                <div className="p-1.5 text-slate-100 min-w-[180px]">
                  <div className="font-bold text-sm flex items-center gap-1.5 text-sky-400 mb-1">
                    <MapPin className="w-4 h-4" /> Assessment Center
                  </div>
                  <div className="text-xs font-mono text-slate-300">
                    {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}
                  </div>
                  {assessment && (
                    <div className="mt-2 pt-2 border-t border-slate-700/60 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">Risk Assessment:</span>
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${riskStyle.badge}`}
                      >
                        {assessment.risk_level}
                      </span>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>

            {/* Citizen Ground-Truth Markers */}
            {showCitizenMarkers &&
              filteredReports.map((rep) => (
                <Marker
                  key={rep.id}
                  position={[rep.lat, rep.lon]}
                  icon={createReportIcon(rep.water_depth)}
                >
                  <Popup>
                    <div className="p-1.5 text-slate-100 min-w-[180px]">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider mb-1 text-amber-400">
                        <Droplets className="w-3.5 h-3.5" /> {rep.water_depth} Water Depth
                      </div>
                      <p className="text-xs text-slate-300 mb-1 leading-snug">{rep.description}</p>
                      <div className="text-[10px] text-slate-400 flex items-center justify-between mt-2 pt-1 border-t border-slate-700/50">
                        <span>By: {rep.reporter_name || 'Anonymous'}</span>
                        <span className="font-mono text-slate-500">Citizen Observation</span>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
          </MapContainer>

          {/* Floating Search Bar & Presets Overlay */}
          <div className="absolute top-4 left-4 right-4 sm:right-auto sm:max-w-md z-[400] pointer-events-auto space-y-2">
            {/* Search Input Box */}
            <div ref={searchRef} className="relative">
              <form onSubmit={handleSearchSubmit} className="relative flex items-center">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.length > 2) {
                      setSearchOpen(true);
                      handleSearchSubmit(e);
                    }
                  }}
                  onFocus={() => {
                    if (searchResults.length > 0) setSearchOpen(true);
                  }}
                  placeholder="Search any city or address on Earth..."
                  className="w-full bg-[#0b1329]/90 border border-[#1e2e56] rounded-xl pl-10 pr-20 py-2.5 text-xs text-slate-100 placeholder:text-slate-400 shadow-2xl backdrop-blur-md focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50 transition"
                />
                <Search className="w-4 h-4 text-sky-400 absolute left-3 pointer-events-none" />

                <div className="absolute right-2 flex items-center gap-1">
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                        setSearchOpen(false);
                      }}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-[11px] font-bold transition flex items-center gap-1"
                  >
                    {isSearching ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Find'}
                  </button>
                </div>
              </form>

              {/* Geocoding Results Dropdown */}
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute top-full mt-1.5 w-full bg-[#0b1329]/95 border border-[#1e2e56] rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden z-50">
                  <div className="p-1.5 text-[10px] uppercase font-bold text-slate-400 tracking-wider px-3 border-b border-[#1e2e56]">
                    Global Locations Found
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-[#1e2e56]/50">
                    {searchResults.map((item) => (
                      <button
                        key={item.place_id}
                        onClick={() => handleSelectSearchResult(item)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-sky-500/10 text-slate-200 hover:text-sky-300 transition flex items-start gap-2"
                      >
                        <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                        <div className="truncate">
                          <div className="font-semibold text-slate-100 truncate">
                            {item.display_name.split(',')[0]}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {item.display_name}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Presets Pill Bar */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_CITIES.map((c) => (
                <button
                  key={c.name}
                  onClick={() => handleSelectCoord(c.lat, c.lon, c.name)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md border transition shadow-md flex items-center gap-1 ${
                    selectedCoord.lat === c.lat && selectedCoord.lon === c.lon
                      ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                      : 'bg-[#0b1329]/80 text-slate-300 border-[#1e2e56] hover:bg-[#111c38] hover:text-white'
                  }`}
                  title={c.desc}
                >
                  <span>{c.name.split(',')[0]}</span>
                </button>
              ))}

              <button
                onClick={() => {
                  const styles = ['dark', 'voyager', 'osm'];
                  const nextIdx = (styles.indexOf(mapStyle) + 1) % styles.length;
                  setMapStyle(styles[nextIdx]);
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md border border-sky-500/40 bg-sky-950/70 text-sky-300 hover:bg-sky-900/60 transition shadow-md flex items-center gap-1"
                title="Toggle Base Map Tile Theme"
              >
                <Layers className="w-3 h-3" />
                <span>{MAP_STYLES[mapStyle]?.name}</span>
              </button>
            </div>
          </div>

          {/* Coordinate HUD Bottom Pill */}
          <div className="absolute bottom-4 left-4 z-[400] bg-[#0b1329]/90 border border-[#1e2e56] px-3.5 py-2 rounded-xl shadow-xl backdrop-blur-md text-xs font-mono text-slate-300 flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <span>
                {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}
              </span>
            </span>
            <button
              onClick={handleCopyCoords}
              className="text-slate-400 hover:text-sky-300 transition flex items-center gap-1 text-[11px]"
              title="Copy GPS Coordinates"
            >
              {copiedCoords ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedCoords ? 'Copied' : 'Copy'}</span>
            </button>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              Click map anywhere to assess
            </span>
          </div>
        </div>

        {/* Right Side Panel: Risk Intelligence & Telemetry */}
        <div className="w-full lg:w-[500px] bg-[#0b1329] border-t lg:border-t-0 lg:border-l border-[#1e2e56] flex flex-col h-[50vh] lg:h-full z-20 shadow-2xl">
          {/* Side Panel Header */}
          <div className="p-4 sm:p-5 border-b border-[#1e2e56] flex items-center justify-between gap-2 bg-[#0d162f]/80 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-sky-400" />
                <h2 className="font-extrabold text-sm text-slate-100 uppercase tracking-wider">
                  Risk Intelligence
                </h2>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                Target: {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setReportModalOpen(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Report Flood</span>
              </button>

              <button
                onClick={() => runAssessment()}
                disabled={loading}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-bold text-xs shadow-lg shadow-sky-500/20 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'Evaluating...' : 'Assess'}</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-[#1e2e56] bg-[#080d1a] px-3 shrink-0">
            {[
              { id: 'assessment', label: 'Assessment', icon: ShieldAlert },
              { id: 'telemetry', label: 'Live Telemetry', icon: Gauge },
              { id: 'protocols', label: 'Safety Protocols', icon: PhoneCall },
              { id: 'reports', label: `Citizen Reports (${reports.length})`, icon: Droplets },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition ${
                    activeTab === tab.id
                      ? 'border-sky-400 text-sky-300 bg-sky-500/10'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 p-5 space-y-4 overflow-y-auto">
            {loading && (
              <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center animate-spin">
                  <Waves className="w-7 h-7 text-sky-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-sky-200">
                    Strands Agent Synthesizing Intelligence...
                  </h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed">
                    Executing 4 global tools: Open-Meteo precipitation, river catchment discharge,
                    topographical bowl elevation differential, and local citizen ground truth.
                  </p>
                </div>
              </div>
            )}

            {error && !loading && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-2">
                <div className="font-semibold flex items-center gap-2 text-rose-400">
                  <AlertTriangle className="w-4 h-4" /> Assessment Error
                </div>
                <p>{error}</p>
                <button
                  onClick={() => runAssessment()}
                  className="mt-2 text-xs font-bold text-rose-300 underline"
                >
                  Retry Request
                </button>
              </div>
            )}

            {!loading && !error && !assessment && (
              <div className="py-14 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-[#111c38] border border-[#1e2e56] flex items-center justify-center text-slate-500">
                  <Compass className="w-7 h-7 text-sky-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-200">Ready for Global Assessment</h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    Click anywhere on the world map, search an address, or trigger a preset city to
                    evaluate waterlogging risk.
                  </p>
                </div>
                <div className="pt-2 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => handleSelectCoord(19.076, 72.8777, 'Mumbai, IN')}
                    className="px-3 py-1.5 rounded-xl bg-sky-500 text-slate-950 font-bold text-xs shadow-md hover:bg-sky-400 transition"
                  >
                    Assess Mumbai, IN
                  </button>
                  <button
                    onClick={() => handleSelectCoord(-6.2088, 106.8456, 'Jakarta, ID')}
                    className="px-3 py-1.5 rounded-xl bg-[#111c38] border border-[#1e2e56] text-slate-200 font-bold text-xs hover:bg-[#1a2a52] transition"
                  >
                    Assess Jakarta, ID
                  </button>
                </div>
              </div>
            )}

            {/* TAB 1: ASSESSMENT */}
            {!loading && !error && assessment && activeTab === 'assessment' && (
              <div className="space-y-4">
                {/* Risk Banner */}
                <div
                  className={`p-4 rounded-2xl border ${riskStyle.bg} ${riskStyle.glow} transition`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-extrabold tracking-wider text-slate-400 flex items-center gap-1.5">
                      {riskStyle.icon} Assessed Risk Rating
                    </span>
                    <span
                      className={`px-3 py-0.5 rounded-full text-xs uppercase tracking-wider font-extrabold ${riskStyle.badge}`}
                    >
                      {assessment.risk_level} RISK
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <div>
                      <span className="font-semibold text-slate-400">Confidence Grade: </span>
                      <span className="capitalize font-mono font-bold text-sky-400">
                        {assessment.confidence}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Catchment Zone: <span className="font-mono text-slate-200">2.5 km</span>
                    </div>
                  </div>
                </div>

                {/* Plain-Language Citizen Summary */}
                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                    <Info className="w-3.5 h-3.5 text-sky-400" /> Plain-Language Executive Summary
                  </h4>
                  <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-normal">
                    {assessment.summary}
                  </p>
                </div>

                {/* Evidence & Primary Drivers */}
                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
                    <Activity className="w-3.5 h-3.5 text-sky-400" /> Evidence & Environmental
                    Drivers
                  </h4>
                  <ul className="space-y-2">
                    {assessment.reasons?.map((reason, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 text-xs text-slate-300 bg-[#0c1429]/60 p-2.5 rounded-lg border border-[#1e2e56]/40"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0" />
                        <span className="leading-snug">{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Citizen Recommended Actions */}
                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Recommended Citizen
                    Safety Actions
                  </h4>
                  <ul className="space-y-2">
                    {assessment.actions?.map((act, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 text-xs text-slate-200 bg-[#0c1429]/60 p-2.5 rounded-lg border border-[#1e2e56]/40"
                      >
                        <span className="w-4 h-4 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0">
                          {idx + 1}
                        </span>
                        <span className="leading-snug">{act}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* TAB 2: LIVE TELEMETRY DASHBOARD */}
            {!loading && !error && assessment && activeTab === 'telemetry' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5 text-sky-400" /> Multi-Sensor Sensor Telemetry
                  </span>
                  <span className="text-[11px] font-mono text-sky-400">4 Global Sensors Active</span>
                </div>

                {/* Telemetry Sensor Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {/* 1. Rainfall Sensor */}
                  <div className="p-3.5 rounded-xl bg-[#111c38] border border-[#1e2e56] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        🌧️ Rainfall
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono">
                        Forecast
                      </span>
                    </div>
                    <div className="text-xl font-mono font-extrabold text-slate-100">
                      {telemetry?.rainfall?.max_daily_rain_mm ?? 0}
                      <span className="text-xs font-normal text-slate-400 ml-1">mm/day max</span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <div>
                        Peak intensity:{' '}
                        <span className="text-slate-200 font-mono font-semibold">
                          {telemetry?.rainfall?.peak_hourly_intensity_mm ?? 0} mm/h
                        </span>
                      </div>
                      <div>
                        Max Probability:{' '}
                        <span className="text-sky-400 font-mono font-semibold">
                          {telemetry?.rainfall?.max_probability_pct ?? 0}%
                        </span>
                      </div>
                      {/* Probability Progress Bar */}
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 rounded-full"
                          style={{
                            width: `${Math.min(
                              telemetry?.rainfall?.max_probability_pct ?? 0,
                              100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 2. Hydrology River Sensor */}
                  <div className="p-3.5 rounded-xl bg-[#111c38] border border-[#1e2e56] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        🌊 River Basin
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          (telemetry?.hydrology?.peak_ratio_vs_normal ?? 1) >= 1.5
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {(telemetry?.hydrology?.peak_ratio_vs_normal ?? 1) >= 1.5
                          ? 'Surge'
                          : 'Normal'}
                      </span>
                    </div>
                    <div className="text-xl font-mono font-extrabold text-slate-100">
                      {telemetry?.hydrology?.peak_ratio_vs_normal ?? 1.0}x
                      <span className="text-xs font-normal text-slate-400 ml-1">vs normal</span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <div className="truncate">
                        Basin:{' '}
                        <span className="text-slate-200 font-mono">
                          {telemetry?.hydrology?.river_name || 'Catchment Grid'}
                        </span>
                      </div>
                      <div>
                        Sensor Model:{' '}
                        <span className="text-slate-200 font-mono">
                          {telemetry?.hydrology?.available ? 'GloFAS River API' : 'Regional'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 3. Topography & Elevation */}
                  <div className="p-3.5 rounded-xl bg-[#111c38] border border-[#1e2e56] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        🏔️ Topography
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          telemetry?.topography?.sits_lower
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-sky-500/20 text-sky-300'
                        }`}
                      >
                        {telemetry?.topography?.sits_lower ? 'Bowl Trap' : 'Well-Drained'}
                      </span>
                    </div>
                    <div className="text-xl font-mono font-extrabold text-slate-100">
                      {telemetry?.topography?.elevation_m ?? '--'}
                      <span className="text-xs font-normal text-slate-400 ml-1">m elevation</span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <div>
                        Relative differential:{' '}
                        <span
                          className={`font-mono font-semibold ${
                            (telemetry?.topography?.relative_elevation_m ?? 0) < 0
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {telemetry?.topography?.relative_elevation_m ?? 0} m
                        </span>
                      </div>
                      <div>
                        Waterways in 1km:{' '}
                        <span className="text-slate-200 font-mono">
                          {telemetry?.topography?.water_features_count ?? 0} mapped
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 4. Citizen Signals */}
                  <div className="p-3.5 rounded-xl bg-[#111c38] border border-[#1e2e56] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        👥 Ground Truth
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                        Crowd-Sourced
                      </span>
                    </div>
                    <div className="text-xl font-mono font-extrabold text-slate-100">
                      {telemetry?.citizen_signals?.total_reports ?? reports.length}
                      <span className="text-xs font-normal text-slate-400 ml-1">reports</span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <div>
                        High Severity (Waist+):{' '}
                        <span className="text-rose-400 font-mono font-semibold">
                          {telemetry?.citizen_signals?.high_severity_count ?? 0}
                        </span>
                      </div>
                      <div>
                        Knee Depth:{' '}
                        <span className="text-amber-400 font-mono font-semibold">
                          {telemetry?.citizen_signals?.knee_depth_count ?? 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Technical Note */}
                <div className="p-3.5 rounded-xl bg-[#0c1429] border border-[#1e2e56] text-xs text-slate-300">
                  <div className="font-bold text-sky-400 mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Sensor Harmonization Logic
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Under Flood Agent decision logic, crowd-sourced ground-truth reports take strict
                    priority over weather models for immediate street-level road passability. If
                    sensors detect high rainfall but ground truth reports zero ponding, confidence
                    is adjusted dynamically.
                  </p>
                </div>
              </div>
            )}

            {/* TAB 3: SAFETY PROTOCOLS & SOS */}
            {activeTab === 'protocols' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-rose-400">
                    <ShieldAlert className="w-4 h-4" /> Turn Around, Don't Drown Protocol
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Just <strong>6 inches (15 cm)</strong> of fast-moving floodwater can knock down
                    an adult. <strong>12 inches (30 cm)</strong> can sweep away small cars and
                    sedans. Never drive or walk through flooded roadways or underpasses.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56] space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <PhoneCall className="w-3.5 h-3.5 text-sky-400" /> Universal Emergency Contacts
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-[#0c1429] border border-[#1e2e56]">
                      <div className="text-[10px] text-slate-400">EU & India Emergency</div>
                      <div className="text-base font-mono font-bold text-sky-400">112</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0c1429] border border-[#1e2e56]">
                      <div className="text-[10px] text-slate-400">US & Canada Emergency</div>
                      <div className="text-base font-mono font-bold text-sky-400">911</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0c1429] border border-[#1e2e56]">
                      <div className="text-[10px] text-slate-400">UK Emergency</div>
                      <div className="text-base font-mono font-bold text-sky-400">999</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0c1429] border border-[#1e2e56]">
                      <div className="text-[10px] text-slate-400">Disaster Management</div>
                      <div className="text-base font-mono font-bold text-sky-400">Local NDRF / FEMA</div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56] space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Immediate Survival Checklist
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Switch off electrical mains if water enters property</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Elevate essential medical supplies, passports, and electronics</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Avoid open manholes, drains, and downed electrical poles</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>Store 3 days of clean drinking water in sealed containers</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* TAB 4: CITIZEN REPORTS LIST */}
            {activeTab === 'reports' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1">
                  <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                    {filteredReports.length} Reports Found
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'knee', label: 'Knee+' },
                      { id: 'waist', label: 'Waist+' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setDepthFilter(f.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                          depthFilter === f.id
                            ? 'bg-sky-500 text-slate-950 font-bold'
                            : 'bg-[#111c38] text-slate-400 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredReports.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No citizen reports match this filter yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredReports.map((rep) => (
                      <div
                        key={rep.id}
                        className="p-3 rounded-xl bg-[#111c38] border border-[#1e2e56] hover:border-sky-500/50 transition space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              rep.water_depth === 'waist' || rep.water_depth === 'impassable'
                                ? 'bg-rose-500/20 text-rose-300'
                                : rep.water_depth === 'knee'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {rep.water_depth} Water
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {rep.lat.toFixed(4)}, {rep.lon.toFixed(4)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 leading-snug">{rep.description}</p>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                          <span>Reported by {rep.reporter_name || 'Anonymous'}</span>
                          <button
                            onClick={() => handleSelectCoord(rep.lat, rep.lon)}
                            className="text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-0.5"
                          >
                            Fly Here &rarr;
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Side Panel Footer with Map Controls & Report CTA */}
          <div className="p-3.5 border-t border-[#1e2e56] bg-[#0d162f] flex items-center justify-between text-xs text-slate-400 shrink-0">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRadius}
                  onChange={(e) => setShowRadius(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-sky-500 focus:ring-0"
                />
                <span className="text-[11px]">Radius Zone</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCitizenMarkers}
                  onChange={(e) => setShowCitizenMarkers(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-sky-500 focus:ring-0"
                />
                <span className="text-[11px]">Citizen Pins</span>
              </label>
            </div>

            <button
              onClick={() => setReportModalOpen(true)}
              className="text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1"
            >
              <span>Submit Report</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Citizen Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0e172e] border border-[#1e2e56] rounded-2xl shadow-2xl p-6 relative">
            <button
              onClick={() => setReportModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shadow-lg">
                <Droplets className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-slate-100">
                  Submit Street Waterlogging Report
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  Coordinates: {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmitReport} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Observed Water Depth
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'ankle', label: 'Ankle', sub: '~10 cm' },
                    { id: 'knee', label: 'Knee', sub: '~30 cm' },
                    { id: 'waist', label: 'Waist', sub: '~60 cm' },
                    { id: 'impassable', label: 'Deep', sub: '1 m+' },
                  ].map((lvl) => (
                    <button
                      type="button"
                      key={lvl.id}
                      onClick={() => setReportForm({ ...reportForm, water_depth: lvl.id })}
                      className={`p-2.5 rounded-xl border text-center transition ${
                        reportForm.water_depth === lvl.id
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-bold shadow-md shadow-sky-500/10'
                          : 'bg-[#111c38] border-[#1e2e56] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-xs">{lvl.label}</div>
                      <div className="text-[10px] text-slate-500">{lvl.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Location Details & Road Conditions
                </label>
                <textarea
                  required
                  rows={3}
                  value={reportForm.description}
                  onChange={(e) => setReportForm({ ...reportForm, description: e.target.value })}
                  placeholder="e.g. Near metro entrance, storm drain overflowing, lane impassable for two-wheelers..."
                  className="w-full bg-[#111c38] border border-[#1e2e56] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Your Name / Alias (Optional)
                </label>
                <input
                  type="text"
                  value={reportForm.reporter_name}
                  onChange={(e) => setReportForm({ ...reportForm, reporter_name: e.target.value })}
                  placeholder="e.g. Volunteer Citizen / Commuter"
                  className="w-full bg-[#111c38] border border-[#1e2e56] rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReport}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-lg shadow-sky-500/20 transition disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submittingReport ? 'Broadcasting...' : 'Broadcast Report'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Emergency Incident Dossier / Print Modal */}
      {dossierModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white text-slate-900 rounded-2xl shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto relative">
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-widest text-sky-700">
                  Global Environmental Intelligence &bull; Official Incident Dossier
                </div>
                <h2 className="text-xl font-black text-slate-900 mt-0.5">
                  FLOOD RISK INTELLIGENCE BRIEFING
                </h2>
              </div>
              <button
                onClick={() => setDossierModalOpen(false)}
                className="text-slate-400 hover:text-slate-800 p-1 rounded-lg"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4 text-xs sm:text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Coordinates</div>
                  <div className="font-mono font-bold text-slate-800">
                    {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Risk Level</div>
                  <div className="font-black uppercase text-base text-rose-600">
                    {assessment?.risk_level || 'EVALUATING'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Confidence</div>
                  <div className="font-bold capitalize text-slate-800">
                    {assessment?.confidence || 'Standard'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Timestamp</div>
                  <div className="font-mono text-[11px] text-slate-600">
                    {new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-xs mb-1">
                  1. Executive Plain-Language Summary
                </h4>
                <p className="text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {assessment?.summary || 'No active assessment generated for this point yet.'}
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-xs mb-1.5">
                  2. Evidence Matrix & Primary Risk Drivers
                </h4>
                <ul className="space-y-1.5">
                  {assessment?.reasons?.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-700">
                      <span className="font-bold text-sky-700">&bull;</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-xs mb-1.5">
                  3. Actionable Citizen Emergency Directives
                </h4>
                <ul className="space-y-1.5">
                  {assessment?.actions?.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-700">
                      <span className="font-bold text-emerald-700">{i + 1}.</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t pt-4 flex items-center justify-between text-xs text-slate-500">
                <span>Autonomous AI Agent Orchestration &bull; Strands Agents SDK</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Dossier</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
