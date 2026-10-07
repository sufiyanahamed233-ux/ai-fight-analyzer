/**
 * Type definitions matching the backend Fight Analysis & Observation response.
 *
 * Source endpoints:
 * POST /api/v1/fight/analyze
 * POST /api/v1/analyze
 */

export interface CategoryObservation {
  category: string;
  score: number | null; // Heuristic score 0.0 to 10.0 (null if keypoints insufficient)
  observation: string;
  metrics_summary?: Record<string, unknown> | null;
}

export interface FightObservationResult {
  session_id?: string | null;
  overall_score: number | null;
  stance: CategoryObservation;
  balance: CategoryObservation;
  guard: CategoryObservation;
  striking: CategoryObservation;
  coordination: CategoryObservation;
  movement: CategoryObservation;
  disclaimer: string;
}

export interface FightAnalysisRequest {
  duration_seconds?: number;
  duration?: number;
  front_source?: string;
  side_source?: string;
}
