import type {
  DashboardData,
  OfficeJob,
  WeeklyRow,
  WorkerDevice,
  WorkflowScheduleState,
} from '../types/office';
import type { CanvasTarget } from './inbox';

type DashboardMode = 'overview' | 'weekly' | 'work' | 'manpower';
type ActionKind =
  | DashboardMode
  | 'source'
  | 'days7'
  | 'days14'
  | 'next'
  | 'weeks'
  | 'toggle_schedule';

interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  action?: ActionKind;
  tooltip?: string;
}

export interface WallDashboardController {
  update: (
    next: DashboardData | null,
    newJobs?: OfficeJob[],
    newDevices?: WorkerDevice[],
    newWorkflow?: WorkflowScheduleState | null,
    notice?: string | null,
  ) => void;
  draw: () => void;
  click: (uv: { x: number; y: number }) => { url?: string | null; handled?: boolean } | null;
  hover: (uv: { x: number; y: number }) => void;
  reset: () => void;
  readonly mode: DashboardMode;
}

export function createWallDashboard(
  target: CanvasTarget,
  callbacks?: { onToggleSchedule?: (nextEnabled: boolean) => void },
): WallDashboardController {
  const c = target.ctx;
  const W = target.canvas.width;
  const H = target.canvas.height;
  let data: DashboardData | null = null;
  let jobs: OfficeJob[] = [];
  let devices: WorkerDevice[] = [];
  let workflow: WorkflowScheduleState | null = null;
  let scheduleNotice: string | null = null;
  let mode: DashboardMode = 'overview';
  let days = 7;
  let page = 0;
  let allWeeks = false;
  let hitRegions: HitRegion[] = [];
  let hovered: { text: string } | null = null;

  const colors = {
    ink: '#28313d',
    muted: '#6c7580',
    line: '#e1e4e8',
    panel: '#f8f8f7',
    plan: '#b78346',
    actual: '#526581',
  };

  const fmt = (v: number | null, d = 2) =>
    Number(v).toLocaleString('vi-VN', { maximumFractionDigits: d });
  const shortDate = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '—');

  function text(
    s: string,
    x: number,
    y: number,
    size = 24,
    color = colors.ink,
    align: CanvasTextAlign = 'left',
  ) {
    c.font = `${size >= 32 ? '600' : '400'} ${size}px 'Plus Jakarta Sans', 'Segoe UI', sans-serif`;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillText(String(s), x, y);
  }

  function ellipsis(s: string, width: number, size = 21) {
    c.font = `${size}px 'Plus Jakarta Sans', 'Segoe UI', sans-serif`;
    let out = String(s);
    while (out.length && c.measureText(out).width > width) out = out.slice(0, -1);
    return out.length < String(s).length ? `${out.slice(0, -1)}…` : out;
  }

  function panel(x: number, y: number, w: number, h: number) {
    c.fillStyle = colors.panel;
    c.beginPath();
    c.roundRect(x, y, w, h, 14);
    c.fill();
  }

  function button(
    label: string,
    x: number,
    y: number,
    w: number,
    action: ActionKind,
    selected = false,
  ) {
    c.fillStyle = selected ? '#e1d4c0' : '#eae7e1';
    c.beginPath();
    c.roundRect(x, y, w, 36, 8);
    c.fill();
    text(label, x + w / 2, y + 25, 20, colors.ink, 'center');
    hitRegions.push({ x, y, w, h: 36, action });
  }

  function weekly(x: number, y: number, w: number, h: number) {
    panel(x, y, w, h);
    text('Báo cáo tuần', x + 24, y + 40, 31);
    if (!data) return;
    const latest = data.weekly.filter((r) => r.actual !== null).at(-1);
    if (latest) {
      text(`${fmt(latest.actual)}%`, x + w - 26, y + 44, 39, colors.actual, 'right');
      text(
        `Thực tế ${shortDate(latest.date)} · KH ${fmt(latest.plan)}%`,
        x + w - 26,
        y + 76,
        19,
        colors.muted,
        'right',
      );
    }
    text('Kế hoạch', x + 280, y + 38, 21, colors.plan);
    text('Thực tế', x + 435, y + 38, 21, colors.actual);

    let last = -1;
    for (let idx = data.weekly.length - 1; idx >= 0; idx--) {
      if (data.weekly[idx].actual !== null) {
        last = idx;
        break;
      }
    }
    const rows = allWeeks
      ? data.weekly
      : data.weekly.slice(Math.max(0, last - 5), last + 6);
    if (rows.length < 2) {
      text('Chưa đủ số liệu tuần', x + 24, y + 110, 24);
      return;
    }

    const vals = rows.flatMap((r) => [r.plan, r.actual]).filter((v): v is number => v !== null);
    const lo = allWeeks ? 0 : Math.max(0, Math.floor((Math.min(...vals) - 0.2) * 10) / 10);
    const hi = allWeeks ? 100 : Math.ceil((Math.max(...vals) + 0.2) * 10) / 10;
    const px = x + 88;
    const py = y + 105;
    const pw = w - 135;
    const ph = h - 178;

    for (let k = 0; k < 5; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      const yy = py + ph - (k * ph) / 4;
      c.strokeStyle = colors.line;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px, yy);
      c.lineTo(px + pw, yy);
      c.stroke();
      text(`${fmt(v, 1)}%`, px - 15, yy + 6, 19, colors.muted, 'right');
    }

    const point = (r: WeeklyRow, i: number, key: 'plan' | 'actual') => ({
      x: px + (pw * i) / (rows.length - 1),
      y: py + ph - (((r[key] ?? 0) - lo) / (hi - lo)) * ph,
    });

    for (const [key, color] of [
      ['plan', colors.plan],
      ['actual', colors.actual],
    ] as const) {
      c.strokeStyle = color;
      c.lineWidth = key === 'actual' ? 5 : 3;
      c.setLineDash(key === 'plan' ? [10, 7] : []);
      c.beginPath();
      let pen = false;
      rows.forEach((r, i) => {
        if (r[key] === null) {
          pen = false;
          return;
        }
        const p = point(r, i, key);
        if (pen) c.lineTo(p.x, p.y);
        else c.moveTo(p.x, p.y);
        pen = true;
      });
      c.stroke();
      c.setLineDash([]);
      if (!allWeeks) {
        rows.forEach((r, i) => {
          if (r[key] === null) return;
          const p = point(r, i, key);
          c.fillStyle = color;
          c.beginPath();
          c.arc(p.x, p.y, key === 'actual' ? 6 : 4, 0, Math.PI * 2);
          c.fill();
          if (key === 'actual') {
            text(`${fmt(r[key])}%`, p.x, p.y - 15, 19, color, 'center');
          }
        });
      }
    }

    rows.forEach((r, i) => {
      if (i % Math.max(1, Math.ceil(rows.length / 7)) && i !== rows.length - 1) return;
      const p = point(r, i, 'plan');
      text(shortDate(r.date), p.x, py + ph + 32, 18, colors.muted, 'center');
      text(r.week.replace('Week', 'Tuần'), p.x, py + ph + 54, 17, colors.muted, 'center');
    });

    if (mode === 'overview') {
      hitRegions.push({ x, y, w, h, action: 'weekly' });
    } else {
      button(
        allWeeks ? 'Xem gần kỳ hiện tại' : 'Toàn bộ kế hoạch',
        x + 24,
        y + h - 46,
        235,
        'weeks',
        allWeeks,
      );
    }
  }

  function cellColor(v: number | null, kind: 'work' | 'manpower') {
    if (v === null) return '#f0f1f3';
    if (v < 0) return '#e4b7ac';
    if (v === 0) return '#e2e5e9';
    const bins = kind === 'work' ? [5, 15, 25] : [10, 25, 40];
    return v <= bins[0]
      ? '#dce4ef'
      : v <= bins[1]
        ? '#bbcadd'
        : v <= bins[2]
          ? '#94accb'
          : '#6f8dab';
  }

  function heat(kind: 'work' | 'manpower', x: number, y: number, w: number, h: number) {
    const d = kind === 'work' ? data?.work : data?.manpower;
    panel(x, y, w, h);
    const title = kind === 'work' ? 'Phân bố công việc' : 'Phân bổ nhân lực';
    text(title, x + 23, y + 39, 29);
    if (!d?.rows.length) {
      text('Chưa có bảng nguồn', x + 24, y + 100, 22);
      return;
    }

    const indices = d.dates.map((_, i) => i).slice(-days);
    const dates = indices.map((i) => d.dates[i]);
    const rows = d.rows.filter((r) => !r.isTotal);
    const perPage = mode === 'overview' ? 10 : 22;
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    const currentPage = mode === 'overview' ? 0 : Math.min(page, pages - 1);
    const visible = rows.slice(currentPage * perPage, currentPage * perPage + perPage);

    text(
      `${shortDate(dates[0])}–${shortDate(dates.at(-1))} · ${d.unit}`,
      x + w - 23,
      y + 38,
      19,
      colors.muted,
      'right',
    );

    const lx = x + 22;
    const labelW = mode === 'overview' ? w * 0.39 : w * 0.42;
    const gridX = lx + labelW;
    const cellW = (w - labelW - 45) / indices.length;
    const gridY = y + 86;
    const rowH = Math.min(kind === 'manpower' ? 49 : 25, (h - 155) / Math.max(visible.length, 1));

    dates.forEach((dateStr, i) => {
      text(
        shortDate(dateStr),
        gridX + (i + 0.5) * cellW,
        gridY - 13,
        mode === 'overview' ? 15 : 20,
        colors.muted,
        'center',
      );
    });

    visible.forEach((r, ri) => {
      const yy = gridY + ri * rowH;
      const label = kind === 'work' ? r.label.replaceAll(' | ', ' · ') : r.label;
      text(
        ellipsis(label, labelW - 14, mode === 'overview' ? 17 : 22),
        lx,
        yy + rowH * 0.7,
        mode === 'overview' ? 17 : 22,
      );
      indices.forEach((column, i) => {
        const v = r.values[column];
        const xx = gridX + i * cellW;
        c.fillStyle = cellColor(v, kind);
        c.beginPath();
        c.roundRect(xx + 2, yy + 1, cellW - 4, rowH - 3, 4);
        c.fill();
        text(
          v === null ? '—' : fmt(v, 1),
          xx + cellW / 2,
          yy + rowH * 0.73,
          mode === 'overview' ? 17 : 21,
          v !== null && v > 0 ? '#26384b' : colors.ink,
          'center',
        );
        hitRegions.push({
          x: xx,
          y: yy,
          w: cellW,
          h: rowH,
          tooltip: `${r.label} · ${dates[i]}: ${v === null ? 'Chưa có số liệu' : `${fmt(v)} ${d.unit}`}`,
        });
      });
    });

    const note =
      kind === 'work'
        ? 'Tăng/giảm theo công tác · Âm: giảm · —: trống'
        : 'Theo 5 tổ công nhân; không gồm BCH, cẩu tháp, bảo vệ';
    text(note, x + 22, y + h - 47, mode === 'overview' ? 17 : 20, colors.muted);

    if (mode === 'overview') {
      text(
        `${rows.length} ${kind === 'work' ? 'công tác' : 'tổ'} · Chạm để xem đủ ↗`,
        x + w - 22,
        y + h - 18,
        18,
        colors.muted,
        'right',
      );
      hitRegions.push({ x, y, w, h, action: kind });
    } else {
      button('7 ngày số liệu', x + 22, y + h - 42, 177, 'days7', days === 7);
      button('14 ngày số liệu', x + 210, y + h - 42, 185, 'days14', days === 14);
      if (pages > 1) {
        button(`Trang ${currentPage + 1}/${pages} ›`, x + w - 205, y + h - 42, 180, 'next');
      }
    }
  }

  function draw() {
    hitRegions = [];
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    text(
      data?.source?.classification === 'demo'
        ? 'XEM THỬ · DỮ LIỆU MẪU'
        : 'CN8-2 · DASHBOARD DỰ ÁN',
      40,
      49,
      33,
    );
    text(
      mode === 'overview' ? 'Chạm biểu đồ để xem chi tiết' : '← Tổng quan',
      40,
      88,
      21,
      colors.muted,
    );
    if (mode !== 'overview') hitRegions.push({ x: 20, y: 55, w: 260, h: 48, action: 'overview' });

    if (!data?.weekly?.length) {
      text('Đang đọc số liệu từ Sheet nguồn…', W / 2, H / 2, 38, colors.ink, 'center');
      target.texture.needsUpdate = true;
      return;
    }

    const latest = data.weekly.filter((r) => r.actual !== null).at(-1);
    text(
      `Tiến độ: ${shortDate(latest?.date)} · Công việc / nhân lực: ${shortDate(data.manpower?.dates.at(-1))}`,
      W - 40,
      50,
      22,
      colors.muted,
      'right',
    );
    text('Nguồn Sheet ↗', W - 40, 87, 20, colors.plan, 'right');
    hitRegions.push({ x: W - 240, y: 56, w: 210, h: 40, action: 'source' });

    if (mode === 'overview') {
      weekly(35, 117, W - 70, 365);
      heat('work', 35, 503, (W - 90) / 2, 338);
      heat('manpower', W / 2 + 10, 503, (W - 90) / 2, 338);
    } else if (mode === 'weekly') {
      weekly(35, 117, W - 70, H - 220);
    } else {
      heat(mode, 35, 117, W - 70, H - 220);
    }

    const updated = data.source?.readAt
      ? new Date(data.source.readAt).toLocaleString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
        })
      : '—';
    text(
      scheduleNotice ||
        data.error ||
        (data.source?.classification === 'demo'
          ? 'Dữ liệu mẫu · Không phải báo cáo dự án'
          : `CN8-2 construction · Area / Manpower · Đồng bộ ${updated}`),
      40,
      H - 49,
      19,
      scheduleNotice ? '#9b4a3a' : colors.muted,
    );
    const active = jobs.filter((j) =>
      ['planning', 'working', 'reviewing', 'running'].includes(j.status),
    );
    const waitingDev = jobs.filter((j) => j.status === 'waiting_device').length;
    const onlineWorkers = devices.filter(
      (d) => !d.revoked && (d.status === 'online' || d.status === 'busy'),
    );
    const lockedWorkers = devices.filter((d) => !d.revoked && d.status === 'locked');
    const workerLabel =
      onlineWorkers.length > 0
        ? `Máy công trường: trực tuyến (${onlineWorkers.length})`
        : lockedWorkers.length > 0
          ? 'Máy công trường: đang khóa'
          : 'Máy công trường: ngoại tuyến';
    const schedLabel = workflow?.enabled
      ? 'Lịch 21:00: ĐANG BẬT'
      : 'Lịch 21:00: tạm dừng';
    const rightText = `${active.length} đang chạy${waitingDev ? ` · ${waitingDev} chờ máy` : ''} · ${workerLabel} · ${schedLabel}`;
    text(
      rightText,
      W - 40,
      H - 49,
      19,
      workflow?.enabled ? '#49856a' : colors.muted,
      'right',
    );
    hitRegions.push({
      x: W - 310,
      y: H - 78,
      w: 280,
      h: 44,
      action: 'toggle_schedule',
    });

    if (hovered) {
      const width = Math.min(W - 100, c.measureText(hovered.text).width + 60);
      c.fillStyle = '#ece7de';
      c.beginPath();
      c.roundRect(50, H - 132, width, 49, 9);
      c.fill();
      text(ellipsis(hovered.text, width - 35, 20), 68, H - 100, 20, '#28313d');
    }

    target.texture.needsUpdate = true;
  }

  return {
    update(next, newJobs, newDevices, newWorkflow, notice) {
      if (next) data = next;
      if (newJobs) jobs = newJobs;
      if (newDevices) devices = newDevices;
      if (newWorkflow !== undefined) workflow = newWorkflow;
      if (notice !== undefined) scheduleNotice = notice;
      draw();
    },
    draw,
    click(uv) {
      const x = uv.x * W;
      const y = (1 - uv.y) * H;
      const r = [...hitRegions]
        .reverse()
        .find(
          (region) =>
            region.action &&
            x >= region.x &&
            x <= region.x + region.w &&
            y >= region.y &&
            y <= region.y + region.h,
        );
      if (!r || !r.action) return null;
      if (r.action === 'source') return { url: data?.source?.url };
      if (r.action === 'toggle_schedule') {
        callbacks?.onToggleSchedule?.(!(workflow?.enabled ?? false));
        return { handled: true };
      }
      if (r.action === 'days7') days = 7;
      else if (r.action === 'days14') days = 14;
      else if (r.action === 'next') {
        const key = mode === 'work' || mode === 'manpower' ? mode : 'work';
        const count = data?.[key]?.rows.filter((row) => !row.isTotal).length || 1;
        page = (page + 1) % Math.max(1, Math.ceil(count / 22));
      } else if (r.action === 'weeks') {
        allWeeks = !allWeeks;
      } else {
        mode = r.action;
        page = 0;
      }
      hovered = null;
      draw();
      return { handled: true };
    },
    hover(uv) {
      const x = uv.x * W;
      const y = (1 - uv.y) * H;
      const r = hitRegions.find(
        (region) => region.tooltip && x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h,
      );
      const next = r?.tooltip ? { text: r.tooltip } : null;
      if (next?.text !== hovered?.text) {
        hovered = next;
        draw();
      }
    },
    reset() {
      mode = 'overview';
      hovered = null;
      page = 0;
      draw();
    },
    get mode() {
      return mode;
    },
  };
}
