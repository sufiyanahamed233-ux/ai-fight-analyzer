export interface Fighter {
  id: string;
  name: string;
  imageFileName: string;
  imagePath: string;
}

export const FIGHTER_MAP: Record<string, Fighter> = {
  hasbulla: {
    id: 'hasbulla',
    name: 'Hasbulla',
    imageFileName: 'hasbulla',
    imagePath: '/fighters/hasbulla.png',
  },
  carlos_prates: {
    id: 'carlos_prates',
    name: 'Carlos Prates',
    imageFileName: 'carlos-prates',
    imagePath: '/fighters/carlos-prates.png',
  },
  jean_silva: {
    id: 'jean_silva',
    name: 'Jean Silva',
    imageFileName: 'jean-silva',
    imagePath: '/fighters/jean-silva.png',
  },
  farid_basharat: {
    id: 'farid_basharat',
    name: 'Farid Basharat',
    imageFileName: 'farid-basharat',
    imagePath: '/fighters/farid-basharat.png',
  },
  max_holloway: {
    id: 'max_holloway',
    name: 'Max Holloway',
    imageFileName: 'max-holloway',
    imagePath: '/fighters/max-holloway.png',
  },
  alexander_volkanovski: {
    id: 'alexander_volkanovski',
    name: 'Alexander Volkanovski',
    imageFileName: 'alexander-volkanovski',
    imagePath: '/fighters/alexander-volkanovski.png',
  },
  justin_gaethje: {
    id: 'justin_gaethje',
    name: 'Justin Gaethje',
    imageFileName: 'justin-gaethje',
    imagePath: '/fighters/justin-gaethje.png',
  },
  khabib_nurmagomedov: {
    id: 'khabib_nurmagomedov',
    name: 'Khabib Nurmagomedov',
    imageFileName: 'khabib-nurmagomedov',
    imagePath: '/fighters/khabib-nurmagomedov.png',
  },
  islam_makhachev: {
    id: 'islam_makhachev',
    name: 'Islam Makhachev',
    imageFileName: 'islam-makhachev',
    imagePath: '/fighters/islam-makhachev.png',
  },
  jon_jones: {
    id: 'jon_jones',
    name: 'Jon Jones',
    imageFileName: 'jon-jones',
    imagePath: '/fighters/jon-jones.png',
  },
};

/**
 * Deterministic mapping with zero gaps between score ranges:
 * 0.0–3.5   → Hasbulla
 * >3.5–4.0  → Carlos Prates
 * >4.0–4.1  → Jean Silva
 * >4.1–5.1  → Farid Basharat
 * >5.1–6.6  → Max Holloway
 * >6.6–7.1  → Alexander Volkanovski
 * >7.1–8.1  → Justin Gaethje
 * >8.1–8.7  → Khabib Nurmagomedov
 * >8.7–9.3  → Islam Makhachev
 * >9.3–10.0 → Jon Jones
 *
 * If overall_score is null/undefined/NaN, returns null (do not invent a fighter).
 */
export function getFighterForScore(
  score: number | null | undefined
): Fighter | null {
  if (score === null || score === undefined || isNaN(score)) {
    return null;
  }

  if (score <= 3.5) {
    return FIGHTER_MAP.hasbulla;
  }
  if (score <= 4.0) {
    return FIGHTER_MAP.carlos_prates;
  }
  if (score <= 4.1) {
    return FIGHTER_MAP.jean_silva;
  }
  if (score <= 5.1) {
    return FIGHTER_MAP.farid_basharat;
  }
  if (score <= 6.6) {
    return FIGHTER_MAP.max_holloway;
  }
  if (score <= 7.1) {
    return FIGHTER_MAP.alexander_volkanovski;
  }
  if (score <= 8.1) {
    return FIGHTER_MAP.justin_gaethje;
  }
  if (score <= 8.7) {
    return FIGHTER_MAP.khabib_nurmagomedov;
  }
  if (score <= 9.3) {
    return FIGHTER_MAP.islam_makhachev;
  }
  return FIGHTER_MAP.jon_jones;
}

/**
 * Returns candidate relative URLs in public/fighters/
 * placing the primary exact PNG path first.
 */
export function getCandidateImagePaths(fighter: Fighter): string[] {
  const primary = fighter.imagePath;
  const paths: string[] = [primary];

  const exts = ['png', 'jpg', 'jpeg', 'webp'];
  const variants = [
    fighter.imageFileName,
    fighter.imageFileName.replace(/-/g, '_'),
    fighter.id,
  ];

  for (const v of variants) {
    for (const ext of exts) {
      const p = `/fighters/${v}.${ext}`;
      if (!paths.includes(p)) {
        paths.push(p);
      }
      const pSub = `/fighters/fighter_assets/${v}.${ext}`;
      if (!paths.includes(pSub)) {
        paths.push(pSub);
      }
    }
  }

  return paths;
}
