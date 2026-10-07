import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  Cpu,
  Crosshair,
  Download,
  Eye,
  FileCode,
  Globe,
  Layers,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Waves,
  Zap,
} from 'lucide-react'
import { getScan } from '../services/api'
import type { DetectionResult, ScanResult } from '../types/api'

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

const API_BASE_URL = 'http://127.0.0.1:8000/api'

// ── Bounding box accent colors ───────────────────────────────────────────────
const BOX_COLOURS = [
  '#06b6d4', // cyan-500
  '#a855f7', // purple-500
  '#eab308', // yellow-500
  '#22c55e', // green-500
  '#f97316', // orange-500
  '#ef4444', // red-500
]

function boxColour(index: number): string {
  return BOX_COLOURS[index % BOX_COLOURS.length]
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

// ── Sonar Image Viewer Component ─────────────────────────────────────────────
interface ImageViewerProps {
  scanId: number
  detections: DetectionResult[]
}

interface LabelLayout {
  placeBelow: boolean
  anchorRight: boolean
  offsetY: number
}

interface PlacedLabelRect {
  lx1: number
  lx2: number
  ly1: number
  ly2: number
}

function computeLabelLayouts(
  detections: DetectionResult[],
  naturalSize: { w: number; h: number }
): LabelLayout[] {
  const { w: nw, h: nh } = naturalSize
  const placed: PlacedLabelRect[] = []
  const layouts: LabelLayout[] = []

  // Normalized label height (~20-22px in typical display)
  const LABEL_H = 0.055

  for (let i = 0; i < detections.length; i++) {
    const det = detections[i]
    if (!det.bbox || nw <= 0 || nh <= 0) {
      layouts.push({ placeBelow: false, anchorRight: false, offsetY: 0 })
      continue
    }

    const bx1 = det.bbox.x1 / nw
    const by1 = det.bbox.y1 / nh
    const bx2 = det.bbox.x2 / nw
    const by2 = det.bbox.y2 / nh

    // Estimate label width in normalized coordinates
    const labelText = `#${i + 1} ${det.class_name} ${(det.confidence * 100).toFixed(0)}%`
    const approxPxWidth = Math.max(85, labelText.length * 6.5 + 16)
    const labelW = Math.min(0.45, Math.max(0.16, approxPxWidth / Math.min(nw, 800)))

    const spaceAbove = by1
    const spaceBelow = 1 - by2

    // Helper to compute normalized bounding box of candidate label
    const getRect = (placeBelow: boolean, anchorRight: boolean, offsetYPx: number): PlacedLabelRect => {
      const vOffsetNorm = offsetYPx / 400
      let lx1: number
      let lx2: number
      if (anchorRight) {
        lx2 = bx2
        lx1 = Math.max(0, bx2 - labelW)
      } else {
        lx1 = bx1
        lx2 = Math.min(1, bx1 + labelW)
      }

      let ly1: number
      let ly2: number
      if (placeBelow) {
        ly1 = by2 + vOffsetNorm
        ly2 = ly1 + LABEL_H
      } else {
        ly2 = by1 - vOffsetNorm
        ly1 = ly2 - LABEL_H
      }
      return { lx1, lx2, ly1, ly2 }
    }

    // Helper to check if candidate collides with any already-placed label
    const collidesWithPlaced = (r: PlacedLabelRect): boolean => {
      const PAD_X = 0.015
      const PAD_Y = 0.01
      for (const p of placed) {
        const overlapX = !(r.lx2 + PAD_X <= p.lx1 || r.lx1 >= p.lx2 + PAD_X)
        const overlapY = !(r.ly2 + PAD_Y <= p.ly1 || r.ly1 >= p.ly2 + PAD_Y)
        if (overlapX && overlapY) return true
      }
      return false
    }

    // Preferred default:
    // Prefer ABOVE immediately; if space above is tight (< 0.07) and space below exists, place BELOW.
    const defaultPlaceBelow = spaceAbove < 0.07 && spaceBelow >= 0.05
    // Anchor right if box starts on right 35% of image or right edge > 85%, preventing overflow
    const defaultAnchorRight = bx1 > 0.65 || bx2 > 0.85

    type Candidate = { placeBelow: boolean; anchorRight: boolean; offsetY: number }
    const candidates: Candidate[] = [
      // 1. Preferred default (above if room, else below)
      { placeBelow: defaultPlaceBelow, anchorRight: defaultAnchorRight, offsetY: 0 },
      // 2. Flip below / above
      { placeBelow: !defaultPlaceBelow, anchorRight: defaultAnchorRight, offsetY: 0 },
      // 3. Flip horizontal anchor
      { placeBelow: defaultPlaceBelow, anchorRight: !defaultAnchorRight, offsetY: 0 },
      { placeBelow: !defaultPlaceBelow, anchorRight: !defaultAnchorRight, offsetY: 0 },
      // 4. Stagger with vertical offset (20px)
      { placeBelow: false, anchorRight: defaultAnchorRight, offsetY: 20 },
      { placeBelow: true, anchorRight: defaultAnchorRight, offsetY: 20 },
      { placeBelow: false, anchorRight: !defaultAnchorRight, offsetY: 20 },
      { placeBelow: true, anchorRight: !defaultAnchorRight, offsetY: 20 },
      // 5. Stagger with second vertical offset (40px)
      { placeBelow: false, anchorRight: defaultAnchorRight, offsetY: 40 },
      { placeBelow: true, anchorRight: defaultAnchorRight, offsetY: 40 },
    ]

    let bestChoice: Candidate | null = null
    let chosenRect: PlacedLabelRect | null = null

    for (const cand of candidates) {
      // If candidate is placed above, ensure there is space above inside the image
      if (!cand.placeBelow && spaceAbove < (cand.offsetY > 0 ? 0.11 : 0.06)) continue
      // If candidate is placed below, ensure there is space below inside the image
      if (cand.placeBelow && spaceBelow < (cand.offsetY > 0 ? 0.11 : 0.06)) continue

      // If anchor right, ensure box right edge allows label to fit within left boundary
      if (cand.anchorRight && bx2 < labelW) continue
      // If anchor left, ensure box left edge allows label to fit within right boundary
      if (!cand.anchorRight && bx1 + labelW > 1.0) continue

      const rect = getRect(cand.placeBelow, cand.anchorRight, cand.offsetY)

      // Ensure rectangle stays strictly within [0, 1] bounds
      if (rect.ly1 < -0.01 || rect.ly2 > 1.01) continue

      if (!collidesWithPlaced(rect)) {
        bestChoice = cand
        chosenRect = rect
        break
      }
    }

    if (!bestChoice || !chosenRect) {
      bestChoice = {
        placeBelow: defaultPlaceBelow,
        anchorRight: defaultAnchorRight,
        offsetY: 0,
      }
      chosenRect = getRect(bestChoice.placeBelow, bestChoice.anchorRight, bestChoice.offsetY)
    }

    placed.push(chosenRect)
    layouts.push(bestChoice)
  }

  return layouts
}

function SonarImageViewer({ scanId, detections }: ImageViewerProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [imgError, setImgError] = useState(false)
  const [imgLoading, setImgLoading] = useState(true)

  const imageUrl = `${API_BASE_URL}/scans/${scanId}/image`

  function handleLoad() {
    const img = imgRef.current
    if (img) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
    setImgLoading(false)
  }

  function handleError() {
    setImgError(true)
    setImgLoading(false)
  }

  // Convert absolute pixel bbox → percentage positions relative to the
  // natural image dimensions so overlays align precisely with image pixels.
  function toPercent(bbox: DetectionResult['bbox']) {
    if (!naturalSize) return null
    const { w, h } = naturalSize
    return {
      left: `${(bbox.x1 / w) * 100}%`,
      top: `${(bbox.y1 / h) * 100}%`,
      width: `${((bbox.x2 - bbox.x1) / w) * 100}%`,
      height: `${((bbox.y2 - bbox.y1) / h) * 100}%`,
    }
  }

  const labelLayouts = useMemo(() => {
    if (!naturalSize) return []
    return computeLabelLayouts(detections, naturalSize)
  }, [detections, naturalSize])

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl overflow-hidden backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 shadow-inner">
            <Eye className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white tracking-wide">
                Raw Sonar Swathe &amp; Neural Overlays
              </h2>
              <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 text-[9px] font-mono font-bold text-cyan-300 uppercase">
                YOLOv11s Overlays
              </span>
            </div>
            <p className="text-xs text-slate-400">
              High-resolution acoustic reflectance with localized bounding boxes
            </p>
          </div>
        </div>

        {naturalSize && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-right font-mono text-xs text-slate-300">
            <span className="text-[10px] uppercase text-slate-500 block">Raster Dimensions</span>
            <span className="text-cyan-400 font-bold">{naturalSize.w}</span> ×{' '}
            <span className="text-cyan-400 font-bold">{naturalSize.h}</span> px
          </div>
        )}
      </div>

      <div className="p-5">
        {/* Error state */}
        {imgError && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-amber-500/30 bg-amber-950/20 p-8 text-center text-amber-300">
            <AlertCircle className="h-8 w-8 text-amber-400 mb-2" />
            <p className="text-sm font-semibold">Image file not accessible on storage</p>
            <p className="text-xs text-amber-400/80 mt-1">
              The persistent acoustic raster could not be read from the server storage volume.
            </p>
          </div>
        )}

        {/* Loading placeholder */}
        {!imgError && imgLoading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/80 p-16 text-center text-slate-400">
            <RefreshCw className="h-8 w-8 animate-spin text-cyan-400 mb-3" />
            <p className="text-sm font-medium">Decoding high-resolution sonar backscatter...</p>
          </div>
        )}

        {/* Coordinate Wrapper */}
        {!imgError && (
          <div
            style={{
              position: 'relative',
              width: '100%',
              display: imgLoading ? 'none' : 'block',
            }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt={`Sonar scan swathe ${scanId}`}
              onLoad={handleLoad}
              onError={handleError}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                borderRadius: '8px',
                border: '1px solid rgba(51, 65, 85, 0.6)',
              }}
            />

            {naturalSize && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  overflow: 'visible',
                }}
              >
                {detections.map((det, idx) => {
                  const pos = toPercent(det.bbox)
                  if (!pos) return null
                  const colour = boxColour(idx)
                  const layout = labelLayouts[idx] ?? {
                    placeBelow: false,
                    anchorRight: false,
                    offsetY: 0,
                  }

                  const labelStyle: React.CSSProperties = {
                    position: 'absolute',
                    ...(layout.placeBelow
                      ? { top: '100%', marginTop: `${2 + layout.offsetY}px` }
                      : { bottom: '100%', marginBottom: `${2 + layout.offsetY}px` }),
                    ...(layout.anchorRight ? { right: 0 } : { left: 0 }),
                    backgroundColor: colour,
                    color: '#0f172a',
                    fontSize: '10px',
                    fontWeight: 800,
                    lineHeight: 1.2,
                    padding: '2px 5px',
                    borderRadius: '2px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.55)',
                    maxWidth: '45vw',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    zIndex: 10 + idx + (layout.offsetY > 0 ? 5 : 0),
                  }

                  return (
                    <div
                      key={det.id ?? idx}
                      style={{
                        position: 'absolute',
                        left: pos.left,
                        top: pos.top,
                        width: pos.width,
                        height: pos.height,
                        border: `2px solid ${colour}`,
                        boxShadow: `0 0 10px ${colour}40`,
                        boxSizing: 'border-box',
                        overflow: 'visible',
                      }}
                    >
                      <span style={labelStyle}>
                        #{idx + 1} {det.class_name} {(det.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}


        {/* Legend */}
        {!imgError && !imgLoading && detections.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2.5 border-t border-slate-800/80 pt-4">
            {detections.map((det, idx) => (
              <div
                key={det.id ?? idx}
                className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-2.5 py-1 text-xs"
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: boxColour(idx) }}
                />
                <span className="font-mono text-slate-300">
                  Target #{idx + 1}: <strong className="text-white">{det.class_name}</strong> (
                  <span className="text-cyan-400 font-semibold">
                    {(det.confidence * 100).toFixed(1)}%
                  </span>
                  )
                </span>
              </div>
            ))}
          </div>
        )}

        {!imgError && !imgLoading && detections.length === 0 && (
          <div className="mt-4 flex items-center justify-center gap-2 border-t border-slate-800/80 pt-4 text-xs text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>Clear acoustic seabed — zero anomalies detected in this scan swathe.</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Georeferenced Detection Map Component ─────────────────────────────────────
interface DetectionMapProps {
  detections: DetectionResult[]
}

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

function DetectionMap({ detections }: DetectionMapProps) {
  const mapped = detections.filter(
    (d): d is DetectionResult & { target_latitude: number; target_longitude: number } =>
      d.target_latitude !== null && d.target_longitude !== null,
  )

  const positions: [number, number][] = mapped.map((d) => [d.target_latitude, d.target_longitude])
  const defaultCenter: [number, number] = [0, 0]

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl overflow-hidden backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-900/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 shadow-inner">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white tracking-wide">
                Target Geolocation Map
              </h2>
              <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/20">
                <Radio className="h-2.5 w-2.5 animate-pulse text-cyan-400" />
                GPS PROJECTION
              </span>
            </div>
            <p className="text-xs text-slate-400">
              WGS-84 deterministic target coordinates computed from towfish position and slant-range
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-right font-mono text-xs">
          <span className="text-[10px] uppercase text-slate-500 block">Mapped Targets</span>
          <span className="text-cyan-400 font-bold">{mapped.length}</span> / {detections.length}
        </div>
      </div>

      <div className="relative min-h-[440px] flex-1 w-full bg-slate-950">
        {mapped.length === 0 ? (
          <div className="flex h-[440px] flex-col items-center justify-center gap-3 text-slate-500 p-6">
            <Compass className="h-10 w-10 text-slate-600" />
            <p className="text-sm font-medium text-slate-400">
              {detections.length === 0
                ? 'No detections in this scan — zero coordinates to display.'
                : 'No detections have georeferenced coordinates computed.'}
            </p>
          </div>
        ) : (
          <MapContainer
            center={defaultCenter}
            zoom={14}
            style={{ height: '480px', width: '100%', zIndex: 10 }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds positions={positions} />
            {mapped.map((det, idx) => (
              <Marker key={det.id ?? idx} position={[det.target_latitude, det.target_longitude]}>
                <Popup>
                  <div className="p-1 min-w-[200px] text-xs leading-relaxed text-slate-800">
                    <div className="font-bold text-sm text-slate-950 border-b border-slate-200 pb-1 mb-1">
                      Detection #{idx + 1}
                    </div>
                    <div className="font-semibold text-cyan-800 text-xs mb-1">
                      {getClassMeta(det.class_name).label}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Confidence: <strong>{(det.confidence * 100).toFixed(1)}%</strong>
                    </div>
                    <div className="font-mono text-[11px] text-slate-600">
                      Lat: <strong>{det.target_latitude.toFixed(6)}</strong>
                    </div>
                    <div className="font-mono text-[11px] text-slate-600">
                      Lon: <strong>{det.target_longitude.toFixed(6)}</strong>
                    </div>
                    {det.range_m != null && (
                      <div className="text-[11px] text-slate-600">
                        Slant Range: <strong>{det.range_m.toFixed(1)} m</strong>
                      </div>
                    )}
                    {det.ground_range_m != null && (
                      <div className="text-[11px] text-slate-600">
                        Ground Range: <strong>{det.ground_range_m.toFixed(1)} m</strong>
                      </div>
                    )}
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

// ── Main ScanDetail Page Component ────────────────────────────────────────────
function ScanDetail() {
  const { scanId } = useParams<{ scanId: string }>()
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [downloadingJson, setDownloadingJson] = useState(false)
  const [downloadingGeoJson, setDownloadingGeoJson] = useState(false)

  useEffect(() => {
    async function loadScan() {
      if (!scanId) {
        setError('Scan ID is missing')
        setLoading(false)
        return
      }

      try {
        const data = await getScan(Number(scanId))
        setScan(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load scan')
      } finally {
        setLoading(false)
      }
    }

    loadScan()
  }, [scanId])

  // Georeferenced count
  const mappedCount = useMemo(() => {
    if (!scan) return 0
    return scan.detections.filter(
      (d) => d.target_latitude !== null && d.target_longitude !== null,
    ).length
  }, [scan])

  const handleDownloadJson = async () => {
    if (!scan) return
    setDownloadingJson(true)
    try {
      const res = await fetch(`${API_BASE_URL}/scans/${scan.id}/report/json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `drishti_sss_scan_${scan.id}_report.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Failed to download JSON report: ${err instanceof Error ? err.message : err}`)
    } finally {
      setDownloadingJson(false)
    }
  }

  const handleDownloadGeoJson = async () => {
    if (!scan) return
    setDownloadingGeoJson(true)
    try {
      const res = await fetch(`${API_BASE_URL}/scans/${scan.id}/report/geojson`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `drishti_sss_scan_${scan.id}_report.geojson`
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
              Loading forensic analysis for scan <span className="font-mono text-cyan-300">#{scanId}</span>...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !scan) {
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
                <h2 className="text-lg font-bold text-red-200">Scan Investigation Record Not Found</h2>
                <p className="mt-2 text-sm text-red-300/80">{error || `Scan with ID '${scanId}' does not exist.`}</p>
                <div className="mt-4 flex gap-3">
                  <Link
                    to="/"
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 transition"
                  >
                    Return to Dashboard
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const hasDetections = scan.detection_count > 0
  const scanDate = new Date(scan.timestamp)

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
            <div className="hidden items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-400 md:flex">
              <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
              <span className="font-semibold uppercase tracking-wider">Acoustic Workstation</span>
            </div>

            {scan.batch_id && (
              <Link
                to={`/batches/${scan.batch_id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow transition hover:border-cyan-500/50 hover:bg-slate-700 hover:text-white cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Parent Batch</span>
              </Link>
            )}

            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/90 px-3.5 py-1.5 text-xs font-semibold text-slate-200 shadow transition hover:border-slate-600 hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ── MAIN WORKSTATION VIEWPORT CONTAINER ───────────────────────────────── */}
      <main className="mx-auto w-full max-w-[1720px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
        {/* ── INVESTIGATION DOSSIER BANNER & REPORT ACTIONS ──────────────────── */}
        <div className="mb-6 flex flex-col gap-4 rounded-xl border border-slate-800 bg-[#0f172a]/90 p-6 shadow-xl backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400">
              <Zap className="h-3.5 w-3.5" />
              Swathe Investigation Dossier
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black font-mono text-white tracking-wide">
                {scan.scan_identity}
              </h1>
              <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 uppercase">
                ID #{scan.id}
              </span>
              {scan.batch_id && (
                <Link
                  to={`/batches/${scan.batch_id}`}
                  className="rounded-md border border-cyan-500/25 bg-cyan-950/40 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300 hover:border-cyan-400 transition"
                >
                  BATCH: {scan.batch_id.slice(0, 16)}...
                </Link>
              )}
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase flex items-center gap-1 ${
                  hasDetections
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                <CheckCircle2 className="h-3 w-3" />
                {hasDetections ? `${scan.detection_count} Anomalies Detected` : 'Clear Acoustic Seabed'}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Acquisition Timestamp:{' '}
              <span className="text-slate-200 font-mono">
                {scanDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
                {scanDate.toLocaleTimeString('en-US')}
              </span>{' '}
              • Provenance source:{' '}
              <span className="font-semibold text-cyan-300 uppercase">{scan.data_source}</span>
            </p>
          </div>

          {/* Report Action Buttons */}
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
              href={`${API_BASE_URL}/scans/${scan.id}/report/pdf`}
              download={`drishti_sss_scan_${scan.id}_report.pdf`}
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
                  Target Detections
                </span>
                <div
                  className={`mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl ${
                    hasDetections ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {scan.detection_count}
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 shadow-inner">
                <Search className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  hasDetections ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <span>{hasDetections ? 'YOLO anomalies detected' : 'Seabed verified clear'}</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f172a]/90 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Sonar Position
                </span>
                <div className="mt-2 font-mono text-xl font-bold tracking-tight text-cyan-400 sm:text-2xl">
                  {scan.sonar_latitude.toFixed(4)}, {scan.sonar_longitude.toFixed(4)}
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-400 shadow-inner">
                <Navigation className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span>Towfish WGS-84 origin</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f172a]/90 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Platform Attitude
                </span>
                <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {scan.heading.toFixed(1)}° <span className="text-sm font-normal text-slate-400">/</span> {scan.altitude.toFixed(1)}m
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 shadow-inner">
                <Compass className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span>Heading &amp; seabed altitude</span>
            </div>
          </div>

          {/* Card 4 */}
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0f172a]/90 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-slate-700">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Georeferenced Targets
                </span>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-emerald-400 sm:text-4xl">
                  {mappedCount}
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 shadow-inner">
                <MapPin className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Deterministic GPS projected</span>
            </div>
          </div>
        </section>

        {/* ── WORKSTATION DUAL-COLUMN GRID ──────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-8">
          {/* ── LEFT COLUMN: VISUAL RECONNAISSANCE (~62% DESKTOP) ───────────── */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-8">
            {/* Sonar Image with Bounding Boxes */}
            <SonarImageViewer scanId={scan.id} detections={scan.detections} />

            {/* Georeferenced Target-Location Map */}
            <DetectionMap detections={scan.detections} />
          </div>

          {/* ── RIGHT COLUMN: TELEMETRY & PER-DETECTION REGISTER (~38% DESKTOP) ─ */}
          <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-8">
            {/* Navigation Metadata Panel */}
            <div className="rounded-xl border border-slate-800 bg-[#0f172a]/90 p-6 shadow-xl backdrop-blur-sm">
              <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                  <Navigation className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Platform Navigation Metadata</h2>
                  <p className="text-xs text-slate-400">Deterministic acoustic baseline inputs</p>
                </div>
              </div>

              <div className="mt-4 divide-y divide-slate-800/60 text-xs font-mono">
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-400">Sonar Latitude</span>
                  <span className="font-bold text-white">{scan.sonar_latitude.toFixed(6)}</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-400">Sonar Longitude</span>
                  <span className="font-bold text-white">{scan.sonar_longitude.toFixed(6)}</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-400">Compass Heading</span>
                  <span className="font-bold text-cyan-300">{scan.heading.toFixed(1)}°</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-400">Towfish Altitude</span>
                  <span className="font-bold text-cyan-300">{scan.altitude.toFixed(1)} m</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-400">Acoustic Range</span>
                  <span className="font-bold text-slate-200">
                    {scan.range != null ? `${scan.range.toFixed(1)} m` : 'Per-detection'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-400">Range Calculation Mode</span>
                  <span className="font-bold text-slate-200 uppercase">{scan.range_type}</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-slate-400">Telemetry Provenance</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-300">
                    {scan.data_source}
                  </span>
                </div>
              </div>
            </div>

            {/* Per-Detection Detailed Register */}
            <div className="rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl overflow-hidden backdrop-blur-sm">
              <div className="border-b border-slate-800/80 bg-slate-900/60 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Detection Register</h2>
                    <p className="text-xs text-slate-400">
                      {scan.detections.length} Classified Seabed Anomalies
                    </p>
                  </div>
                </div>
                <span className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-mono font-medium text-slate-300">
                  {scan.detections.length} Targets
                </span>
              </div>

              {scan.detections.length === 0 ? (
                <div className="p-10 text-center text-slate-500 flex flex-col items-center gap-3">
                  <Shield className="h-10 w-10 text-slate-700" />
                  <p className="text-sm font-medium text-slate-400">No anomalies detected</p>
                  <p className="text-xs text-slate-500 max-w-xs">
                    This sonar swathe has been audited with zero high-confidence debris signatures.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80 max-h-[780px] overflow-y-auto">
                  {scan.detections.map((detection, index) => {
                    const meta = getClassMeta(detection.class_name)
                    const colour = boxColour(index)
                    return (
                      <div key={detection.id ?? index} className="px-5 py-6 flex flex-col gap-5">
                        {/* Target Title & Class */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span
                              className="h-4 w-4 rounded shrink-0 shadow-sm"
                              style={{ backgroundColor: colour }}
                            />
                            <div>
                              <div className="text-sm font-bold text-white">
                                Target #{index + 1}
                              </div>
                              <div
                                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold mt-1 border"
                                style={{
                                  backgroundColor: meta.badgeBg,
                                  borderColor: meta.border,
                                  color: meta.accent,
                                }}
                              >
                                {meta.icon}
                                <span>{meta.label}</span>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-right">
                            <span className="text-[10px] text-slate-500 uppercase block">Confidence</span>
                            <span className="font-mono text-xs font-extrabold text-cyan-400">
                              {(detection.confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        {/* SECTION A: AI-DERIVED MODEL SIGNATURE */}
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs">
                          <div className="flex items-center gap-1.5 text-cyan-400 font-bold uppercase tracking-wider text-[10px] mb-2">
                            <Cpu className="h-3 w-3" />
                            <span>AI-Derived Object Inferences</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                            <div>
                              <span className="text-slate-500 block">Class Identifier:</span>
                              <span className="text-slate-200">{detection.class_name}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Detector Model:</span>
                              <span className="text-slate-200">YOLOv11s</span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-slate-500 block">Bounding Box Pixels:</span>
                              <span className="text-slate-300">
                                [{detection.bbox.x1.toFixed(1)}, {detection.bbox.y1.toFixed(1)}, {detection.bbox.x2.toFixed(1)}, {detection.bbox.y2.toFixed(1)}]
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* SECTION B: GEOMETRY-DERIVED GEOLOCATION */}
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs">
                          <div className="flex items-center gap-1.5 text-emerald-400 font-bold uppercase tracking-wider text-[10px] mb-2">
                            <Compass className="h-3 w-3" />
                            <span>Geometry-Derived Deterministic Geolocation</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                            <div>
                              <span className="text-slate-500 block">Relative Bearing:</span>
                              <span className="text-slate-200">
                                {detection.relative_bearing != null ? `${detection.relative_bearing.toFixed(1)}°` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Absolute Bearing:</span>
                              <span className="text-slate-200">
                                {detection.absolute_bearing != null ? `${detection.absolute_bearing.toFixed(1)}°` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Slant Range:</span>
                              <span className="text-cyan-300 font-bold">
                                {detection.range_m != null ? `${detection.range_m.toFixed(1)} m` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Ground Range:</span>
                              <span className="text-cyan-300 font-bold">
                                {detection.ground_range_m != null ? `${detection.ground_range_m.toFixed(1)} m` : '—'}
                              </span>
                            </div>
                            <div className="col-span-2 border-t border-slate-800 pt-1.5 mt-1">
                              <span className="text-slate-500 block">Target Coordinate (WGS-84):</span>
                              <span className="text-emerald-400 font-bold">
                                {detection.target_latitude != null && detection.target_longitude != null
                                  ? `${detection.target_latitude.toFixed(6)}, ${detection.target_longitude.toFixed(6)}`
                                  : 'Not georeferenced'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── FOOTER ────────────────────────────────────────────────────────── */}
        <footer className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-slate-800/80 pt-6 text-xs text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">DRISHTI SSS</span>
            <span>•</span>
            <span>Naval Debris Intelligence &amp; Autonomous Sonar Georeferencing</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/batch-upload" className="text-slate-400 hover:text-cyan-400 transition">
              Upload New Mission Batch
            </Link>
            <span>•</span>
            <Link to="/" className="text-cyan-400 hover:underline">
              Return to Intelligence Dashboard
            </Link>
          </div>
        </footer>
      </main>
    </div>
  )
}

export default ScanDetail
