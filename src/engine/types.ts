/** Jednokanálová mapa s plovoucí čárkou (typicky 0..1). */
export interface Plane {
  w: number;
  h: number;
  data: Float32Array;
}

/** Binární maska, 1 = nastaveno. */
export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

/** RGBA obrázek, stejné rozložení jako ImageData. */
export interface RGBA {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/**
 * Jeden tah omalovánky. Body jsou v souřadnicích kresby (x0,y0,x1,y1,…),
 * `weight` násobí základní tloušťku čáry kresby.
 */
export interface Stroke {
  pts: number[];
  closed: boolean;
  weight: number;
}

/** Vektorová omalovánka nezávislá na rozlišení. */
export interface Drawing {
  /** Rozměry souřadnicového prostoru. */
  w: number;
  h: number;
  /**
   * Obrysy inkoustu – uzavřené polygony vyplňované pravidlem even-odd.
   * Zachovávají přirozenou proměnnou tloušťku kresby.
   */
  rings: number[][];
  /** Tahy s jednotnou tloušťkou: obrys hlavního objektu a dotažené mezery. */
  strokes: Stroke[];
  /** Základní tloušťka tahu v jednotkách kresby. */
  lineWidth: number;
}
