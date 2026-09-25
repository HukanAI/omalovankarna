import { PDFDocument, PDFOperator, PDFOperatorNames, rgb, LineCapStyle, LineJoinStyle } from 'pdf-lib';
import {
  appendBezierCurve,
  closePath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib';
import { traceCurve, type CurveSink } from '../engine/svg';
import type { Drawing } from '../engine/types';

const MM = 72 / 25.4;
const A4_PT = { w: 210 * MM, h: 297 * MM };

export interface PdfPage {
  drawing: Drawing;
  colored?: Blob | null;
}

/**
 * Vektorové PDF na A4: čáry zůstanou ostré při jakémkoli tisku.
 * Obrysy inkoustu se vyplňují pravidlem even-odd (operátor f*),
 * které pdf-lib nenabízí přímo, proto se skládají operátory ručně.
 */
export async function makePdf(pages: PdfPage[], title = 'Omalovánky'): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('Omalovánkárna');
  doc.setProducer('Omalovánkárna');
  doc.setLanguage('cs');

  for (const { drawing: d, colored } of pages) {
    const landscape = d.w > d.h * 1.08;
    const pw = landscape ? A4_PT.h : A4_PT.w;
    const ph = landscape ? A4_PT.w : A4_PT.h;
    const margin = 12 * MM;
    const s = Math.min((pw - 2 * margin) / d.w, (ph - 2 * margin) / d.h);
    const ox = (pw - d.w * s) / 2;
    const oy = (ph - d.h * s) / 2;
    const page = doc.addPage([pw, ph]);

    if (colored) {
      const png = await doc.embedPng(await colored.arrayBuffer());
      page.drawImage(png, { x: ox, y: oy, width: d.w * s, height: d.h * s });
    }

    // Souřadnice PDF mají počátek vlevo dole.
    const ops: PDFOperator[] = [];
    const sink: CurveSink = {
      move: (x, y) => ops.push(moveTo(x, ph - y)),
      line: (x, y) => ops.push(lineTo(x, ph - y)),
      cubic: (a, b, c, e, x, y) => ops.push(appendBezierCurve(a, ph - b, c, ph - e, x, ph - y)),
      close: () => ops.push(closePath()),
    };
    const ink = rgb(0.114, 0.102, 0.09);
    ops.push(pushGraphicsState(), setFillingRgbColor(ink.red, ink.green, ink.blue));
    for (const ring of d.rings) traceCurve(ring, true, sink, s, ox, oy);
    ops.push(PDFOperator.of(PDFOperatorNames.FillEvenOdd));

    ops.push(
      setStrokingRgbColor(ink.red, ink.green, ink.blue),
      setLineCap(LineCapStyle.Round),
      setLineJoin(LineJoinStyle.Round),
    );
    const byWeight = new Map<number, typeof d.strokes>();
    for (const st of d.strokes) byWeight.set(st.weight, [...(byWeight.get(st.weight) ?? []), st]);
    for (const [weight, strokes] of byWeight) {
      ops.push(setLineWidth(d.lineWidth * weight * s));
      for (const st of strokes) traceCurve(st.pts, st.closed, sink, s, ox, oy);
      ops.push(stroke());
    }
    ops.push(popGraphicsState());
    page.pushOperators(...ops);
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
