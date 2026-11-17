import fs from 'fs';
import path from 'path';
import type { DashboardData, HeatRow, HeatTable, WeeklyRow } from '../types/office.ts';
import { createPreviewData } from './previewData.ts';

interface SheetRange {
  range: string;
  values: string[][];
}

interface DashboardSnapshot {
  version: number;
  source: {
    spreadsheetId: string;
    title: string;
    url: string;
    website: string;
    readAt: string;
    classification: 'real_source';
    readMethod: string;
  };
  ranges: {
    weekly?: SheetRange;
    work?: SheetRange;
    manpower?: SheetRange;
  };
}

const REQUESTS: Record<'weekly' | 'work' | 'manpower', { sheet: string; range: string }> = {
  weekly: { sheet: 'Area', range: 'E2:I140' },
  work: { sheet: 'Area', range: 'Q2:AF100' },
  manpower: { sheet: 'Manpower', range: 'U2:AK8' },
};

export function parseSheetNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(
    String(value).trim().replace(/%/g, '').replace(/\s/g, '').replace(',', '.'),
  );
  return Number.isFinite(n) ? n : null;
}

export function parseSheetDate(value: unknown): string | null {
  const parts = String(value || '')
    .trim()
    .split('/')
    .map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  let [day, month, year] = parts;
  if (year < 100) year += 2000;
  const t = new Date(Date.UTC(year, month - 1, day));
  return t.getUTCDate() === day && t.getUTCMonth() === month - 1
    ? t.toISOString().slice(0, 10)
    : null;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function buildHeatTable(
  raw: SheetRange | undefined,
  kind: 'work' | 'manpower',
): HeatTable | null {
  const values = raw?.values || [];
  const headerAt = values.findIndex(
    (r) => r.slice(1).filter((v) => parseSheetDate(v)).length >= 2,
  );
  if (headerAt < 0) return null;
  const header = values[headerAt];
  const columns = header
    .map((v, index) => ({ index, date: parseSheetDate(v) }))
    .filter((c): c is { index: number; date: string } => c.index > 0 && c.date !== null);
  const dates = columns.map((c) => c.date);
  const rows: HeatRow[] = values
    .slice(headerAt + 1)
    .filter((r) => String(r[0] || '').trim())
    .map((r, index) => ({
      id: `${kind}-${index}`,
      label: String(r[0]).trim(),
      isTotal: /tổng|total/iu.test(String(r[0])),
      values: columns.map((c) => parseSheetNumber(r[c.index])),
      sourceRow: 2 + headerAt + 1 + index,
    }));
  return {
    kind,
    dates,
    rows,
    unit: kind === 'work' ? 'điểm %' : 'người',
    sourceRange: raw?.range,
  };
}

function normalizeSnapshot(snapshot: DashboardSnapshot): Omit<DashboardData, 'refreshing' | 'error'> {
  const weekly: WeeklyRow[] = (snapshot.ranges?.weekly?.values || [])
    .filter((r) => /^week\s+\d+/i.test(String(r[0])) && parseSheetDate(r[1]))
    .map((r, i) => ({
      week: r[0],
      date: parseSheetDate(r[1])!,
      plan: parseSheetNumber(r[2]),
      actual: parseSheetNumber(r[3]),
      sourceRow: i + 2,
    }));

  return {
    source: snapshot.source,
    weekly,
    work: buildHeatTable(snapshot.ranges?.work, 'work'),
    manpower: buildHeatTable(snapshot.ranges?.manpower, 'manpower'),
  };
}

function loadLocalConfig(): { dashboardSheetId: string; dashboardWebsite: string } {
  const localPath = path.join(process.cwd(), 'office.local.json');
  let local: Record<string, unknown> = {};
  if (fs.existsSync(localPath)) {
    try {
      local = JSON.parse(fs.readFileSync(localPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      local = {};
    }
  }
  return {
    dashboardSheetId:
      (typeof local.dashboardSheetId === 'string' && local.dashboardSheetId) ||
      process.env.OFFICE_SHEET_ID ||
      '',
    dashboardWebsite:
      (typeof local.dashboardWebsite === 'string' && local.dashboardWebsite) || '',
  };
}

const config = loadLocalConfig();
const snapshotFile = path.join(process.cwd(), '.office-data', 'dashboard-source.json');
let snapshot: DashboardSnapshot | null = null;
let inflight: Promise<DashboardData | null> | null = null;
let lastTry = 0;
let lastError: string | null = null;

if (config.dashboardSheetId && fs.existsSync(snapshotFile)) {
  try {
    snapshot = JSON.parse(
      fs.readFileSync(snapshotFile, 'utf8').replace(/^\uFEFF/, ''),
    ) as DashboardSnapshot;
  } catch {
    snapshot = null;
  }
}

export async function refreshDashboardSheet(): Promise<DashboardData | null> {
  const sheetId = config.dashboardSheetId;
  if (!sheetId) return createPreviewData();
  if (inflight) return inflight;
  lastTry = Date.now();
  inflight = (async () => {
    try {
      const ranges: DashboardSnapshot['ranges'] = {};
      await Promise.all(
        (Object.entries(REQUESTS) as [keyof typeof REQUESTS, { sheet: string; range: string }][]).map(
          async ([key, spec]) => {
            const u = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
            u.searchParams.set('tqx', 'out:csv');
            u.searchParams.set('sheet', spec.sheet);
            u.searchParams.set('range', spec.range);
            u.searchParams.set('headers', '0');
            const r = await fetch(u, { signal: AbortSignal.timeout(18000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const text = await r.text();
            if (/^\s*</.test(text)) throw new Error('Nguồn chưa trả dữ liệu bảng');
            ranges[key] = {
              range: `${spec.sheet}!${spec.range}`,
              values: parseCsv(text.replace(/^\uFEFF/, '')),
            };
          },
        ),
      );
      const next: DashboardSnapshot = {
        version: 1,
        source: {
          spreadsheetId: sheetId,
          title: 'CN8-2 construction',
          url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
          website: config.dashboardWebsite,
          readAt: new Date().toISOString(),
          classification: 'real_source',
          readMethod: 'direct_google_sheets',
        },
        ranges,
      };
      const data = normalizeSnapshot(next);
      if (!data.weekly.length || !data.work?.rows.length || !data.manpower?.rows.length) {
        throw new Error('Thiếu bảng nguồn yêu cầu');
      }
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
      fs.writeFileSync(`${snapshotFile}.tmp`, JSON.stringify(next, null, 2));
      fs.renameSync(`${snapshotFile}.tmp`, snapshotFile);
      snapshot = next;
      lastError = null;
      return { ...data, refreshing: false, error: null };
    } catch {
      lastError = 'Chưa đồng bộ được nguồn; giữ lần đọc đã xác minh.';
      return snapshot
        ? { ...normalizeSnapshot(snapshot), refreshing: false, error: lastError }
        : null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function getDashboardData(): DashboardData {
  if (!config.dashboardSheetId) {
    return createPreviewData();
  }
  if (Date.now() - lastTry > 300_000) {
    void refreshDashboardSheet();
  }
  return {
    ...(snapshot
      ? normalizeSnapshot(snapshot)
      : { weekly: [], work: null, manpower: null, source: null }),
    refreshing: !!inflight,
    error: lastError,
  };
}

export function isLiveSheetConfigured(): boolean {
  return Boolean(config.dashboardSheetId);
}
