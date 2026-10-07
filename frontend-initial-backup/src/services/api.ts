import type { BatchAnalysisResult, InvestigationBatchResult, ScanResult } from '../types/api'

const API_BASE_URL = 'http://127.0.0.1:8000/api'

export class ApiError extends Error {
  readonly status: number
  readonly detail?: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export async function getScans(): Promise<ScanResult[]> {
  const response = await fetch(`${API_BASE_URL}/scans`)

  if (!response.ok) {
    let errorMessage = `Failed to fetch scans: ${response.status}`
    try {
      const errorJson = await response.json()
      if (typeof errorJson?.detail === 'string') {
        errorMessage = errorJson.detail
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, errorMessage)
  }

  return response.json()
}

export async function getScan(scanId: number): Promise<ScanResult> {
  const response = await fetch(`${API_BASE_URL}/scans/${scanId}`)

  if (!response.ok) {
    let errorMessage = `Failed to fetch scan ${scanId}: ${response.status}`
    try {
      const errorJson = await response.json()
      if (typeof errorJson?.detail === 'string') {
        errorMessage = errorJson.detail
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, errorMessage)
  }

  return response.json()
}

export async function analyzeBatch(
  images: File[],
  navigationFile: File,
): Promise<BatchAnalysisResult> {
  const formData = new FormData()

  for (const image of images) {
    formData.append('scans', image)
  }
  formData.append('navigation', navigationFile)

  const response = await fetch(`${API_BASE_URL}/batches/analyze`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type header; browser automatically sets multipart/form-data boundary
  })

  if (!response.ok) {
    let detailMessage = `Batch analysis failed with status ${response.status}`
    let rawDetail: unknown = null
    try {
      const errorJson = await response.json()
      rawDetail = errorJson?.detail
      if (typeof errorJson?.detail === 'string') {
        detailMessage = errorJson.detail
      } else if (Array.isArray(errorJson?.detail)) {
        detailMessage = errorJson.detail
          .map((item: { msg?: string; loc?: (string | number)[] }) => item.msg || JSON.stringify(item))
          .join(', ')
      } else if (errorJson?.detail) {
        detailMessage = JSON.stringify(errorJson.detail)
      }
    } catch {
      if (response.statusText) {
        detailMessage = `${detailMessage}: ${response.statusText}`
      }
    }
    throw new ApiError(response.status, detailMessage, rawDetail)
  }

  return response.json()
}

export async function getBatch(batchId: string): Promise<InvestigationBatchResult> {
  const response = await fetch(`${API_BASE_URL}/batches/${batchId}`)

  if (!response.ok) {
    let errorMessage = `Failed to fetch batch ${batchId}: ${response.status}`
    try {
      const errorJson = await response.json()
      if (typeof errorJson?.detail === 'string') {
        errorMessage = errorJson.detail
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, errorMessage)
  }

  return response.json()
}

export async function getBatchReportJson(batchId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}/batches/${batchId}/report/json`)

  if (!response.ok) {
    let errorMessage = `Failed to fetch batch JSON report: ${response.status}`
    try {
      const errorJson = await response.json()
      if (typeof errorJson?.detail === 'string') {
        errorMessage = errorJson.detail
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, errorMessage)
  }

  return response.json()
}

export async function getBatchReportGeoJson(batchId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}/batches/${batchId}/report/geojson`)

  if (!response.ok) {
    let errorMessage = `Failed to fetch batch GeoJSON report: ${response.status}`
    try {
      const errorJson = await response.json()
      if (typeof errorJson?.detail === 'string') {
        errorMessage = errorJson.detail
      }
    } catch {
      // ignore
    }
    throw new ApiError(response.status, errorMessage)
  }

  return response.json()
}

export function getBatchReportPdfUrl(batchId: string): string {
  return `${API_BASE_URL}/batches/${batchId}/report/pdf`
}
