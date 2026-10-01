import React, { useState, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  useMap,
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
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const CARTO_KEY = import.meta.env.VITE_CARTO_API_KEY || 'cb1_45uz_1_e25d64c324c2459646a88fac';

const MAP_STYLES = {
  voyager: {
    name: 'Voyager',
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?api_key=${CARTO_KEY}` : ''}`,
  },
  dark: {
    name: 'Dark Matter',
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?api_key=${CARTO_KEY}` : ''}`,
  },
};

const PRESET_CITIES = [
  { name: 'Mumbai, IN', lat: 19.076, lon: 72.8777 },
  { name: 'Jakarta, ID', lat: -6.2088, lon: 106.8456 },
  { name: 'Houston, US', lat: 29.7604, lon: -95.3698 },
  { name: 'London, UK', lat: 51.5074, lon: -0.1278 },
];

// Create custom pulsating SVG marker for selected assessment point
const createSelectedIcon = () =>
  L.divIcon({
    className: 'custom-selected-marker',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-8 h-8 bg-sky-500/30 rounded-full animate-ping"></div>
        <div class="w-7 h-7 bg-sky-500 border-2 border-white rounded-full shadow-lg flex items-center justify-center text-white">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7z"/><circle cx="12" cy="9" r="2.5" fill="currentColor"/></svg>
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });

// Create marker for citizen reports
const createReportIcon = (depth) => {
  const color =
    depth === 'waist' || depth === 'impassable'
      ? 'bg-rose-500'
      : depth === 'knee'
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  return L.divIcon({
    className: 'custom-report-marker',
    html: `
      <div class="w-6 h-6 ${color} border-2 border-slate-900 rounded-full shadow-md flex items-center justify-center text-white text-[10px] font-bold">
        💧
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};

// Component to handle map clicks
function MapClickHandler({ onSelectCoord }) {
  useMapEvents({
    click(e) {
      onSelectCoord(parseFloat(e.latlng.lat.toFixed(4)), parseFloat(e.latlng.lng.toFixed(4)));
    },
  });
  return null;
}

// Map pan helper
function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, Math.max(map.getZoom(), 11), { duration: 1.2 });
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
  const [backendHealth, setBackendHealth] = useState(null);

  // New report form state
  const [reportForm, setReportForm] = useState({
    water_depth: 'ankle',
    description: '',
    reporter_name: '',
  });
  const [submittingReport, setSubmittingReport] = useState(false);

  // Check health and load reports on mount
  useEffect(() => {
    checkHealth();
    fetchReports();
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
      // Refresh reports in case new ones were recorded
      fetchReports();
    } catch (err) {
      setError(err.message || 'Failed to complete assessment');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCoord = (lat, lon) => {
    setSelectedCoord({ lat, lon });
    // Run assessment when new coordinate is picked
    runAssessment(lat, lon);
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
      // Re-run assessment so the AI agent picks up the newly filed report
      runAssessment(selectedCoord.lat, selectedCoord.lon);
    } catch (err) {
      alert(`Error submitting report: ${err.message}`);
    } finally {
      setSubmittingReport(false);
    }
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
          parseFloat(pos.coords.longitude.toFixed(4))
        );
      },
      (err) => {
        alert(`Location access denied: ${err.message}`);
      }
    );
  };

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'high':
        return {
          bg: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
          badge: 'bg-rose-500 text-white',
          glow: 'shadow-[0_0_20px_rgba(244,63,94,0.3)]',
          icon: <ShieldAlert className="w-5 h-5 text-rose-400" />,
        };
      case 'medium':
        return {
          bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
          badge: 'bg-amber-500 text-slate-950 font-bold',
          glow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]',
          icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
        };
      default:
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
          badge: 'bg-emerald-500 text-slate-950 font-bold',
          glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
        };
    }
  };

  const riskStyle = getRiskColor(assessment?.risk_level);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#080d1a] text-slate-100">
      {/* Top Navigation Bar */}
      <header className="h-16 border-b border-[#1e2e56] bg-[#0b1329]/90 backdrop-blur-md px-6 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Waves className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-sky-200 via-sky-400 to-cyan-300 bg-clip-text text-transparent">
                FLOOD AGENT
              </h1>
              <span className="text-[10px] tracking-wider font-semibold uppercase px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/30">
                Global Intelligence
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Autonomous multi-tool flood risk assessment for any location on Earth
            </p>
          </div>
        </div>

        {/* Status & Quick Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111c38] border border-[#1e2e56] text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                backendHealth?.status === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
            <span className="text-slate-300 font-mono text-[11px]">
              API: {backendHealth?.status === 'healthy' ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>

          <button
            onClick={handleGeolocate}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-semibold transition"
            title="Use Current Location"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">My Location</span>
          </button>
        </div>
      </header>

      {/* Main Content: Map + Side Panel */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        {/* Map Container */}
        <div className="flex-1 h-[50vh] lg:h-full relative z-10">
          <MapContainer
            center={[selectedCoord.lat, selectedCoord.lon]}
            zoom={12}
            scrollWheelZoom={true}
            className="h-full w-full"
          >
            <TileLayer
              key={mapStyle}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={MAP_STYLES[mapStyle].url}
              maxZoom={19}
            />
            <MapClickHandler onSelectCoord={handleSelectCoord} />
            <MapRecenter center={[selectedCoord.lat, selectedCoord.lon]} />

            {/* Selected Assessment Marker */}
            <Marker
              position={[selectedCoord.lat, selectedCoord.lon]}
              icon={createSelectedIcon()}
            >
              <Popup>
                <div className="p-1 text-slate-100">
                  <div className="font-semibold text-sm flex items-center gap-1.5 text-sky-400 mb-1">
                    <MapPin className="w-4 h-4" /> Assessment Point
                  </div>
                  <div className="text-xs font-mono text-slate-300">
                    {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}
                  </div>
                </div>
              </Popup>
            </Marker>

            {/* Existing Citizen Reports Markers */}
            {reports.map((rep) => (
              <Marker
                key={rep.id}
                position={[rep.lat, rep.lon]}
                icon={createReportIcon(rep.water_depth)}
              >
                <Popup>
                  <div className="p-1 text-slate-100 min-w-[160px]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">
                      <Droplets className="w-3.5 h-3.5" /> {rep.water_depth} Water Depth
                    </div>
                    <p className="text-xs text-slate-300 mb-1">{rep.description}</p>
                    <div className="text-[10px] text-slate-400">
                      By: {rep.reporter_name || 'Anonymous'}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Map Overlay Controls / Preset Buttons */}
          <div className="absolute top-4 left-4 z-[400] flex flex-wrap items-center gap-2 max-w-lg pointer-events-auto">
            {PRESET_CITIES.map((c) => (
              <button
                key={c.name}
                onClick={() => handleSelectCoord(c.lat, c.lon)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold backdrop-blur-md border transition shadow-md ${
                  selectedCoord.lat === c.lat && selectedCoord.lon === c.lon
                    ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                    : 'bg-[#0b1329]/80 text-slate-300 border-[#1e2e56] hover:bg-[#111c38] hover:text-white'
                }`}
              >
                {c.name}
              </button>
            ))}

            <button
              onClick={() => setMapStyle((prev) => (prev === 'dark' ? 'voyager' : 'dark'))}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold backdrop-blur-md border border-sky-500/40 bg-sky-950/60 text-sky-300 hover:bg-sky-900/60 transition shadow-md flex items-center gap-1.5"
              title="Toggle Carto Basemap Theme"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{mapStyle === 'dark' ? 'Dark Matter' : 'Voyager'}</span>
            </button>
          </div>

          {/* Coordinate Indicator Pill */}
          <div className="absolute bottom-4 left-4 z-[400] bg-[#0b1329]/90 border border-[#1e2e56] px-3.5 py-1.5 rounded-xl shadow-lg backdrop-blur-md text-xs font-mono text-slate-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            <span>Target: {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400 text-[11px]">Click map anywhere</span>
          </div>
        </div>

        {/* Side Panel: Assessment & Reports */}
        <div className="w-full lg:w-[480px] bg-[#0b1329] border-t lg:border-t-0 lg:border-l border-[#1e2e56] flex flex-col h-[50vh] lg:h-full z-20 shadow-2xl overflow-y-auto">
          {/* Action Header */}
          <div className="p-5 border-b border-[#1e2e56] flex items-center justify-between gap-3 bg-[#0d162f]/60 shrink-0">
            <div>
              <h2 className="font-bold text-sm text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-sky-400" /> Risk Assessment
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                {selectedCoord.lat.toFixed(4)}, {selectedCoord.lon.toFixed(4)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setReportModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Add Report</span>
              </button>

              <button
                onClick={() => runAssessment()}
                disabled={loading}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-md transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'Evaluating...' : 'Assess'}</span>
              </button>
            </div>
          </div>

          {/* Assessment Body */}
          <div className="flex-1 p-5 space-y-5 overflow-y-auto">
            {loading && (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center animate-spin">
                  <Waves className="w-6 h-6 text-sky-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-sky-200">
                    Autonomous Agent at Work...
                  </h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    Querying rainfall forecasts, river discharge, Overpass waterway topography, and local citizen reports.
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
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#111c38] border border-[#1e2e56] flex items-center justify-center text-slate-500">
                  <Layers className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-300">Ready to Evaluate</h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    Click anywhere on the world map or pick a city preset to run an AI risk assessment.
                  </p>
                </div>
                <button
                  onClick={() => runAssessment()}
                  className="mt-2 px-4 py-2 rounded-xl bg-sky-500 text-slate-950 font-bold text-xs shadow-lg hover:bg-sky-400 transition"
                >
                  Run Assessment for Mumbai
                </button>
              </div>
            )}

            {!loading && !error && assessment && (
              <div className="space-y-4">
                {/* Risk Level Banner */}
                <div className={`p-4 rounded-2xl border ${riskStyle.bg} ${riskStyle.glow} transition`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase font-extrabold tracking-wider text-slate-400 flex items-center gap-1.5">
                      {riskStyle.icon} Risk Rating
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs uppercase tracking-wider font-extrabold ${riskStyle.badge}`}>
                      {assessment.risk_level} RISK
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 flex items-center gap-1">
                    <span className="font-semibold text-slate-400">Confidence:</span>
                    <span className="capitalize font-mono font-bold text-sky-400">
                      {assessment.confidence}
                    </span>
                  </div>
                </div>

                {/* Summary */}
                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                    <Info className="w-3.5 h-3.5 text-sky-400" /> Summary
                  </h4>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {assessment.summary}
                  </p>
                </div>

                {/* Reasons */}
                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
                    <Activity className="w-3.5 h-3.5 text-sky-400" /> Evidence & Factors
                  </h4>
                  <ul className="space-y-2">
                    {assessment.reasons?.map((reason, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Recommended Actions */}
                <div className="p-4 rounded-xl bg-[#111c38] border border-[#1e2e56]">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Recommended Actions
                  </h4>
                  <ul className="space-y-2">
                    {assessment.actions?.map((act, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-slate-200">
                        <span className="w-4 h-4 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0">
                          {idx + 1}
                        </span>
                        <span>{act}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Citizen Reports Counter Footer */}
          <div className="p-4 border-t border-[#1e2e56] bg-[#0d162f] flex items-center justify-between text-xs text-slate-400 shrink-0">
            <span className="flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-sky-400" />
              <span>{reports.length} Global Citizen Reports</span>
            </span>
            <button
              onClick={() => setReportModalOpen(true)}
              className="text-xs text-sky-400 hover:text-sky-300 font-semibold"
            >
              Report Incident &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* Citizen Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0e172e] border border-[#1e2e56] rounded-2xl shadow-2xl p-6 relative">
            <button
              onClick={() => setReportModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center">
                <Droplets className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-100">Submit Street Flood Report</h3>
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
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-bold'
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
                  Location Details / Observations
                </label>
                <textarea
                  required
                  rows={3}
                  value={reportForm.description}
                  onChange={(e) => setReportForm({ ...reportForm, description: e.target.value })}
                  placeholder="e.g. Near metro station, drain overflowing, lane blocked..."
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
                  placeholder="Anonymous Citizen"
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
                  <span>{submittingReport ? 'Submitting...' : 'Submit Report'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
