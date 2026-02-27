import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AlertTriangle, CheckCircle, Thermometer, Wind, Zap, RotateCcw,
  Truck, Clock, Shield, FileText, ChevronDown, FlaskConical,
  Play, Square, Gauge, X, PlusCircle, Cpu, Radio, TrendingDown,
  Activity, DollarSign
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Area, AreaChart
} from "recharts";

// ─── CROP PROFILES ─────────────────────────────────────────────────────────────
// Each crop has different biological thresholds — this is the science judges care about.
const CROP_PROFILES = {
  Tomatoes: {
    emoji: "🍅",
    cargoValue: 10000,           // USD total cargo value
    tempDanger: 30,              // °C — biological safety limit
    tempWarning: 27,
    gforceCritical: 2.0,        // g — internal bruising threshold
    gforceWarning: 1.5,
    tiltCritical: 25,
    sensitivity: "Medium",
    shelfLife: "7–10 days",
    scienceNote: "Chilling injury below 10°C; accelerated ripening above 30°C",
  },
  Bananas: {
    emoji: "🍌",
    cargoValue: 8000,
    tempDanger: 25,             // Bananas are highly chilling-sensitive, tighter range
    tempWarning: 22,
    gforceCritical: 1.5,        // Softer fruit — bruises easier
    gforceWarning: 1.0,
    tiltCritical: 20,
    sensitivity: "High",
    shelfLife: "4–6 days",
    scienceNote: "Chilling injury below 13°C; skin blackening above 28°C",
  },
  Potatoes: {
    emoji: "🥔",
    cargoValue: 6000,
    tempDanger: 35,             // Potatoes are hardier
    tempWarning: 30,
    gforceCritical: 3.0,
    gforceWarning: 2.0,
    tiltCritical: 30,
    sensitivity: "Low",
    shelfLife: "21–28 days",
    scienceNote: "Dormancy break above 25°C; bruising above 3g impact",
  },
};

// ─── INITIAL DATA ──────────────────────────────────────────────────────────────
const INITIAL_INCIDENTS = [
  { id: 1, time: "09:02", event: "Trip Started",       type: "info",     gforce: 0.2, temp: 24.1, deduction: 0,  sim: false },
  { id: 2, time: "09:47", event: "Hard Braking",       type: "warning",  gforce: 1.8, temp: 24.8, deduction: 2,  sim: false },
  { id: 3, time: "10:15", event: "Severe Pothole",     type: "critical", gforce: 3.1, temp: 25.3, deduction: 5,  sim: false },
  { id: 4, time: "10:52", event: "Sharp Corner",       type: "warning",  gforce: 1.4, temp: 26.1, deduction: 1,  sim: false },
  { id: 5, time: "11:45", event: "AC Fluctuation",     type: "critical", gforce: 0.3, temp: 32.0, deduction: 7,  sim: false },
  { id: 6, time: "12:20", event: "Road Vibration",     type: "warning",  gforce: 1.1, temp: 29.4, deduction: 1,  sim: false },
  { id: 7, time: "12:58", event: "Sudden Stop",        type: "warning",  gforce: 2.1, temp: 28.5, deduction: 3,  sim: false },
  { id: 8, time: "13:10", event: "Destination Arrived",type: "info",     gforce: 0.1, temp: 28.5, deduction: 0,  sim: false },
];

const INITIAL_TEMP_HISTORY = [
  { time: "09:00", temp: 24.0 }, { time: "09:30", temp: 24.3 },
  { time: "10:00", temp: 24.9 }, { time: "10:15", temp: 25.3 },
  { time: "10:30", temp: 25.8 }, { time: "11:00", temp: 26.5 },
  { time: "11:30", temp: 27.2 }, { time: "11:45", temp: 32.0 },
  { time: "12:00", temp: 31.4 }, { time: "12:15", temp: 30.1 },
  { time: "12:30", temp: 29.6 }, { time: "12:45", temp: 29.1 },
  { time: "13:00", temp: 28.5 }, { time: "13:10", temp: 28.5 },
];

const BASE_CIS = 88;

// ─── FINANCIAL FORMULA ─────────────────────────────────────────────────────────
// ValueLoss = (100 - CIS) / 100 * TotalCargoValue
// At CIS=69, Tomatoes ($10k): loss = 31% × $10,000 = $3,100
function calcMarketLoss(cis, cargoValue) {
  return -((100 - cis) / 100 * cargoValue);
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function computeCIS(incidents) {
  return Math.max(0, BASE_CIS - incidents.reduce((s, i) => s + i.deduction, 0));
}

function getTempStatusKey(temp, profile) {
  if (temp > profile.tempDanger)  return "critical";
  if (temp > profile.tempWarning) return "warning";
  return "optimal";
}

function getGForceStatusKey(g, profile) {
  if (g > profile.gforceCritical) return "critical";
  if (g > profile.gforceWarning)  return "warning";
  return "stable";
}

function getTiltStatusKey(tilt, profile) {
  if (tilt > profile.tiltCritical)      return "critical";
  if (tilt > profile.tiltCritical * 0.6) return "warning";
  return "stable";
}

// ─── STATUS STYLES ─────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  critical: { text: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/30",     dot: "bg-red-400",     hex: "#ef4444" },
  warning:  { text: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/30",   dot: "bg-amber-400",   hex: "#f59e0b" },
  optimal:  { text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30", dot: "bg-emerald-400", hex: "#10b981" },
  stable:   { text: "text-sky-400",     bg: "bg-sky-400/10",     border: "border-sky-400/30",     dot: "bg-sky-400",     hex: "#38bdf8" },
  info:     { text: "text-slate-400",   bg: "bg-slate-400/10",   border: "border-slate-400/20",   dot: "bg-slate-400",   hex: "#94a3b8" },
};

const STATUS_LABEL = { critical: "Critical", warning: "Warning", optimal: "Optimal", stable: "Stable", info: "Stable" };

// ─── REUSABLE ATOMS ────────────────────────────────────────────────────────────
function StatusBadge({ statusKey }) {
  const s = STATUS_COLORS[statusKey] || STATUS_COLORS.info;
  const label = STATUS_LABEL[statusKey] || "Stable";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${s.text} ${s.bg} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {label}
    </span>
  );
}

function CircularGauge({ value, size = 160 }) {
  const radius = (size - 24) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (value / 100) * circumference;
  const color = value >= 85 ? "#10b981" : value >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#1e293b" strokeWidth={14} />
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={14}
        strokeDasharray={`${strokeDash} ${circumference}`} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 10px ${color}90)`, transition: "stroke-dasharray 0.8s cubic-bezier(.4,0,.2,1), stroke 0.5s ease" }} />
    </svg>
  );
}

function MetaItem({ label, value, highlight }) {
  return (
    <div>
      <p className="text-xs text-slate-600 mono uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-semibold mono ${highlight ? "text-amber-400" : "text-slate-200"}`}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value, colorClass }) {
  return (
    <div className="bg-slate-900/60 rounded-lg p-2">
      <p className="text-xs text-slate-600 mono">{label}</p>
      <p className={`text-sm font-bold mono ${colorClass}`} style={{ transition: "color 0.5s" }}>{value}</p>
    </div>
  );
}

function VerdictPoint({ icon, title, detail }) {
  return (
    <div className="bg-slate-900/40 rounded-lg p-3">
      <p className="text-sm font-semibold text-white sans mb-1">{icon} {title}</p>
      <p className="text-xs text-slate-400 sans leading-relaxed">{detail}</p>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label, dangerTemp }) => {
  if (!active || !payload?.length) return null;
  const temp = payload[0]?.value;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className={`font-bold ${temp > dangerTemp ? "text-red-400" : "text-emerald-400"}`}>{temp?.toFixed(1)}°C</p>
      {temp > dangerTemp && <p className="text-red-400 mt-0.5">⚠ Above danger threshold</p>}
    </div>
  );
};

// ─── STATUS CARD ───────────────────────────────────────────────────────────────
function StatusCard({ icon, label, value, subValue, statusKey, detail, trend }) {
  const s = STATUS_COLORS[statusKey] || STATUS_COLORS.stable;
  return (
    <div className={`card p-4 bg-gradient-to-br ${s.bg} to-transparent border ${s.border}`}
      style={{ transition: "border-color 0.4s ease, background 0.4s ease" }}>
      <div className="flex items-center justify-between mb-2">
        <span className={s.text}>{icon}</span>
        <StatusBadge statusKey={statusKey} />
      </div>
      <p className="text-xs text-slate-500 mono mb-1">{label}</p>
      <p className={`text-2xl font-bold mono ${s.text}`} style={{ transition: "color 0.4s ease" }}>{value}</p>
      <p className="text-xs text-slate-500 sans mt-1">{subValue}</p>
      <div className="mt-2 pt-2 border-t border-slate-700/40">
        <span className="text-xs text-slate-600 mono">{detail}</span>
      </div>
      <p className={`text-xs sans mt-1 italic ${statusKey === "critical" ? "text-red-400 font-semibold" : statusKey === "warning" ? "text-amber-400" : "text-slate-500"}`}
        style={{ transition: "color 0.4s ease" }}>{trend}</p>
    </div>
  );
}

// ─── SIM DRAWER ────────────────────────────────────────────────────────────────
function SimDrawer({ open, onClose, tripData, onTempChange, onGForceChange, onInject, isAutoPlay, setIsAutoPlay, flashEvent, crop }) {
  const profile = CROP_PROFILES[crop];
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-30 backdrop-blur-sm" onClick={onClose} />}
      <div className={`fixed right-0 top-0 h-full w-80 z-40 flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{ background: "linear-gradient(180deg,#07071a 0%,#0d0d20 100%)", borderLeft: "1px solid rgba(124,58,237,0.35)", boxShadow: open ? "-10px 0 50px rgba(124,58,237,0.18)" : "none" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "rgba(124,58,237,0.2)" }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.45)" }}>
              <FlaskConical size={14} style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <p className="text-xs font-bold mono" style={{ color: "#a78bfa" }}>DEVELOPER MODE</p>
              <p className="text-xs mono" style={{ color: "#5b21b6" }}>Sim Override · {crop} Profile Active</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:opacity-70 transition-opacity"><X size={16} style={{ color: "#7c3aed" }} /></button>
        </div>

        {/* Crop threshold info */}
        <div className="mx-4 mt-3 rounded-lg px-3 py-2.5 text-xs" style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span>{profile.emoji}</span>
            <span className="font-bold mono" style={{ color: "#a78bfa" }}>{crop} Thresholds</span>
            <span className="ml-auto px-1.5 py-0.5 rounded text-xs mono" style={{ background: "rgba(124,58,237,0.15)", color: "#7c3aed" }}>Sensitivity: {profile.sensitivity}</span>
          </div>
          <p style={{ color: "#6d28d9" }} className="sans leading-relaxed">{profile.scienceNote}</p>
          <div className="mt-1.5 flex gap-3 mono" style={{ color: "#5b21b6" }}>
            <span>🌡 Limit: {profile.tempDanger}°C</span>
            <span>⚡ Limit: {profile.gforceCritical}g</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {/* Auto-Play */}
          <SimSection title="AUTO-PLAY MODE" icon={<Radio size={11} />}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sans text-slate-300">Live Trip Simulation</p>
                <p className="text-xs sans" style={{ color: "#5b21b6" }}>Temp drifts ±0.5°C every 2s · random shocks</p>
              </div>
              <button onClick={() => setIsAutoPlay(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs mono font-bold transition-all"
                style={isAutoPlay
                  ? { background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#f87171" }
                  : { background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.4)", color: "#a78bfa" }}>
                {isAutoPlay ? <><Square size={10} /> STOP</> : <><Play size={10} /> START</>}
              </button>
            </div>
            {isAutoPlay && (
              <div className="flex items-center gap-2 mt-2 text-xs mono text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                LIVE — streaming sensor data
              </div>
            )}
          </SimSection>

          {/* Manual Sliders */}
          <SimSection title="MANUAL SENSOR OVERRIDE" icon={<Gauge size={11} />}>
            <SimSlider
              label="Temperature"
              value={tripData.currentTemp}
              min={15} max={45} step={0.1} unit="°C"
              onChange={onTempChange}
              dangerAt={profile.tempDanger}
              warnAt={profile.tempWarning}
              color={tripData.currentTemp > profile.tempDanger ? "#ef4444" : tripData.currentTemp > profile.tempWarning ? "#f59e0b" : "#10b981"}
            />
            <SimSlider
              label="G-Force"
              value={tripData.peakGForce}
              min={0.5} max={5.0} step={0.1} unit="g"
              onChange={onGForceChange}
              dangerAt={profile.gforceCritical}
              warnAt={profile.gforceWarning}
              color={tripData.peakGForce > profile.gforceCritical ? "#ef4444" : tripData.peakGForce > profile.gforceWarning ? "#f59e0b" : "#38bdf8"}
            />
          </SimSection>

          {/* Inject Events */}
          <SimSection title="INSTANT INCIDENT INJECTION" icon={<Zap size={11} />}>
            <InjectBtn label="🕳  Simulate Pothole"   sub={`3.5g shock · CIS −5% · $${(0.05 * profile.cargoValue).toFixed(0)} loss`} color="#ef4444" active={flashEvent==="pothole"} onClick={() => onInject("pothole")} />
            <InjectBtn label="🌡  Simulate AC Failure" sub={`35°C spike · CIS −10% · $${(0.10 * profile.cargoValue).toFixed(0)} loss`} color="#f97316" active={flashEvent==="ac"}      onClick={() => onInject("ac")}      />
            <InjectBtn label="📦  Simulate Cargo Shift" sub={`28° tilt · CIS −6% · $${(0.06 * profile.cargoValue).toFixed(0)} loss`} color="#a78bfa" active={flashEvent==="shift"}   onClick={() => onInject("shift")}   />
          </SimSection>

          {/* Live readout */}
          <SimSection title="LIVE OVERRIDE VALUES" icon={<Cpu size={11} />}>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["TEMP",    `${tripData.currentTemp.toFixed(1)}°C`, tripData.currentTemp > profile.tempDanger ? "#ef4444" : "#a78bfa"],
                ["G-FORCE", `${tripData.peakGForce.toFixed(1)}g`,   tripData.peakGForce > profile.gforceCritical ? "#ef4444" : "#a78bfa"],
                ["TILT",    `${tripData.currentTilt}°`,             tripData.currentTilt > profile.tiltCritical ? "#ef4444" : "#a78bfa"],
                ["CIS",     `${tripData.cisScore}%`,                tripData.cisScore < 70 ? "#ef4444" : tripData.cisScore < 85 ? "#f59e0b" : "#10b981"],
              ].map(([k, v, c]) => (
                <div key={k} className="rounded-lg p-2" style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.15)" }}>
                  <p className="text-xs mono" style={{ color: "#5b21b6" }}>{k}</p>
                  <p className="text-sm font-bold mono" style={{ color: c, transition: "color 0.3s" }}>{v}</p>
                </div>
              ))}
            </div>
          </SimSection>
        </div>

        <div className="px-4 py-3 border-t text-xs mono text-center" style={{ borderColor: "rgba(124,58,237,0.15)", color: "#3b0764" }}>
          TQR SIM ENGINE · HACKATHON BUILD 2026
        </div>
      </div>
    </>
  );
}

function SimSection({ title, icon, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span style={{ color: "#7c3aed" }}>{icon}</span>
        <p className="text-xs mono font-bold tracking-widest" style={{ color: "#7c3aed" }}>{title}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SimSlider({ label, value, min, max, step, unit, onChange, dangerAt, warnAt, color }) {
  const pct = ((value - min) / (max - min)) * 100;
  const dangerPct = ((dangerAt - min) / (max - min)) * 100;
  const warnPct = ((warnAt - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs sans text-slate-300">{label}</span>
        <span className="text-sm font-bold mono" style={{ color, transition: "color 0.3s" }}>{value.toFixed(1)}{unit}</span>
      </div>
      <div className="relative h-4 flex items-center">
        <div className="w-full h-1.5 rounded-full relative" style={{ background: "#1e1b4b" }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}80`, transition: "width 0.1s, background 0.3s" }} />
          <div className="absolute top-0 h-full w-px opacity-60" style={{ left: `${warnPct}%`, background: "#f59e0b" }} />
          <div className="absolute top-0 h-full w-px opacity-80" style={{ left: `${dangerPct}%`, background: "#ef4444" }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer" />
      </div>
      <div className="flex justify-between text-xs mt-0.5 mono" style={{ color: "#4c1d95" }}>
        <span>{min}{unit}</span>
        <span style={{ color: "#ef4444" }}>⚑ {dangerAt}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

function InjectBtn({ label, sub, color, onClick, active }) {
  return (
    <button onClick={onClick} className="w-full text-left rounded-lg px-3 py-2.5 transition-all"
      style={{ background: active ? `${color}20` : "rgba(124,58,237,0.07)", border: `1px solid ${active ? color : "rgba(124,58,237,0.18)"}`, boxShadow: active ? `0 0 16px ${color}40` : "none", transform: active ? "scale(0.97)" : "scale(1)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold sans" style={{ color: active ? color : "#c4b5fd" }}>{label}</span>
        <PlusCircle size={12} style={{ color: active ? color : "#6d28d9" }} />
      </div>
      <p className="text-xs mono mt-0.5" style={{ color: "#5b21b6" }}>{sub}</p>
    </button>
  );
}

// ─── MAIN DASHBOARD ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [crop, setCrop] = useState("Tomatoes");
  const [dropOpen, setDropOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [flashEvent, setFlashEvent] = useState(null);
  const [newRowId, setNewRowId] = useState(null);

  // ── Central tripData state ──────────────────────────────────────────────────
  const [tripData, setTripData] = useState({
    cisScore: computeCIS(INITIAL_INCIDENTS),     // 69
    currentTemp: 28.5,
    peakGForce: 3.1,
    currentTilt: 12,
  });

  const [incidents, setIncidents] = useState(INITIAL_INCIDENTS);
  const [tempHistory, setTempHistory] = useState(INITIAL_TEMP_HISTORY);

  const idRef = useRef(100);
  const autoRef = useRef(null);

  const profile = CROP_PROFILES[crop];

  // ── Derived financial value ─────────────────────────────────────────────────
  const marketLoss = useMemo(() =>
    calcMarketLoss(tripData.cisScore, profile.cargoValue),
    [tripData.cisScore, profile.cargoValue]
  );

  // ── Derived status keys ─────────────────────────────────────────────────────
  const tempStatusKey   = getTempStatusKey(tripData.currentTemp, profile);
  const shockStatusKey  = getGForceStatusKey(tripData.peakGForce, profile);
  const tiltStatusKey   = getTiltStatusKey(tripData.currentTilt, profile);
  const humidStatusKey  = "optimal";

  const cisColor     = tripData.cisScore >= 85 ? "text-emerald-400" : tripData.cisScore >= 70 ? "text-amber-400" : "text-red-400";
  const cisBgFrom    = tripData.cisScore >= 85 ? "from-emerald-500/10" : tripData.cisScore >= 70 ? "from-amber-500/10" : "from-red-500/10";
  const cisRiskLabel = tripData.cisScore >= 85 ? "Good Condition" : tripData.cisScore >= 70 ? "Moderate Risk" : "High Risk";
  const verdictRisk  = tripData.cisScore >= 85 ? "LOW RISK" : tripData.cisScore >= 70 ? "MODERATE RISK" : "HIGH RISK";
  const verdictColor = tripData.cisScore >= 85 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : tripData.cisScore >= 70 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-red-500/20 text-red-400 border-red-500/30";

  // ── Temperature slider handler ──────────────────────────────────────────────
  const handleTempChange = useCallback((val) => {
    const t = nowTime().slice(0, 5);
    setTripData(d => ({ ...d, currentTemp: val }));
    setTempHistory(h => [...h.slice(-19), { time: t, temp: val }]);
  }, []);

  // ── G-Force slider handler ──────────────────────────────────────────────────
  const handleGForceChange = useCallback((val) => {
    setTripData(d => ({ ...d, peakGForce: val }));
  }, []);

  // ── Inject event ────────────────────────────────────────────────────────────
  const handleInject = useCallback((type) => {
    idRef.current += 1;
    const id = idRef.current;
    const t = nowTime().slice(0, 5);

    let entry, tempVal, gforceVal, tiltVal, deduction;

    if (type === "pothole") {
      gforceVal = 3.5; deduction = 5;
      entry = { id, time: t, event: "🕳 Simulated Pothole",    type: "critical", gforce: gforceVal, temp: tripData.currentTemp, deduction, sim: true };
      setTripData(d => ({ ...d, peakGForce: gforceVal, cisScore: Math.max(0, d.cisScore - deduction) }));
    } else if (type === "ac") {
      tempVal = 35.0; deduction = 10;
      entry = { id, time: t, event: "🌡 Simulated AC Failure",  type: "critical", gforce: tripData.peakGForce, temp: tempVal, deduction, sim: true };
      setTripData(d => ({ ...d, currentTemp: tempVal, cisScore: Math.max(0, d.cisScore - deduction) }));
      setTempHistory(h => [...h.slice(-19), { time: t, temp: tempVal }]);
    } else if (type === "shift") {
      tiltVal = 28; deduction = 6;
      entry = { id, time: t, event: "📦 Simulated Cargo Shift", type: "critical", gforce: tripData.peakGForce, temp: tripData.currentTemp, deduction, sim: true };
      setTripData(d => ({ ...d, currentTilt: tiltVal, cisScore: Math.max(0, d.cisScore - deduction) }));
    }

    setIncidents(prev => [...prev, entry]);
    setNewRowId(id);
    setTimeout(() => setNewRowId(null), 2000);
    setFlashEvent(type);
    setTimeout(() => setFlashEvent(null), 600);
  }, [tripData]);

  // ── Auto-play loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoRef.current) clearInterval(autoRef.current);
    if (!isAutoPlay) return;

    autoRef.current = setInterval(() => {
      const t = nowTime().slice(0, 5);

      setTripData(prev => {
        // Temp drifts ±0.5°C every 2s
        const drift = +(Math.random() * 1.0 - 0.5).toFixed(1);
        const newTemp = Math.min(45, Math.max(15, +(prev.currentTemp + drift).toFixed(1)));

        // Random shock (30% chance per tick)
        const shockFires = Math.random() < 0.3;
        const newG = shockFires ? +(0.5 + Math.random() * (profile.gforceCritical * 1.8)).toFixed(1) : prev.peakGForce;

        // If shock is critical, penalise CIS
        let newCIS = prev.cisScore;
        if (shockFires && newG > profile.gforceCritical) {
          const pen = newG > profile.gforceCritical * 1.5 ? 3 : 1;
          newCIS = Math.max(0, prev.cisScore - pen);
          idRef.current += 1;
          const entry = { id: idRef.current, time: t, event: "⚡ Auto: Road Shock", type: newG > profile.gforceCritical * 1.3 ? "critical" : "warning", gforce: newG, temp: newTemp, deduction: pen, sim: true };
          setIncidents(inc => [...inc, entry]);
          setNewRowId(idRef.current);
          setTimeout(() => setNewRowId(null), 1500);
        }

        setTempHistory(h => [...h.slice(-19), { time: t, temp: newTemp }]);
        return { ...prev, currentTemp: newTemp, peakGForce: newG, cisScore: newCIS };
      });
    }, 2000);

    return () => clearInterval(autoRef.current);
  }, [isAutoPlay, profile]);

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box}
        .sans{font-family:'IBM Plex Sans',sans-serif}
        .mono{font-family:'IBM Plex Mono',monospace}
        .scan-line{background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,.008) 2px,rgba(255,255,255,.008) 4px);pointer-events:none}
        @keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.25}}
        .live-dot{animation:pulse-dot 1.4s ease-in-out infinite}
        @keyframes fade-in-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fade-in-up .5s ease forwards}
        .s1{animation-delay:.1s;opacity:0}.s2{animation-delay:.2s;opacity:0}
        .s3{animation-delay:.3s;opacity:0}.s4{animation-delay:.4s;opacity:0}
        .s5{animation-delay:.5s;opacity:0}
        .card{background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border:1px solid #334155;border-radius:12px}
        .card:hover{border-color:#475569;transition:border-color .2s}
        .danger-row{background:rgba(239,68,68,.05)}
        .warning-row{background:rgba(245,158,11,.05)}
        .sim-row{background:rgba(124,58,237,.08);border-left:3px solid rgba(167,139,250,.5);animation:fade-in-up .35s ease forwards}
        .new-row{box-shadow:inset 0 0 24px rgba(167,139,250,.12)}
        .recharts-cartesian-grid-horizontal line,.recharts-cartesian-grid-vertical line{stroke:#1e293b !important}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0f172a}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
        input[type=range]{-webkit-appearance:none;appearance:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#a78bfa;cursor:pointer;border:2px solid #4c1d95}
        input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#a78bfa;cursor:pointer;border:2px solid #4c1d95;border:none}
        .fab{transition:all .2s ease}
        .fab:hover{transform:scale(1.06)}
        .fab.open{box-shadow:0 0 24px rgba(167,139,250,.45)}
        .value-flash{animation:fade-in-up .3s ease}
      `}</style>

      <div className="fixed inset-0 scan-line z-0 pointer-events-none" />

      {/* ── FAB ── */}
      <button onClick={() => setDrawerOpen(v => !v)}
        className={`fab fixed bottom-6 right-6 z-50 w-13 h-13 w-12 h-12 rounded-xl flex items-center justify-center ${drawerOpen ? "open" : ""}`}
        style={{ background: drawerOpen ? "rgba(124,58,237,0.28)" : "rgba(124,58,237,0.14)", border: "1px solid rgba(167,139,250,0.42)", backdropFilter: "blur(10px)" }}
        title="Open Developer / Simulation Panel">
        <FlaskConical size={19} style={{ color: "#a78bfa" }} />
        {isAutoPlay && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 live-dot" />}
      </button>

      {/* ── DRAWER ── */}
      <SimDrawer
        open={drawerOpen} onClose={() => setDrawerOpen(false)}
        tripData={tripData}
        onTempChange={handleTempChange}
        onGForceChange={handleGForceChange}
        onInject={handleInject}
        isAutoPlay={isAutoPlay} setIsAutoPlay={setIsAutoPlay}
        flashEvent={flashEvent} crop={crop}
      />

      {/* ── CONTENT ── */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 py-6">

        {/* HEADER */}
        <div className="fade-in s1 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <Truck size={16} className="text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold text-white mono">TQR — Transport Quality Recorder</h1>
                  <span className="flex items-center gap-1 text-xs text-emerald-400 mono">
                    <span className="live-dot w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {isAutoPlay ? "LIVE SIMULATION" : "AUDIT MODE"}
                  </span>
                  {isAutoPlay && (
                    <span className="text-xs px-2 py-0.5 rounded-full mono font-bold"
                      style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>
                      ⚗ SIM ACTIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 sans mt-0.5">
                  Black Box Report · Agricultural Cargo · Cargo Value: {profile.cargoValue.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 sans">
              <FileText size={13} />
              <span>Feb 27 2026, 13:14 UTC</span>
            </div>
          </div>

          <div className="card p-3 flex flex-wrap gap-x-6 gap-y-2 items-center">
            <MetaItem label="TRIP ID"   value="#TRK-2026-001" highlight />
            <MetaItem label="VEHICLE"   value="MH-12-AB-7743" />
            <MetaItem label="ROUTE"     value="Nashik → Mumbai APMC" />
            <MetaItem label="DURATION"  value="4h 08m" />
            <MetaItem label="DISTANCE"  value="213 km" />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500 mono">CARGO</span>
              <div className="relative">
                <button onClick={() => setDropOpen(!dropOpen)}
                  className="flex items-center gap-2 bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:border-amber-500/50 transition-colors mono">
                  {profile.emoji} {crop} <ChevronDown size={12} className={`transition-transform ${dropOpen ? "rotate-180" : ""}`} />
                </button>
                {dropOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-600 rounded-lg overflow-hidden z-50 shadow-2xl">
                    {Object.entries(CROP_PROFILES).map(([name, p]) => (
                      <button key={name} onClick={() => { setCrop(name); setDropOpen(false); }}
                        className={`block w-full text-left px-4 py-2.5 text-sm mono hover:bg-slate-700 transition-colors ${name === crop ? "text-amber-400" : "text-slate-300"}`}>
                        <span className="mr-2">{p.emoji}</span>{name}
                        <span className="ml-2 text-xs" style={{ color: "#5b21b6" }}>· {p.sensitivity} sensitivity</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* HERO ROW — CIS + Status Cards */}
        <div className="fade-in s2 grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">

          {/* CIS Gauge */}
          <div className={`card p-5 lg:col-span-2 bg-gradient-to-br ${cisBgFrom} to-transparent`}
            style={{ transition: "background 0.5s ease" }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs text-slate-500 mono uppercase tracking-widest">Cargo Integrity Score</p>
                <p className="text-xs text-slate-600 sans mt-0.5">Real-time quality index</p>
              </div>
              <Shield size={16} className={cisColor} />
            </div>
            <div className="flex items-center gap-5">
              <div className="relative flex-shrink-0">
                <CircularGauge value={tripData.cisScore} size={160} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-bold mono ${cisColor} value-flash`} key={tripData.cisScore}>{tripData.cisScore}%</span>
                  <span className={`text-xs mono ${cisColor} opacity-80`}>{cisRiskLabel}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-slate-500 mono mb-1">MARKET VALUE LOSS</p>
                    <p className="text-xl font-bold text-red-400 mono value-flash" key={marketLoss.toFixed(0)}>
                      {marketLoss.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-slate-600 sans">of {profile.cargoValue.toLocaleString("en-US", { style: "currency", currency: "USD" })} cargo</p>
                  </div>
                  <div className="h-px bg-slate-700/50" />
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat label="Base CIS"    value={`${BASE_CIS}%`}               colorClass="text-amber-400" />
                    <MiniStat label="Current CIS" value={`${tripData.cisScore}%`}       colorClass={cisColor} />
                    <MiniStat label="Incidents"   value={incidents.filter(i => i.deduction > 0).length} colorClass="text-orange-400" />
                    <MiniStat label="Deduction"   value={`−${BASE_CIS - tripData.cisScore}%`} colorClass="text-red-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Status Cards */}
          <div className="lg:col-span-3 grid grid-cols-2 gap-3">
            <StatusCard
              icon={<Zap size={16} />}
              label="G-Force Shock"
              value={`${tripData.peakGForce.toFixed(1)}g`}
              subValue={`threshold: ${profile.gforceCritical}g`}
              statusKey={shockStatusKey}
              detail={`Limit: ${profile.gforceCritical}g critical`}
              trend={tripData.peakGForce > profile.gforceCritical
                ? `${((tripData.peakGForce / profile.gforceCritical - 1) * 100).toFixed(0)}% over limit!`
                : "Within safe range"}
            />
            <StatusCard
              icon={<Thermometer size={16} />}
              label="Temperature"
              value={`${tripData.currentTemp.toFixed(1)}°C`}
              subValue={`danger: >${profile.tempDanger}°C`}
              statusKey={tempStatusKey}
              detail={`Bio limit: ${profile.tempDanger}°C`}
              trend={tripData.currentTemp > profile.tempDanger
                ? "⚠ COLD CHAIN BREACH"
                : tripData.currentTemp > profile.tempWarning
                  ? "Approaching limit"
                  : "Stable"}
            />
            <StatusCard
              icon={<Wind size={16} />}
              label="Humidity"
              value="82%"
              subValue="avg over trip"
              statusKey={humidStatusKey}
              detail="Target: 75–90%"
              trend="Within range"
            />
            <StatusCard
              icon={<RotateCcw size={16} />}
              label="Tilt Angle"
              value={`${tripData.currentTilt}°`}
              subValue={`limit: ${profile.tiltCritical}°`}
              statusKey={tiltStatusKey}
              detail={`Critical: >${profile.tiltCritical}°`}
              trend={tripData.currentTilt > profile.tiltCritical ? "⚠ ROLLOVER RISK" : "No rollover risk"}
            />
          </div>
        </div>

        {/* CHARTS ROW */}
        <div className="fade-in s3 grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

          {/* Temperature timeline */}
          <div className="card p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-slate-500 mono uppercase tracking-widest">Temperature Timeline</p>
                <p className="text-sm font-semibold text-white sans mt-0.5">
                  Cargo Hold °C — Danger Threshold: {profile.tempDanger}°C
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs sans">
                <span className="flex items-center gap-1.5 text-emerald-400"><span className="w-3 h-0.5 bg-emerald-400 rounded inline-block" /> Safe</span>
                <span className="flex items-center gap-1.5 text-red-400"><span className="w-3 h-0.5 bg-red-400 rounded inline-block" /> Danger</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={tempHistory} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#64748b", fontFamily: "IBM Plex Mono" }} tickLine={false} />
                <YAxis domain={[Math.max(10, Math.min(...tempHistory.map(d => d.temp)) - 2), Math.max(...tempHistory.map(d => d.temp)) + 3]}
                  tick={{ fontSize: 10, fill: "#64748b", fontFamily: "IBM Plex Mono" }} tickLine={false} tickFormatter={v => `${v}°`} />
                <Tooltip content={<ChartTooltip dangerTemp={profile.tempDanger} />} />
                <ReferenceLine y={profile.tempDanger} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: `DANGER ${profile.tempDanger}°`, position: "right", fontSize: 9, fill: "#ef4444", fontFamily: "IBM Plex Mono" }} />
                <Area type="monotone" dataKey="temp" stroke="#f59e0b" strokeWidth={2} fill="url(#tg)"
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (payload.temp > profile.tempDanger)
                      return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#ef444440" strokeWidth={3} />;
                    return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={0} />;
                  }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* CIS degradation bars */}
          <div className="card p-5">
            <div className="mb-3">
              <p className="text-xs text-slate-500 mono uppercase tracking-widest">CIS Degradation</p>
              <p className="text-sm font-semibold text-white sans mt-0.5">Score loss per incident</p>
            </div>
            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {incidents.filter(i => i.deduction > 0).map(inc => {
                const w = Math.min(100, (inc.deduction / 10) * 100);
                const bar = inc.type === "critical" ? "bg-red-500" : "bg-amber-500";
                return (
                  <div key={inc.id}>
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-xs sans truncate max-w-[140px]" style={inc.sim ? { color: "#a78bfa" } : { color: "#94a3b8" }}>
                        {inc.time} · {inc.event.replace(/^[🕳🌡📦⚡]\s*/u, "").substring(0, 18)}
                      </span>
                      <span className={`text-xs mono font-semibold ml-1 ${inc.type === "critical" ? "text-red-400" : "text-amber-400"}`}>−{inc.deduction}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: inc.sim ? "rgba(124,58,237,0.18)" : "#1e293b" }}>
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${w}%`, transition: "width 0.8s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
              {[
                ["Total Deduction", `−${BASE_CIS - tripData.cisScore}%`, "text-red-400 font-bold"],
                ["Base Score",      `${BASE_CIS}%`,                       "text-amber-400"],
                ["Current Score",   `${tripData.cisScore}%`,              cisColor + " font-bold"],
              ].map(([l, v, c]) => (
                <div key={l} className="flex justify-between text-xs mono">
                  <span className="text-slate-500">{l}</span>
                  <span className={c} style={{ transition: "color 0.4s" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* INCIDENT LOG */}
        <div className="fade-in s4 card mb-4 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 mono uppercase tracking-widest">Black Box — Incident Log</p>
              <p className="text-sm font-semibold text-white sans mt-0.5">
                {incidents.length} events recorded
                {incidents.some(i => i.sim) && (
                  <span className="ml-2 text-xs mono" style={{ color: "#a78bfa" }}>
                    · {incidents.filter(i => i.sim).length} simulated
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mono">
              <Clock size={12} />
              <span>09:02 – now</span>
            </div>
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10" style={{ background: "#0f172a" }}>
                <tr className="border-b border-slate-700/50">
                  {["TIME","EVENT","TYPE","G-FORCE","TEMP","DEDUCTION","SOURCE"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-slate-500 mono font-medium tracking-widest uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incidents.map(row => {
                  const isNew = row.id === newRowId;
                  const rowCls = row.sim ? "sim-row" : row.type === "critical" ? "danger-row" : row.type === "warning" ? "warning-row" : "";
                  const statusKey = row.type === "critical" ? "critical" : row.type === "warning" ? "warning" : "stable";
                  return (
                    <tr key={row.id} className={`border-b border-slate-800/60 transition-all hover:bg-slate-800/30 ${rowCls} ${isNew ? "new-row" : ""}`}>
                      <td className="px-4 py-3 mono text-slate-300 font-medium whitespace-nowrap">{row.time}</td>
                      <td className="px-4 py-3 sans whitespace-nowrap" style={row.sim ? { color: "#c4b5fd" } : { color: "#e2e8f0" }}>{row.event}</td>
                      <td className="px-4 py-3"><StatusBadge statusKey={statusKey} /></td>
                      <td className="px-4 py-3 mono text-slate-300">{typeof row.gforce === "number" ? `${row.gforce.toFixed(1)}g` : row.gforce}</td>
                      <td className="px-4 py-3 mono">
                        <span className={typeof row.temp === "number" && row.temp > profile.tempDanger ? "text-red-400 font-semibold" : "text-slate-300"}>
                          {typeof row.temp === "number" ? `${row.temp.toFixed(1)}°C` : row.temp}
                        </span>
                      </td>
                      <td className="px-4 py-3 mono">
                        <span className={row.deduction > 0 ? "text-red-400 font-semibold" : "text-slate-600"}>
                          {row.deduction > 0 ? `−${row.deduction}%` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.sim
                          ? <span className="text-xs mono px-2 py-0.5 rounded" style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}>SIM</span>
                          : <span className="text-xs mono text-slate-600">SENSOR</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* VERDICT */}
        <div className="fade-in s5 card p-5 border-amber-500/30 bg-gradient-to-br from-amber-950/20 to-slate-900/80">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={18} className="text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <p className="text-xs text-amber-500 mono uppercase tracking-widest">Audit Verdict — Automated Assessment</p>
                <span className={`text-xs px-2 py-0.5 rounded-full mono border ${verdictColor}`} style={{ transition: "all 0.5s" }}>{verdictRisk}</span>
              </div>
              <h2 className="text-base font-bold text-white sans mb-3" style={{ transition: "all 0.5s" }}>
                {tripData.cisScore >= 85
                  ? "Recommendation: Standard cold storage. Normal shelf life expected."
                  : tripData.cisScore >= 70
                    ? "Recommendation: Sell within 24 hours. Priority clearance advised."
                    : "Recommendation: Immediate sale or processing. Severe damage risk."}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <VerdictPoint icon="🔴" title="Bruising Risk"
                  detail={`Peak shock ${tripData.peakGForce.toFixed(1)}g (limit ${profile.gforceCritical}g). ${tripData.peakGForce > profile.gforceCritical ? "High probability of internal bruising — 12–18% batch affected." : "Low risk. Spot-check sample batch."}`} />
                <VerdictPoint icon="🌡️" title="Cold Chain"
                  detail={`${tripData.currentTemp > profile.tempDanger ? `ACTIVE BREACH at ${tripData.currentTemp.toFixed(1)}°C (limit ${profile.tempDanger}°C). Accelerated ripening in progress.` : `Temperature ${tripData.currentTemp.toFixed(1)}°C within safe range. Cold chain maintained.`}`} />
                <VerdictPoint icon="📦" title="Commercial Action"
                  detail={`CIS ${tripData.cisScore}% → Est. loss ${Math.abs(marketLoss).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}. ${tripData.cisScore < 75 ? "Route to discount retail or processing unit." : tripData.cisScore < 85 ? "Inspect batch. Priority dispatch." : "Standard sale. No deduction required."}`} />
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-amber-500/10 flex flex-wrap gap-4 justify-between items-center">
            <div className="flex gap-3 text-xs mono text-slate-500 flex-wrap">
              <span>TQR AI Engine v2.4</span><span>·</span>
              <span>RPT-20260227-001</span><span>·</span>
              <span>Confidence: 94.2%</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600 sans">
              <CheckCircle size={11} />
              {incidents.some(i => i.sim) ? "⚗ Simulation data included" : "Sensor data verified · GPS corroborated"}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
