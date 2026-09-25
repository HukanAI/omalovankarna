import type { Mask } from './types';

/**
 * Graf střednice: uzly jsou konce a křižovatky čar, hrany jsou lomené čáry
 * mezi nimi. Nad grafem se pak dají dělat „kreslířská“ rozhodnutí –
 * odstranit chlupy a šrafování, spojit navazující tahy.
 */
export interface GraphNode {
  x: number;
  y: number;
  edges: number[];
}

export interface GraphEdge {
  /** Uzly na koncích; u samostatné smyčky -1. */
  a: number;
  b: number;
  pts: number[];
  closed: boolean;
  alive: boolean;
  len: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function polyLength(pts: number[], closed = false): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  if (closed && pts.length >= 4) {
    len += Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]);
  }
  return len;
}

export function traceSkeleton(s: Mask): Graph {
  const { w, h, data } = s;
  const n = w * h;
  const deg = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!data[i]) continue;
      let d = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && data[ny * w + nx]) d++;
      }
      deg[i] = d;
    }
  }

  // Shluky sousedících uzlových pixelů (konce, křižovatky) tvoří jeden uzel.
  const nodeOf = new Int32Array(n).fill(-1);
  const nodes: GraphNode[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!data[i] || deg[i] === 2 || nodeOf[i] !== -1) continue;
    const id = nodes.length;
    let sx = 0;
    let sy = 0;
    let cnt = 0;
    stack.push(i);
    nodeOf[i] = id;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j / w) | 0;
      sx += x;
      sy += y;
      cnt++;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (data[q] && deg[q] !== 2 && nodeOf[q] === -1) {
          nodeOf[q] = id;
          stack.push(q);
        }
      }
    }
    nodes.push({ x: sx / cnt, y: sy / cnt, edges: [] });
  }

  const edges: GraphEdge[] = [];
  const visited = new Uint8Array(n);
  const addEdge = (a: number, b: number, pts: number[], closed: boolean) => {
    const id = edges.length;
    edges.push({ a, b, pts, closed, alive: true, len: polyLength(pts, closed) });
    if (a >= 0) nodes[a].edges.push(id);
    if (b >= 0) nodes[b].edges.push(id);
  };

  for (let p = 0; p < n; p++) {
    const a = nodeOf[p];
    if (a < 0) continue;
    const px = p % w;
    const py = (p / w) | 0;
    for (let k = 0; k < 8; k++) {
      const qx = px + DX[k];
      const qy = py + DY[k];
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
      const q = qy * w + qx;
      if (!data[q] || nodeOf[q] >= 0 || visited[q]) continue;
      const pts = [nodes[a].x, nodes[a].y];
      let prev = p;
      let cur = q;
      let b = -1;
      for (;;) {
        visited[cur] = 1;
        const cx = cur % w;
        const cy = (cur / w) | 0;
        pts.push(cx, cy);
        let next = -1;
        for (let k2 = 0; k2 < 8; k2++) {
          const nx = cx + DX[k2];
          const ny = cy + DY[k2];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const m = ny * w + nx;
          if (data[m] && m !== prev && (nodeOf[m] >= 0 || !visited[m])) {
            next = m;
            break;
          }
        }
        if (next === -1) break;
        if (nodeOf[next] >= 0) {
          b = nodeOf[next];
          pts.push(nodes[b].x, nodes[b].y);
          break;
        }
        prev = cur;
        cur = next;
      }
      if (b === -1) continue; // slepá ulička – nemělo by nastat
      if (a === b && pts.length <= 8) continue; // mikrosmyčka uvnitř křižovatky
      addEdge(a, b, pts, false);
    }
  }

  // Zbylé neprojité pixely se dvěma sousedy tvoří uzavřené smyčky.
  for (let s0 = 0; s0 < n; s0++) {
    if (!data[s0] || deg[s0] !== 2 || visited[s0]) continue;
    const pts: number[] = [];
    let prev = -1;
    let cur = s0;
    for (;;) {
      visited[cur] = 1;
      const cx = cur % w;
      const cy = (cur / w) | 0;
      pts.push(cx, cy);
      let next = -1;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const m = ny * w + nx;
        if (data[m] && m !== prev && !visited[m] && nodeOf[m] < 0) {
          next = m;
          break;
        }
      }
      if (next === -1) break;
      prev = cur;
      cur = next;
    }
    if (pts.length >= 8) addEdge(-1, -1, pts, true);
  }

  return { nodes, edges };
}

export function degree(g: Graph, node: number): number {
  let d = 0;
  for (const e of g.nodes[node].edges) {
    const edge = g.edges[e];
    if (!edge.alive) continue;
    d++; // smyčka je v seznamu uzlu dvakrát, a tak se správně počítá za 2
  }
  return d;
}

/**
 * Odstraní krátké výběžky (hrana s volným koncem napojená na křižovatku).
 * Mažou se od nejkratších a křižovatka si vždy ponechá aspoň dvě větve,
 * aby se hlavní čára nerozpadla.
 */
export function pruneSpurs(g: Graph, maxLen: number, rounds = 2): void {
  for (let r = 0; r < rounds; r++) {
    const cand: number[] = [];
    g.edges.forEach((e, i) => {
      if (!e.alive || e.closed || e.len >= maxLen) return;
      const da = degree(g, e.a);
      const db = degree(g, e.b);
      if ((da === 1 && db >= 3) || (db === 1 && da >= 3)) cand.push(i);
    });
    if (!cand.length) break;
    cand.sort((x, y) => g.edges[x].len - g.edges[y].len);
    for (const i of cand) {
      const e = g.edges[i];
      const junction = degree(g, e.a) === 1 ? e.b : e.a;
      if (degree(g, junction) >= 3) e.alive = false;
    }
  }
}

/** Smaže souvislé skupiny tahů, jejichž celková délka je menší než `minLen`. */
export function removeShortGroups(g: Graph, minLen: number): void {
  const parent = g.nodes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const e of g.edges) {
    if (e.alive && !e.closed) parent[find(e.a)] = find(e.b);
  }
  const total = new Map<number, number>();
  for (const e of g.edges) {
    if (!e.alive || e.closed) continue;
    const r = find(e.a);
    total.set(r, (total.get(r) ?? 0) + e.len);
  }
  for (const e of g.edges) {
    if (!e.alive) continue;
    const len = e.closed ? e.len : total.get(find(e.a))!;
    if (len < minLen) e.alive = false;
  }
}

/** Pokud uzel spojuje právě dva tahy, sloučí je do jednoho souvislého tahu. */
export function mergeThroughNodes(g: Graph): void {
  const reversed = (pts: number[]) => {
    const out: number[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      out[pts.length - 2 - i] = pts[i];
      out[pts.length - 1 - i] = pts[i + 1];
    }
    return out;
  };
  for (let nId = 0; nId < g.nodes.length; nId++) {
    const node = g.nodes[nId];
    const alive = node.edges.filter((e) => g.edges[e].alive);
    if (alive.length !== 2 || alive[0] === alive[1]) continue;
    const e1 = g.edges[alive[0]];
    const e2 = g.edges[alive[1]];
    if (e1.a === e1.b || e2.a === e2.b) continue;
    // e1 orientujeme tak, aby končil v uzlu, e2 aby v něm začínal.
    const p1 = e1.b === nId ? e1.pts : reversed(e1.pts);
    const from = e1.b === nId ? e1.a : e1.b;
    const p2 = e2.a === nId ? e2.pts : reversed(e2.pts);
    const to = e2.a === nId ? e2.b : e2.a;
    const pts = p1.concat(p2.slice(2));
    e1.alive = false;
    e2.alive = false;
    const id = g.edges.length;
    if (from === to && degree(g, from) === 0) {
      // Dva tahy se spojily do uzavřené smyčky.
      g.edges.push({ a: -1, b: -1, pts: pts.slice(0, -2), closed: true, alive: true, len: polyLength(pts) });
      continue;
    }
    g.edges.push({ a: from, b: to, pts, closed: false, alive: true, len: polyLength(pts) });
    g.nodes[from].edges.push(id);
    g.nodes[to].edges.push(id);
  }
}

/** Průměrná hodnota mapy podél hrany (síla tahu). */
export function edgeStrength(e: GraphEdge, p: { w: number; h: number; data: Float32Array }): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < e.pts.length; i += 2) {
    const x = Math.min(p.w - 1, Math.max(0, Math.round(e.pts[i])));
    const y = Math.min(p.h - 1, Math.max(0, Math.round(e.pts[i + 1])));
    sum += p.data[y * p.w + x];
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Odstraní krátké slabé tahy – typicky kresbu srsti, trávy nebo zrna.
 * Dlouhé tahy zůstávají i když jsou slabší, protože nesou tvar.
 */
export function removeWeak(g: Graph, strength: { w: number; h: number; data: Float32Array }, minStrength: number, longLen: number): void {
  for (const e of g.edges) {
    if (!e.alive || e.len >= longLen) continue;
    const s = edgeStrength(e, strength);
    // Čím kratší tah, tím silnější musí být, aby zůstal.
    const need = minStrength * (1 + 0.3 * (1 - e.len / longLen));
    if (s < need) e.alive = false;
  }
}

/**
 * Vrátí smazané úseky, které spojují dva ponechané tahy – typicky slabší
 * kousek obrysu mezi dvěma silnými. Díky tomu se obrysy netrhají.
 */
export function restoreConnectors(g: Graph, maxLen: number, rounds = 2): void {
  for (let r = 0; r < rounds; r++) {
    const revive: GraphEdge[] = [];
    for (const e of g.edges) {
      if (e.alive || e.closed || e.a < 0 || e.b < 0 || e.a === e.b || e.len > maxLen) continue;
      if (degree(g, e.a) >= 1 && degree(g, e.b) >= 1) revive.push(e);
    }
    if (!revive.length) break;
    for (const e of revive) e.alive = true;
  }
}

/**
 * V chráněné oblasti (obličej, u kterého nejde kreslit rysy z bodů) vrátí
 * i krátké a slabší tahy – oči a ústa jsou malé, ale nesmí zmizet.
 */
export function reviveInZone(g: Graph, zone: Uint8Array, w: number, minLen: number): void {
  for (const e of g.edges) {
    if (e.alive || e.len < minLen) continue;
    let inside = 0;
    const n = e.pts.length / 2;
    for (let i = 0; i < n; i++) inside += zone[Math.round(e.pts[i * 2 + 1]) * w + Math.round(e.pts[i * 2])] ? 1 : 0;
    if (inside / n > 0.6) e.alive = true;
  }
}
