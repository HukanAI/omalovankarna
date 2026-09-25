// Vygeneruje ikony aplikace z vektorové předlohy (spouští se jen při změně ikony).
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const PAPER = '#f6f0e4';
const INK = '#231f1b';
const CRAYON = '#e8653a';
const CRAYON_2 = '#f2a541';

// Kočičí hlava tažená tuší, napůl vybarvená pastelkou – omalovánka „v rozpracování“.
const head =
  'M150 214 C146 170 146 128 158 92 C194 108 222 128 240 150 C250 148 262 148 272 150 ' +
  'C292 128 320 108 354 92 C366 128 368 170 362 214 C390 246 400 284 392 322 ' +
  'C378 392 322 426 256 426 C190 426 134 392 120 322 C112 284 122 246 150 214 Z';

function art({ scale = 1, bg = true, round = true, mono = false } = {}) {
  const t = `translate(${256 - 256 * scale} ${256 - 256 * scale}) scale(${scale})`;
  // Tahy pastelky: šikmé šrafy s nepravidelnou hranou, oříznuté tvarem hlavy.
  let hatch = '';
  for (let i = -8; i < 26; i++) {
    const x = 60 + i * 15;
    hatch += `M${x} 440 L${x + 170} 170 `;
  }
  const colour = mono
    ? ''
    : `<g clip-path="url(#head)">
         <path d="M96 470 L96 250 C150 262 196 236 232 262 C262 284 250 330 300 346 C340 360 380 330 420 350 L420 470 Z" fill="${CRAYON}"/>
         <path d="${hatch}" stroke="${CRAYON_2}" stroke-width="5" stroke-linecap="round" opacity=".55" clip-path="url(#fill)"/>
       </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="head"><path d="${head}"/></clipPath>
    <clipPath id="fill"><path d="M96 470 L96 250 C150 262 196 236 232 262 C262 284 250 330 300 346 C340 360 380 330 420 350 L420 470 Z"/></clipPath>
  </defs>
  ${bg ? `<rect width="512" height="512" ${round ? 'rx="116"' : ''} fill="${PAPER}"/>` : ''}
  <g transform="${t}">
    ${colour}
    <g fill="none" stroke="${mono ? '#000' : INK}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">
      <path d="${head}"/>
      <path d="M204 286 c6 -10 22 -10 28 0"/>
      <path d="M280 286 c6 -10 22 -10 28 0"/>
      <path d="M244 330 l12 12 l12 -12" />
      <path d="M170 330 l-44 -8 M172 350 l-40 8 M342 330 l44 -8 M340 350 l40 8" stroke-width="12"/>
    </g>
  </g>
</svg>`;
}

const png = (svg, size, file) => sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(join(out, file));

await png(art(), 192, 'icon-192.png');
await png(art(), 512, 'icon-512.png');
// Maskovatelná ikona: celoplošný papír, kresba v bezpečné zóně (80 %).
await png(art({ scale: 0.72, round: false }), 512, 'maskable-512.png');
// iOS si rohy zaobluje samo.
await png(art({ scale: 0.86, round: false }), 180, 'apple-touch-icon.png');
await png(art({ scale: 0.9 }), 96, 'shortcut-new.png');
writeFileSync(join(out, 'favicon.svg'), art({ scale: 0.95 }));
writeFileSync(join(out, 'monochrome.svg'), art({ bg: false, mono: true, scale: 0.8 }));
// Náhled pro sociální sítě / README.
await png(art(), 1024, 'icon-1024.png');
console.log('Ikony vygenerovány do public/icons');
