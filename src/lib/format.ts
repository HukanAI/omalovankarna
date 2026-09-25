const dayFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });

export function relativeDay(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff <= 0) return 'Dnes';
  if (diff === 1) return 'Včera';
  if (diff < 7) return `Před ${diff} dny`;
  return d.getFullYear() === today.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

/** Česká množná čísla: plural(3, ['omalovánka', 'omalovánky', 'omalovánek']). */
export function plural(n: number, forms: [string, string, string]): string {
  if (n === 1) return forms[0];
  if (n >= 2 && n <= 4) return forms[1];
  return forms[2];
}
