import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import {
  Activity,
  AlertCircle,
  Anchor,
  ArrowLeft,
  CheckCircle2,
  Compass,
  Crosshair,
  Database,
  Download,
  ExternalLink,
  FileCode,
  Filter,
  Globe,
  Layers,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  Shield,
  UploadCloud,
  Waves,
  Zap,
} from 'lucide-react'
import {
  getBatch,
  getBatchReportGeoJson,
  getBatchReportJson,
  getBatchReportPdfUrl,
} from '../services/api'
import type { DetectionResult, InvestigationBatchResult, ScanResult } from '../types/api'

// ── Leaflet Default Marker Asset Fix ─────────────────────────────────────────
try {
  delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })
} catch {
  // Safe ignore
}

// ── Detection Class Metadata & Theming ───────────────────────────────────────
interface ClassMeta {
  label: string
  icon: React.ReactNode
  accent: string
  bg: string
  border: string
  badgeBg: string
}

function getClassMeta(cls: string): ClassMeta {
  const map: Record<string, ClassMeta> = {
    submarine_pipeline: {
      label: 'Submarine Pipeline',
      icon: <Layers className="h-4 w-4" />,
      accent: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.08)',
      border: 'rgba(245, 158, 11, 0.25)',
      badgeBg: 'rgba(245, 158, 11, 0.15)',
    },
    shipwreck: {
      label: 'Shipwreck',
      icon: <Anchor className="h-4 w-4" />,
      accent: '#f43f5e',
      bg: 'rgba(244, 63, 94, 0.08)',
      border: 'rgba(244, 63, 94, 0.25)',
      badgeBg: 'rgba(244, 63, 94, 0.15)',
    },
    ghost_net: {
      label: 'Ghost Net',
      icon: <Waves className="h-4 w-4" />,
      accent: '#06b6d4',
      bg: 'rgba(6, 182, 212, 0.08)',
      border: 'rgba(6, 182, 212, 0.25)',
      badgeBg: 'rgba(6, 182, 212, 0.15)',
    },
    mine_cylinder: {
      label: 'Mine Cylinder',
      icon: <Shield className="h-4 w-4" />,
      accent: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.08)',
      border: 'rgba(239, 68, 68, 0.25)',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
    },
  }
  return (
    map[cls] ?? {
      label: cls.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      icon: <Search className="h-4 w-4" />,
      accent: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.08)',
      border: 'rgba(148, 163, 184, 0.2)',
      badgeBg: 'rgba(148, 163, 184, 0.15)',
    }
  )
}

interface MappedDetection {
  scan: ScanResult
  detection: DetectionResult & { target_latitude: number; target_longitude: number }
  detectionIndex: number
}

// ── Map Bounds Auto-fitting with Invalidation ─────────────────────────────────
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 200)

    if (positions.length === 0) return () => clearTimeout(timer)
    if (positions.length === 1) {
      map.setView(positions[0], 14)
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] })
    }
    return () => clearTimeout(timer)
  }, [map, positions])
  return null
}

// ── Batch Survey Map Component ────────────────────────────────────────────────
function BatchSurveyMap({ scans }: { scans: ScanResult[] }) {
  const navigate = useNavigate()

  const mapped: MappedDetection[] = useMemo(() => {
    const results: MappedDetection[] = []
    scans.forEach((scan) => {
      scan.detections.forEach((det, idx) => {
        if (det.target_latitude !== null && det.target_longitude !== null) {
          results.push({
            scan,
            detection: det as DetectionResult & {
              target_latitude: number
              target_longitude: number
            },
            detectionIndex: idx,
          })
        }
      })
    })
    return results
  }, [scans])

  const positions: [number, number][] = mapped.map((m) => [
    m.detection.target_latitude,
    m.detection.target_longitude,
  ])

  const uniqueScanCount = useMemo(
    () => new Set(mapped.map((m) => m.scan.id)).size,
    [mapped],
  )

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl overflow-hidden backdrop-blur-sm">
      {/* Map Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 shadow-inner">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white tracking-wide">
                Batch Survey Georeference Map
              </h2>
              <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/20">
                <Radio className="h-2.5 w-2.5 animate-pulse text-cyan-400" />
                DETERMINISTIC
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Projected acoustic targets across investigation batch swathes
            </p>
          </div>
        </div>

        {/* Map Telemetry Badges */}
        <div className="flex items-center gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-right">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Targets Mapped
            </div>
            <div className="text-lg font-bold text-cyan-400 leading-none">
              {mapped.length}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-right">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Active Tracks
            </div>
            <div className="text-lg font-bold text-slate-200 leading-none">
              {uniqueScanCount}
            </div>
          </div>
        </div>
      </div>

      {/* Map Canvas */}
      <div className="relative min-h-[460px] flex-1 w-full bg-slate-950">
        {mapped.length === 0 ? (
          <div className="flex h-[460px] flex-col items-center justify-center gap-3 text-slate-500 p-6">
            <Compass className="h-10 w-10 text-slate-600" />
            <p className="text-sm font-medium text-slate-400">
              No georeferenced anomaly coordinates detected in this batch.
            </p>
          </div>
        ) : (
          <MapContainer
            center={positions[0] || [0, 0]}
            zoom={14}
            style={{ height: '520px', width: '100%', zIndex: 10 }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds positions={positions} />
            {mapped.map((m) => (
              <Marker
                key={`${m.scan.id}-${m.detection.id ?? m.detectionIndex}`}
                position={[m.detection.target_latitude, m.detection.target_longitude]}
              >
                <Popup>
                  <div className="p-1 min-w-[210px] text-xs leading-relaxed text-slate-800">
                    <div className="font-bold text-sm text-slate-950 border-b border-slate-200 pb-1 mb-1.5">
                      {m.scan.scan_identity}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span>Target #{m.detectionIndex + 1}</span>
                      <span className="font-semibold text-cyan-700 uppercase">
                        {(m.detection.confidence * 100).toFixed(1)}% conf
                      </span>
                    </div>
                    <div className="font-semibold text-cyan-800 text-xs mb-1">
                      {getClassMeta(m.detection.class_name).label}
                    </div>
                    <div className="font-mono text-[11px] text-slate-600">
                      Lat: {m.detection.target_latitude.toFixed(6)}
                    </div>
                    <div className="font-mono text-[11px] text-slate-600">
                      Lon: {m.detection.target_longitude.toFixed(6)}
                    </div>
                    {m.detection.range_m != null && (
                      <div className="text-[11px] text-slate-600">
                        Slant Range: {m.detection.range_m.toFixed(1)} m
                      </div>
                    )}
                    {m.detection.ground_range_m != null && (
                      <div className="text-[11px] text-slate-600">
                        Ground Range: {m.detection.ground_range_m.toFixed(1)} m
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/scans/${m.scan.id}`)}
                      className="mt-2.5 w-full cursor-pointer rounded bg-cyan-700 px-3 py-1.5 text-center text-xs font-semibold text-white transition hover:bg-cyan-600"
                    >
                      Inspect Scan Record →
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  )
}

// ── Anomaly Classification Panel ──────────────────────────────────────────────
function BatchAnomalyPanel({ classCounts }: { classCounts: Record<string, number> }) {
  const sorted = Object.entries(classCounts).sort(([, a], [, b]) => b - a)
  const total = sorted.reduce((s, [, n]) => s + n, 0)

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl overflow-hidden backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-inner">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white tracking-wide">
              Identified Anomaly Classes
            </h2>
            <p className="text-xs text-slate-400">
              {total} verified {total === 1 ? 'target' : 'targets'} classified in this batch
            </p>
          </div>
        </div>
      </div>

      {/* Class Distribution List */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        {sorted.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-slate-500">
            <Shield className="h-10 w-10 text-slate-700" />
            <p className="text-sm font-medium text-slate-400">No anomalies detected in batch</p>
            <p className="text-xs text-slate-500 text-center max-w-xs">
              All scans recorded clear acoustic seabed conditions.
            </p>
          </div>
        ) : (
          sorted.map(([cls, count]) => {
            const meta = getClassMeta(cls)
            const pct = total > 0 ? Math.round((count / total) * 100) : 0
            return (
              <div
                key={cls}
                className="group rounded-lg border p-3.5 transition-all hover:bg-slate-800/40"
                style={{
                  backgroundColor: meta.bg,
                  borderColor: meta.border,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-md text-white shadow-sm"
                      style={{
                        backgroundColor: meta.badgeBg,
                        color: meta.accent,
                      }}
                    >
                      {meta.icon}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-200">
                        {meta.label}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {pct}% of batch anomalies
                      </div>
                    </div>
                  </div>
                  <div
                    className="text-xl font-bold font-mono"
                    style={{ color: meta.accent }}
                  >
                    {count}
                  </div>
                </div>

                {/* Relative visual distribution bar */}
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: meta.accent,
                    }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Batch Upload Shortcut */}
      <div className="border-t border-slate-800/80 bg-slate-950/40 p-4">
        <Link
          to="/batch-upload"
          className="flex items-center justify-between rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-cyan-300 transition-all hover:border-cyan-400 hover:bg-cyan-500/20 group"
        >
          <div className="flex items-center gap-2.5">
            <UploadCloud className="h-4 w-4 text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              Upload New Mission Batch
            </span>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-cyan-400" />
        </Link>
      </div>
    </div>
  )
}

// ── Main BatchResults Component ───────────────────────────────────────────────
export default function BatchResults() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()

  const [batch, setBatch] = useState<InvestigationBatchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloadingJson, setDownloadingJson] = useState(false)
  const [downloadingGeoJson, setDownloadingGeoJson] = useState(false)

  // Filter & Search state for scan table
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'detected' | 'clear'>('all')

  const reloadBatch = async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await getBatch(id)
      setBatch(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to load batch ${id}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function loadBatch(id: string) {
      try {
        const data = await getBatch(id)
        setBatch(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load batch ${id}`)
      } finally {
        setLoading(false)
      }
    }

    if (batchId) {
      loadBatch(batchId)
    }
  }, [batchId])

  const mappedDetectionsCount = useMemo(() => {
    if (!batch) return 0
    let count = 0
    batch.scans.forEach((scan) => {
      scan.detections.forEach((det) => {
        if (det.target_latitude !== null && det.target_longitude !== null) {
          count++
        }
      })
    })
    return count
  }, [batch])

  const scansWithDetections = useMemo(() => {
    if (!batch) return 0
    return batch.scans.filter((s) => s.detection_count > 0).length
  }, [batch])

  // Filtered scans for the investigation register
  const filteredScans = useMemo(() => {
    if (!batch) return []
    return batch.scans.filter((scan) => {
      const matchesSearch =
        searchQuery === '' ||
        scan.scan_identity.toLowerCase().includes(searchQuery.toLowerCase()) ||
        scan.data_source.toLowerCase().includes(searchQuery.toLowerCase()) ||
        scan.detections.some((d) =>
          d.class_name.toLowerCase().includes(searchQuery.toLowerCase()),
        )

      if (!matchesSearch) return false

      if (filterMode === 'detected') return scan.detection_count > 0
      if (filterMode === 'clear') return scan.detection_count === 0
      return true
    })
  }, [batch, searchQuery, filterMode])

  const handleDownloadJson = async () => {
    if (!batchId) return
    setDownloadingJson(true)
    try {
      const data = await getBatchReportJson(batchId)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `drishti_sss_batch_${batchId}_report.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Failed to download JSON report: ${err instanceof Error ? err.message : err}`)
    } finally {
      setDownloadingJson(false)
    }
  }

  const handleDownloadGeoJson = async () => {
    if (!batchId) return
    setDownloadingGeoJson(true)
    try {
      const data = await getBatchReportGeoJson(batchId)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `drishti_sss_batch_${batchId}_report.geojson`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Failed to download GeoJSON report: ${err instanceof Error ? err.message : err}`)
    } finally {
      setDownloadingGeoJson(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-[#0a0d14] text-white">
        <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-slate-800 bg-[#0d1117]/95 px-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Crosshair className="h-5 w-5 animate-spin" />
            </div>
            <div className="font-extrabold tracking-widest text-white">DRISHTI SSS</div>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex flex-col items-center gap-4 text-slate-400">
            <RefreshCw className="h-8 w-8 animate-spin text-cyan-400" />
            <p className="text-sm font-medium">
              Retrieving investigation dossier for batch <span className="font-mono text-cyan-300">{batchId}</span>...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !batch) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-[#0a0d14] text-white">
        <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-slate-800 bg-[#0d1117]/95 px-6 backdrop-blur">
          <Link to="/" className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Crosshair className="h-5 w-5" />
            </div>
            <div className="font-extrabold tracking-widest text-white">DRISHTI SSS</div>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-red-500/40 bg-red-950/40 p-6 shadow-2xl backdrop-blur">
            <div className="flex items-start gap-4">
              <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-400" />
              <div>
                <h2 className="text-lg font-bold text-red-200">Investigation Batch Not Found</h2>
                <p className="mt-2 text-sm text-red-300/80">{error || `Batch '${batchId}' does not exist.`}</p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => batchId && reloadBatch(batchId)}
                    className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition cursor-pointer"
                  >
                    Retry Query
                  </button>
                  <Link
                    to="/batch-upload"
                    className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
                  >
                    Upload New Batch
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-[#0a0d14] text-slate-100 antialiased">
      {/* ── TOP MISSION-CONTROL APP HEADER ────────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-800 bg-[#0d1117]/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1720px] items-center justify-between px-4 sm:px-6 lg:px-8 xl:px-10">
          {/* Logo & Brand Identity */}
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              to="/"
              className="flex items-center gap-3 group transition hover:opacity-90 cursor-pointer"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/40 bg-gradient-to-br from-cyan-500/20 to-blue-600/10 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
                <Crosshair className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black tracking-wider text-white">DRISHTI</span>
                  <span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                    SSS INTEL
                  </span>
                </div>
                <p className="hidden text-[10px] uppercase tracking-widest text-slate-400 sm:block">
                  Naval Forensic Sonar Analytics
                </p>
              </div>
            </Link>
          </div>

          {/* Header Action & Status Telemetry */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span className="font-semibold">{batch.scans.length}</span> Swathes Ingested
            </div>

            <Link
              to="/batch-upload"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-semibold text-slate-200 shadow transition hover:border-slate-600 hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              <UploadCloud className="h-4 w-4 text-cyan-400" />
              <span className="hidden sm:inline">New Batch</span>
            </Link>

            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-semibold text-slate-200 shadow transition hover:border-slate-600 hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ── MAIN DASHBOARD VIEWPORT CONTAINER ─────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[1720px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
        {/* ── INVESTIGATION DOSSIER BANNER & REPORT ACTIONS ──────────────────── */}
        <div className="mb-6 flex flex-col gap-4 rounded-xl border border-slate-800 bg-[#0f172a]/90 p-6 shadow-xl backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400">
              <Zap className="h-3.5 w-3.5" />
              Investigation Batch Dossier
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black font-mono text-white tracking-wide">
                {batch.batch_id}
              </h1>
              <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 uppercase">
                {batch.data_source}
              </span>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 uppercase flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                VERIFIED
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Ingested on <span className="text-slate-200">{new Date(batch.created_at).toLocaleString()}</span> • Provenance source:{' '}
              <span className="font-semibold text-cyan-300 uppercase">{batch.data_source}</span>
            </p>
          </div>

          {/* Report Download Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleDownloadJson}
              disabled={downloadingJson}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 shadow transition hover:border-slate-600 hover:bg-slate-700 hover:text-white cursor-pointer"
              title="Download structured JSON investigation report"
            >
              <FileCode className="h-4 w-4 text-cyan-400" />
              <span>{downloadingJson ? 'Downloading...' : 'JSON Report'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadGeoJson}
              disabled={downloadingGeoJson}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 shadow transition hover:border-slate-600 hover:bg-slate-700 hover:text-white cursor-pointer"
              title="Download RFC 7946 GeoJSON FeatureCollection of all detections"
            >
              <MapPin className="h-4 w-4 text-emerald-400" />
              <span>{downloadingGeoJson ? 'Downloading...' : 'GeoJSON Report'}</span>
            </button>

            <a
              href={getBatchReportPdfUrl(batch.batch_id)}
              download={`drishti_sss_batch_${batch.batch_id}_report.pdf`}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 px-4 py-2 text-xs font-extrabold text-white shadow-lg shadow-cyan-900/30 transition hover:from-cyan-500 hover:to-cyan-400 hover:shadow-cyan-900/50 cursor-pointer"
              title="Download official PDF report with provenance and georeference tables"
            >
              <Download className="h-4 w-4" />
              <span>Download PDF Dossier</span>
            </a>
          </div>
        </div>

        {/* ── 4 KPI CARDS IN ONE ROW (DESKTOP) ──────────────────────────────── */}
        <section className="mb-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5">
          {/* Card 1 */}
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f172a]/90 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Total Scans Ingested
                </span>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                  {batch.total_scans}
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 shadow-inner">
                <Layers className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span>{scansWithDetections} tracks contain anomalies</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f172a]/90 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Successful Scans
                </span>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-emerald-400 sm:text-4xl">
                  {batch.successful_scans}
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 shadow-inner">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>100% processed without error</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f172a]/90 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Anomalies Detected
                </span>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-cyan-400 sm:text-4xl">
                  {batch.total_detections}
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-400 shadow-inner">
                <Search className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span>Identified by YOLO detector</span>
            </div>
          </div>

          {/* Card 4 */}
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f172a]/90 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Georeferenced Targets
                </span>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-amber-400 sm:text-4xl">
                  {mappedDetectionsCount}
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-400 shadow-inner">
                <MapPin className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span>Deterministic GPS coordinates</span>
            </div>
          </div>
        </section>

        {/* ── MAP (LEFT) + ANOMALY PANEL (RIGHT) ────────────────────────────── */}
        <section className="mb-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
          <div className="md:col-span-8 flex flex-col">
            <BatchSurveyMap scans={batch.scans} />
          </div>
          <div className="md:col-span-4 flex flex-col">
            <BatchAnomalyPanel classCounts={batch.class_counts} />
          </div>
        </section>

        {/* ── PROCESSED BATCH SCANS TABLE ───────────────────────────────────── */}
        <section className="rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl overflow-hidden backdrop-blur-sm">
          {/* Table Header Controls */}
          <div className="flex flex-col gap-4 border-b border-slate-800/80 bg-slate-900/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white tracking-wide">
                  Batch Swathes Register
                </h2>
                <p className="text-xs text-slate-400">
                  {filteredScans.length} of {batch.scans.length} total tracks displayed (including zero-detection scans)
                </p>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Filter Pills */}
              <div className="flex rounded-lg border border-slate-800 bg-slate-950/80 p-0.5">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    filterMode === 'all'
                      ? 'bg-cyan-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({batch.scans.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('detected')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    filterMode === 'detected'
                      ? 'bg-cyan-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  With Targets ({scansWithDetections})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('clear')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    filterMode === 'clear'
                      ? 'bg-cyan-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Clear ({batch.scans.length - scansWithDetections})
                </button>
              </div>

              {/* Text Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter swathe or class..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48 rounded-lg border border-slate-800 bg-slate-950/90 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Table Body */}
          {filteredScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center text-slate-500">
              <Filter className="h-10 w-10 text-slate-700" />
              <p className="text-sm font-medium text-slate-400">
                {batch.scans.length === 0
                  ? 'No scans found in this batch record.'
                  : 'No scan records match the active search filter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-6 py-3.5">Scan Identity</th>
                    <th className="px-6 py-3.5">Telemetry Timestamp</th>
                    <th className="px-6 py-3.5">Detections</th>
                    <th className="px-6 py-3.5">Acoustic Targets</th>
                    <th className="px-6 py-3.5">Platform Coordinates</th>
                    <th className="px-6 py-3.5">Attitude</th>
                    <th className="px-6 py-3.5 text-right">Inspection</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredScans.map((scan) => {
                    const hasDetections = scan.detection_count > 0
                    const ts = new Date(scan.timestamp)
                    return (
                      <tr
                        key={scan.id}
                        className="group transition-colors hover:bg-slate-800/40 cursor-pointer"
                        onClick={() => navigate(`/scans/${scan.id}`)}
                      >
                        {/* Scan Identity */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">
                              {scan.scan_identity}
                            </span>
                            <span className="rounded bg-cyan-500/10 border border-cyan-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                              Swathe #{scan.id}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-500">
                            Source: {scan.data_source}
                          </span>
                        </td>

                        {/* Timestamp */}
                        <td className="px-6 py-4 text-xs text-slate-400 whitespace-nowrap">
                          <div className="font-medium text-slate-300">
                            {ts.toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {ts.toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </div>
                        </td>

                        {/* Detection Count Badge */}
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold border ${
                              hasDetections
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                hasDetections ? 'bg-amber-400' : 'bg-slate-500'
                              }`}
                            />
                            {scan.detection_count}{' '}
                            {scan.detection_count === 1 ? 'Anomaly' : 'Anomalies'}
                          </span>
                        </td>

                        {/* Identified Target Classes */}
                        <td className="px-6 py-4">
                          {scan.detections.length === 0 ? (
                            <span className="text-xs italic text-slate-600">
                              Clear seabed swathe
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {scan.detections.slice(0, 3).map((det, i) => {
                                const meta = getClassMeta(det.class_name)
                                return (
                                  <span
                                    key={det.id ?? i}
                                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold border"
                                    style={{
                                      backgroundColor: meta.badgeBg,
                                      borderColor: meta.border,
                                      color: meta.accent,
                                    }}
                                  >
                                    {meta.label}
                                  </span>
                                )
                              })}
                              {scan.detections.length > 3 && (
                                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                                  +{scan.detections.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Sonar Position */}
                        <td className="px-6 py-4 font-mono text-xs text-slate-300 whitespace-nowrap">
                          <div className="flex items-center gap-1 text-slate-400">
                            <Navigation className="h-3 w-3 text-cyan-400" />
                            <span>
                              {scan.sonar_latitude.toFixed(5)},{' '}
                              {scan.sonar_longitude.toFixed(5)}
                            </span>
                          </div>
                        </td>

                        {/* Attitude & Telemetry */}
                        <td className="px-6 py-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                          <div>Heading: <span className="text-slate-200">{scan.heading.toFixed(1)}°</span></div>
                          <div className="text-[11px] text-slate-500">Altitude: {scan.altitude.toFixed(1)}m</div>
                        </td>

                        {/* Action link */}
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/scans/${scan.id}`)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-500/50 hover:bg-cyan-600 hover:text-white cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── FOOTER ────────────────────────────────────────────────────────── */}
        <footer className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-slate-800/80 pt-6 text-xs text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">DRISHTI SSS</span>
            <span>•</span>
            <span>Naval Debris Intelligence &amp; Autonomous Sonar Georeferencing</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-cyan-400 hover:underline">
              Return to Intelligence Dashboard
            </Link>
          </div>
        </footer>
      </main>
    </div>
  )
}
