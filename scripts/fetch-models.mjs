// Stáhne ONNX modely z Hugging Face (pevné revize) do public/models a ověří SHA-256.
// Modely jsou součástí repozitáře, takže tenhle skript je potřeba jen při jejich aktualizaci.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'models');

const MODELS = [
  {
    file: 'lineart.onnx',
    // Informative Drawings (Chan, Durand, Isola 2022), MIT
    url: 'https://huggingface.co/rocca/informative-drawings-line-art-onnx/resolve/d38eccbd448cdcd228fb81d708506e5e60b41ccb/model.onnx',
    sha256: '1fef40b8f7126d827e30fbebccf95ae9b0b391795df926bf9366a821bad4f498',
  },
  {
    file: 'sam-encoder.onnx',
    // SlimSAM-77 (Chen et al. 2024), Apache-2.0
    url: 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/vision_encoder_quantized.onnx',
    sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
  },
  {
    file: 'sam-decoder.onnx',
    url: 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/prompt_encoder_mask_decoder_quantized.onnx',
    sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
  },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

mkdirSync(out, { recursive: true });
for (const m of MODELS) {
  const target = join(out, m.file);
  if (existsSync(target) && sha(readFileSync(target)) === m.sha256) {
    console.log(`✓ ${m.file} (už staženo)`);
    continue;
  }
  process.stdout.write(`↓ ${m.file} … `);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha(buf);
  if (got !== m.sha256) throw new Error(`${m.file}: nesedí SHA-256 (${got})`);
  writeFileSync(target, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
