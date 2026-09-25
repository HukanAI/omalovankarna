export type Level = 'mali' | 'skolaci' | 'zkuseni';

export interface LevelPreset {
  /** Delší strana vstupu pro kreslicí síť (px). */
  size: number;
  /** Zjednodušení fotky před kreslením (guided filter): poloměr jako zlomek delší strany, eps, počet průchodů. */
  abstract: { radius: number; eps: number; iterations: number } | null;
  /** Rozmazání mapy čar před prahováním (px). */
  blur: number;
  /** Hysterezní práh. */
  lo: number;
  hi: number;
  /** Poloměr morfologického uzavření (px). */
  closeRadius: number;
  /** Následující délky jsou zlomky delší strany kresby. */
  minGroup: number;
  spur: number;
  gap: number;
  /** Tloušťka čáry v mm při tisku na A4. */
  lineMm: number;
  smoothIterations: number;
  simplifyEps: number;
  /** Krátké tahy se slabším průměrným inkoustem se považují za texturu. */
  minStrength: number;
  /** Díry v čarách menší než (holeSize·L)² se zaplní (čára se neztenčí na „korálky“). */
  holeSize: number;
  /** Úroveň izokřivky obrysu inkoustu – nižší = silnější čáry. */
  iso: number;
  /** Síla vyhlazení perových tahů (sigma v px předvolené velikosti). */
  penSmooth: number;
}

export const LEVELS: Record<Level, LevelPreset> = {
  // Předškoláci: málo velkých ploch, silná čára, žádné šrafování.
  mali: {
    size: 448,
    abstract: { radius: 0.009, eps: 0.01, iterations: 2 },
    blur: 0.7,
    lo: 0.2,
    hi: 0.45,
    closeRadius: 0,
    minGroup: 0.09,
    spur: 0.045,
    gap: 0.04,
    lineMm: 1.9,
    smoothIterations: 12,
    simplifyEps: 0.7,
    minStrength: 0.34,
    holeSize: 0.02,
    iso: 0.22,
    penSmooth: 3.2,
  },
  // Školáci: víc detailů, stále zřetelně uzavřené plochy.
  skolaci: {
    size: 640,
    abstract: { radius: 0.008, eps: 0.008, iterations: 2 },
    blur: 0.6,
    lo: 0.2,
    hi: 0.45,
    closeRadius: 0,
    minGroup: 0.035,
    spur: 0.018,
    gap: 0.025,
    lineMm: 1.25,
    smoothIterations: 9,
    simplifyEps: 0.55,
    minStrength: 0.3,
    holeSize: 0.012,
    iso: 0.3,
    penSmooth: 2.4,
  },
  // Pro zkušené: jemná kresba včetně textur.
  zkuseni: {
    size: 896,
    abstract: { radius: 0.005, eps: 0.004, iterations: 2 },
    blur: 0.5,
    lo: 0.18,
    hi: 0.42,
    closeRadius: 0,
    minGroup: 0.018,
    spur: 0.008,
    gap: 0.014,
    lineMm: 0.7,
    smoothIterations: 6,
    simplifyEps: 0.45,
    minStrength: 0.26,
    holeSize: 0.008,
    iso: 0.36,
    penSmooth: 1.8,
  },
};

export const LEVEL_ORDER: Level[] = ['mali', 'skolaci', 'zkuseni'];

/** Tisková šířka kresby na A4 (297 mm minus okraje). */
export const PRINT_LONG_MM = 270;
