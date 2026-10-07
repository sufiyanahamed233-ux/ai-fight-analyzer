import React, { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Compass,
  Crosshair,
  ExternalLink,
  FileSpreadsheet,
  FolderUp,
  Image as ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  Trash2,
  UploadCloud,
  Zap,
} from 'lucide-react'
import { analyzeBatch, ApiError } from '../services/api'
import type { BatchAnalysisResult } from '../types/api'

const VALID_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png']

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function isValidImageFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return VALID_IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))
}

export default function BatchUpload() {
  const navigate = useNavigate()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const [images, setImages] = useState<File[]>([])
  const [navigationFile, setNavigationFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [result, setResult] = useState<BatchAnalysisResult | null>(null)

  // Drag and drop hover states
  const [isDraggingImages, setIsDraggingImages] = useState(false)
  const [isDraggingCsv, setIsDraggingCsv] = useState(false)

  // Handle adding images
  const handleAddImages = (files: FileList | File[]) => {
    setValidationError(null)
    setApiError(null)

    const newFiles: File[] = []
    const invalidFiles: string[] = []

    Array.from(files).forEach((file) => {
      if (isValidImageFile(file)) {
        // Prevent exact duplicates by filename and size
        const exists = images.some(
          (img) => img.name === file.name && img.size === file.size,
        )
        if (!exists) {
          newFiles.push(file)
        }
      } else {
        invalidFiles.push(file.name)
      }
    })

    if (invalidFiles.length > 0) {
      setValidationError(
        `Ignored ${invalidFiles.length} file(s) with unsupported extensions. Only .jpg, .jpeg, and .png are accepted: ${invalidFiles.slice(0, 3).join(', ')}${invalidFiles.length > 3 ? '...' : ''}`,
      )
    }

    if (newFiles.length > 0) {
      setImages((prev) => [...prev, ...newFiles])
    }
  }

  // Handle setting CSV
  const handleSetCsv = (files: FileList | File[]) => {
    setValidationError(null)
    setApiError(null)

    if (files.length === 0) return
    const file = files[0]

    const lowerName = file.name.toLowerCase()
    if (!lowerName.endsWith('.csv')) {
      setValidationError(`Expected a CSV file, but received "${file.name}".`)
      return
    }

    if (lowerName !== 'navigation.csv') {
      setValidationError(
        `The file is named "${file.name}". The system expects navigation.csv. Please ensure it is named navigation.csv.`,
      )
    }

    setNavigationFile(file)
  }

  const handleRemoveImage = (indexToRemove: number) => {
    setImages((prev) => prev.filter((_, idx) => idx !== indexToRemove))
  }

  const handleClearImages = () => {
    setImages([])
    if (imageInputRef.current) {
      imageInputRef.current.value = ''
    }
  }

  const handleRemoveCsv = () => {
    setNavigationFile(null)
    if (csvInputRef.current) {
      csvInputRef.current.value = ''
    }
  }

  // Basic client-side validation
  const validateForm = (): boolean => {
    if (images.length === 0) {
      setValidationError('Please select at least one sonar image (.jpg, .jpeg, or .png).')
      return false
    }

    if (!navigationFile) {
      setValidationError('Please select the navigation.csv file.')
      return false
    }

    if (navigationFile.name.toLowerCase() !== 'navigation.csv') {
      setValidationError(
        `The navigation file must be named "navigation.csv" (current name: "${navigationFile.name}").`,
      )
      return false
    }

    const hasInvalidImages = images.some((img) => !isValidImageFile(img))
    if (hasInvalidImages) {
      setValidationError('All scan files must be valid images (.jpg, .jpeg, or .png).')
      return false
    }

    setValidationError(null)
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return
    if (!navigationFile) return

    setIsAnalyzing(true)
    setApiError(null)
    setResult(null)

    try {
      const data = await analyzeBatch(images, navigationFile)
      if (data.batch_id) {
        navigate(`/batches/${data.batch_id}`)
      } else {
        setResult(data)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(err.message)
      } else if (err instanceof Error) {
        setApiError(err.message)
      } else {
        setApiError('An unexpected error occurred during batch analysis.')
      }
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleReset = () => {
    setImages([])
    setNavigationFile(null)
    setResult(null)
    setApiError(null)
    setValidationError(null)
    if (imageInputRef.current) imageInputRef.current.value = ''
    if (csvInputRef.current) csvInputRef.current.value = ''
  }

  const isCsvValid =
    navigationFile !== null && navigationFile.name.toLowerCase() === 'navigation.csv'

  const isFormReady = images.length > 0 && isCsvValid && !isAnalyzing

  const step1Complete = images.length > 0
  const step2Complete = isCsvValid
  const step3Ready = isFormReady

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
          <div className="flex items-center gap-3 sm:gap-5">
            <div className="hidden items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-400 md:flex">
              <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
              <span className="font-semibold uppercase tracking-wider">Acoustic Ingestion Port</span>
            </div>

            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-semibold text-slate-200 shadow transition hover:border-slate-600 hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ── MAIN VIEWPORT CONTAINER ───────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[1720px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
        {/* ── BREADCRUMB & HERO SUBHEADER ────────────────────────────────────── */}
        <div className="mb-6 flex flex-col gap-2 border-b border-slate-800/80 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400">
              <Zap className="h-3.5 w-3.5" />
              Multi-Scan Investigation Ingestion Pipeline
            </div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
              Batch Sonar Upload &amp; Georeference Engine
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Ingest acoustic side-scan sonar image swathes paired with precision navigation telemetry.
              The pipeline executes YOLO target detection, calculates slant-range corrections, and persists
              georeferenced anomalies to the forensic investigation database.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
            <span className="rounded border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-400">
              FROZEN MVP PIPELINE
            </span>
          </div>
        </div>

        {/* ── STEP PROGRESS WORKFLOW BANNER ───────────────────────────────────── */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Step 1 Pill */}
          <div
            className={`flex items-center gap-3.5 rounded-xl border p-4 transition-all ${
              step1Complete
                ? 'border-cyan-500/40 bg-[#0f172a]/95 text-white shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                : 'border-slate-800 bg-slate-900/50 text-slate-400'
            }`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${
                step1Complete
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
            >
              {step1Complete ? <CheckCircle2 className="h-5 w-5 text-cyan-400" /> : '01'}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Step 1
              </div>
              <div className="truncate text-sm font-bold text-slate-100">
                Acoustic Sonar Scans
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {images.length > 0 ? `${images.length} images staged` : 'Select .jpg / .png'}
              </div>
            </div>
          </div>

          {/* Step 2 Pill */}
          <div
            className={`flex items-center gap-3.5 rounded-xl border p-4 transition-all ${
              step2Complete
                ? 'border-emerald-500/40 bg-[#0f172a]/95 text-white shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                : 'border-slate-800 bg-slate-900/50 text-slate-400'
            }`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${
                step2Complete
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
            >
              {step2Complete ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : '02'}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Step 2
              </div>
              <div className="truncate text-sm font-bold text-slate-100">
                Navigation Metadata
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {step2Complete ? 'navigation.csv verified' : 'Requires navigation.csv'}
              </div>
            </div>
          </div>

          {/* Step 3 Pill */}
          <div
            className={`flex items-center gap-3.5 rounded-xl border p-4 transition-all ${
              step3Ready
                ? 'border-amber-500/40 bg-[#0f172a]/95 text-white shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                : 'border-slate-800 bg-slate-900/50 text-slate-400'
            }`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${
                step3Ready
                  ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
            >
              <Zap className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Step 3
              </div>
              <div className="truncate text-sm font-bold text-slate-100">
                AI Detection &amp; Georef
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {step3Ready ? 'Ready to analyze' : 'Awaiting files'}
              </div>
            </div>
          </div>
        </div>

        {/* ── ALERTS / NOTIFICATIONS ─────────────────────────────────────────── */}
        {apiError && (
          <div className="mb-8 rounded-xl border border-red-500/40 bg-red-950/40 p-5 text-red-200 shadow-xl backdrop-blur">
            <div className="flex items-start gap-3.5">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="flex-1">
                <h3 className="font-bold text-red-200">Investigation Engine Rejected Batch</h3>
                <p className="mt-1 text-sm leading-relaxed text-red-300/90">{apiError}</p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isAnalyzing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-red-500 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry Ingestion
                  </button>
                  <button
                    type="button"
                    onClick={() => setApiError(null)}
                    className="text-xs text-red-400 underline hover:text-red-300 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {validationError && (
          <div className="mb-8 rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 text-amber-200 shadow-xl backdrop-blur">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
              <p className="text-sm font-medium">{validationError}</p>
            </div>
          </div>
        )}

        {/* ── SUCCESS RESULT VIEW ────────────────────────────────────────────── */}
        {result ? (
          <section className="space-y-8">
            <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 to-slate-900/60 p-6 shadow-xl backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-white">Batch Analysis Complete</h2>
                    <p className="text-sm text-emerald-300/80">
                      Successfully ingested and processed investigation batch scans into PostgreSQL.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white cursor-pointer"
                  >
                    <FolderUp className="h-4 w-4" />
                    Upload Another Batch
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-950/50 transition hover:bg-cyan-500 cursor-pointer"
                  >
                    View Main Dashboard
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Metrics cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-[#0f172a]/90 p-5 shadow-lg">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Total Scans Ingested
                </p>
                <p className="mt-2 text-3xl font-extrabold text-white">{result.total_scans}</p>
                <p className="mt-1 text-xs text-slate-500">Persisted in database</p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0f172a]/90 p-5 shadow-lg">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Successful Scans
                </p>
                <p className="mt-2 text-3xl font-extrabold text-emerald-400">
                  {result.successful_scans}
                </p>
                <p className="mt-1 text-xs text-emerald-500/80">Zero processing errors</p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0f172a]/90 p-5 shadow-lg">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Total Anomalies Found
                </p>
                <p className="mt-2 text-3xl font-extrabold text-cyan-400">
                  {result.total_detections}
                </p>
                <p className="mt-1 text-xs text-cyan-500/80">Classified by YOLO</p>
              </div>
            </div>

            {/* Per-scan result table */}
            <div className="rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl overflow-hidden backdrop-blur-sm">
              <div className="border-b border-slate-800/80 bg-slate-900/60 p-5 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">Batch Scans Ingestion Register</h3>
                  <p className="text-xs text-slate-400">
                    Individual scan identities, coordinates, and AI detection counts.
                  </p>
                </div>
                <span className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-mono font-medium text-slate-300">
                  {result.scans.length} Scans Ingested
                </span>
              </div>

              <div className="divide-y divide-slate-800/60">
                {result.scans.map((scan) => (
                  <div
                    key={scan.id}
                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-cyan-400">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-mono text-sm font-bold text-white">
                          {scan.scan_identity}
                        </p>
                        <p className="text-xs text-slate-400 font-mono">
                          {new Date(scan.timestamp).toLocaleString()} • Lat:{' '}
                          {scan.sonar_latitude.toFixed(5)}, Lon: {scan.sonar_longitude.toFixed(5)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-right">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Detections
                        </span>
                        <p className="font-bold">
                          {scan.detection_count === 0 ? (
                            <span className="text-slate-500 text-xs">Clear (0)</span>
                          ) : (
                            <span className="text-amber-400 text-xs font-mono">
                              {scan.detection_count} Anomaly
                            </span>
                          )}
                        </p>
                      </div>

                      <Link
                        to={`/scans/${scan.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-500/50 hover:bg-cyan-600 hover:text-white"
                      >
                        <span>Scan Detail</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          /* ── UPLOAD & CONFIGURATION FORM ───────────────────────────────────── */
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* ── CARD 1: SONAR SCAN IMAGES ─────────────────────────────────── */}
              <div className="flex flex-col rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl backdrop-blur-sm p-6">
                {/* Step 1 Header */}
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-white">1. Sonar Images</h2>
                        <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 text-[9px] font-mono font-bold text-cyan-400 uppercase">
                          .jpg / .png
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Side-scan raw acoustic images matching navigation.csv
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-mono font-bold ${
                      images.length > 0
                        ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {images.length} Selected
                  </span>
                </div>

                {/* Drag and Drop Zone for Images */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!isAnalyzing) setIsDraggingImages(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setIsDraggingImages(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDraggingImages(false)
                    if (isAnalyzing) return
                    if (e.dataTransfer.files) {
                      handleAddImages(e.dataTransfer.files)
                    }
                  }}
                  className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                    isDraggingImages
                      ? 'border-cyan-400 bg-cyan-950/30 scale-[1.01]'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-950/80'
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 text-cyan-400 shadow-inner">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                  <p className="mt-3 text-sm font-bold text-slate-200">
                    Drag and drop sonar scan images here
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-400">
                    Select multiple files corresponding to the rows in navigation.csv. Accepts .jpg,
                    .jpeg, and .png.
                  </p>

                  <input
                    ref={imageInputRef}
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                    disabled={isAnalyzing}
                    onChange={(e) => {
                      if (e.target.files) handleAddImages(e.target.files)
                    }}
                    className="hidden"
                    id="sonar-images-input"
                  />
                  <label
                    htmlFor="sonar-images-input"
                    className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-bold text-cyan-300 shadow transition hover:bg-cyan-500/20 hover:border-cyan-400"
                  >
                    <FolderUp className="h-4 w-4" />
                    Browse Image Files
                  </label>
                </div>

                {/* Selected Images List */}
                <div className="mt-5 flex flex-1 flex-col">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <span>Selected Swathes ({images.length})</span>
                    {images.length > 0 && !isAnalyzing && (
                      <button
                        type="button"
                        onClick={handleClearImages}
                        className="text-xs font-normal text-slate-500 hover:text-red-400 cursor-pointer transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {images.length === 0 ? (
                    <div className="mt-2 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800/80 p-8 text-center text-xs text-slate-500">
                      <ImageIcon className="h-8 w-8 text-slate-700 mb-2" />
                      No scan images staged yet.
                    </div>
                  ) : (
                    <div className="mt-2 max-h-60 overflow-y-auto space-y-1.5 pr-1">
                      {images.map((img, idx) => (
                        <div
                          key={`${img.name}-${img.size}-${idx}`}
                          className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/70 px-3.5 py-2 text-xs transition hover:border-slate-700"
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span className="font-mono text-[10px] text-cyan-400">
                              #{String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="truncate font-mono font-medium text-slate-200">
                              {img.name}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              ({formatBytes(img.size)})
                            </span>
                          </div>
                          {!isAnalyzing && (
                            <button
                              type="button"
                              onClick={() => handleRemoveImage(idx)}
                              title={`Remove ${img.name}`}
                              className="text-slate-500 transition hover:text-red-400 cursor-pointer p-1"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── CARD 2: NAVIGATION METADATA ───────────────────────────────── */}
              <div className="flex flex-col rounded-xl border border-slate-800 bg-[#0f172a]/90 shadow-xl backdrop-blur-sm p-6">
                {/* Step 2 Header */}
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-white">2. Navigation Metadata</h2>
                        <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-mono font-bold text-emerald-400 uppercase">
                          CSV
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Platform telemetry file named strictly <code className="text-cyan-300">navigation.csv</code>
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-mono font-bold ${
                      isCsvValid
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                    }`}
                  >
                    {isCsvValid ? '1 Verified' : 'Required'}
                  </span>
                </div>

                {/* Drag and Drop Zone for CSV */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!isAnalyzing) setIsDraggingCsv(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setIsDraggingCsv(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDraggingCsv(false)
                    if (isAnalyzing) return
                    if (e.dataTransfer.files) {
                      handleSetCsv(e.dataTransfer.files)
                    }
                  }}
                  className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                    isDraggingCsv
                      ? 'border-emerald-400 bg-emerald-950/30 scale-[1.01]'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-950/80'
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-inner">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <p className="mt-3 text-sm font-bold text-slate-200">
                    Drag and drop navigation.csv here
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-400">
                    Must contain: filename, timestamp, sonar_lat, sonar_lon, heading, altitude, range.
                  </p>

                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    disabled={isAnalyzing}
                    onChange={(e) => {
                      if (e.target.files) handleSetCsv(e.target.files)
                    }}
                    className="hidden"
                    id="navigation-csv-input"
                  />
                  <label
                    htmlFor="navigation-csv-input"
                    className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300 shadow transition hover:bg-emerald-500/20 hover:border-emerald-400"
                  >
                    <FolderUp className="h-4 w-4" />
                    {navigationFile ? 'Replace navigation.csv' : 'Browse navigation.csv'}
                  </label>
                </div>

                {/* Selected CSV Display */}
                <div className="mt-5 flex flex-1 flex-col">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Selected Navigation File
                  </div>

                  {navigationFile ? (
                    <div
                      className={`mt-2 flex items-center justify-between rounded-lg border p-3.5 text-xs transition ${
                        isCsvValid
                          ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                          : 'border-amber-500/30 bg-amber-950/20 text-amber-200'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-400" />
                        <div>
                          <div className="font-mono font-bold text-white truncate">
                            {navigationFile.name}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {formatBytes(navigationFile.size)} • Telemetry CSV
                          </div>
                        </div>
                      </div>
                      {!isAnalyzing && (
                        <button
                          type="button"
                          onClick={handleRemoveCsv}
                          title="Remove navigation file"
                          className="text-slate-500 transition hover:text-red-400 cursor-pointer p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800/80 p-6 text-center text-xs text-slate-500">
                      <FileSpreadsheet className="h-8 w-8 text-slate-700 mb-2" />
                      No navigation.csv file selected.
                    </div>
                  )}

                  {/* Architecture Reference Box */}
                  <div className="mt-4 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3.5 text-xs text-slate-400">
                    <div className="flex items-center gap-2 font-semibold text-slate-300">
                      <Compass className="h-4 w-4 text-cyan-400" />
                      <span>Investigation Batch Structure:</span>
                    </div>
                    <pre className="mt-2 font-mono text-[11px] text-cyan-400 bg-slate-950/90 rounded p-2 border border-slate-800/60">
{`investigation_batch/
├── scans/ (Multiple .jpg / .png sonar images)
└── navigation.csv (1-to-1 scan filename mapping)`}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            {/* ── STEP 3: MISSION READINESS & SUBMISSION ACTION ───────────────── */}
            <div className="rounded-xl border border-slate-800 bg-[#0f172a]/90 p-6 shadow-xl backdrop-blur-sm">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">
                      Step 3 • Execution Trigger
                    </span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isFormReady
                          ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                          : 'bg-slate-600'
                      }`}
                    />
                  </div>
                  <h3 className="mt-1 text-lg font-extrabold text-white">
                    {isFormReady
                      ? 'Investigation Batch Ready for Neural Inference'
                      : 'Awaiting Complete Ingestion Pair'}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 max-w-2xl">
                    {images.length > 0 && isCsvValid
                      ? `Batch prepared: ${images.length} sonar scan image${
                          images.length !== 1 ? 's' : ''
                        } paired with ${navigationFile?.name}. Deterministic geometry and YOLO object detection will run automatically.`
                      : 'Please stage at least one sonar image (.jpg, .jpeg, .png) and exactly one navigation.csv to proceed.'}
                  </p>
                </div>

                {/* Primary Analyze CTA Button */}
                <div className="flex items-center gap-4 shrink-0">
                  <button
                    type="submit"
                    disabled={!isFormReady}
                    className={`inline-flex items-center justify-center gap-2.5 rounded-xl px-7 py-3.5 text-sm font-extrabold tracking-wide uppercase transition-all duration-200 ${
                      isFormReady
                        ? 'bg-gradient-to-r from-cyan-600 via-cyan-500 to-emerald-500 text-white shadow-[0_0_25px_rgba(6,182,212,0.35)] hover:shadow-[0_0_35px_rgba(6,182,212,0.5)] hover:scale-[1.02] cursor-pointer'
                        : 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                    }`}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin text-white" />
                        <span>Analyzing Batch Telemetry...</span>
                      </>
                    ) : (
                      <>
                        <Layers className="h-5 w-5" />
                        <span>Analyze Investigation Batch</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* In-Progress Pipeline Animation Note */}
              {isAnalyzing && (
                <div className="mt-6 rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-4 text-xs text-cyan-200">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-cyan-400 shrink-0" />
                    <div>
                      <div className="font-bold text-white">
                        Executing High-Resolution Sonar Inference Pipeline...
                      </div>
                      <div className="text-[11px] text-cyan-300/80 mt-0.5">
                        Transmitting multipart scans → validating navigation.csv → running YOLO
                        model → computing slant-range georeference → storing persistent database
                        records.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </form>
        )}

        {/* ── FOOTER ────────────────────────────────────────────────────────── */}
        <footer className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-800/80 pt-6 text-xs text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">DRISHTI SSS</span>
            <span>•</span>
            <span>Naval Debris Intelligence &amp; Autonomous Sonar Georeferencing</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span className="font-mono text-emerald-400">BATCH ENGINE ACTIVE</span>
          </div>
        </footer>
      </main>
    </div>
  )
}
