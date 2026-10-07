export interface BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface DetectionResult {
  id: number | null
  scan_id: number | null
  class_name: string
  confidence: number
  bbox: BoundingBox
  target_latitude: number | null
  target_longitude: number | null
  relative_bearing: number | null
  absolute_bearing: number | null
  range_m: number | null
  ground_range_m: number | null
}

export interface NavigationMetadata {
  sonar_latitude: number
  sonar_longitude: number
  heading: number
  altitude: number
  range: number | null
  range_type: string
  relative_bearing: number | null
}

export interface ScanMetadata {
  id: number
  scan_identity: string
  image_path: string
  timestamp: string
  data_source: string
  notes: string | null
}

export interface ScanResult {
  id: number
  batch_id?: string | null
  scan_identity: string
  image_path: string
  sonar_latitude: number
  sonar_longitude: number
  heading: number
  altitude: number
  range: number | null
  range_type: string
  relative_bearing: number | null
  timestamp: string
  data_source: string
  notes: string | null
  detection_count: number
  detections: DetectionResult[]
  metadata: ScanMetadata | null
  navigation: NavigationMetadata | null
}

export interface BatchAnalysisResult {
  batch_id?: string
  total_scans: number
  successful_scans: number
  total_detections: number
  scans: ScanResult[]
}

export interface InvestigationBatchResult {
  batch_id: string
  created_at: string
  total_scans: number
  successful_scans: number
  total_detections: number
  class_counts: Record<string, number>
  data_source: string
  scans: ScanResult[]
}
