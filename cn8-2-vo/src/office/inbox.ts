import type * as THREE from 'three';
import type { OfficeJob } from '../types/office';

export interface CanvasTarget {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

const reportStates = new Set([
  'waiting_owner_assignment',
  'completed',
  'needs_owner',
  'needs_check',
  'failed',
  'interrupted',
  'waiting_input',
]);

const stateNames: Record<string, string> = {
  waiting_owner_assignment: 'Chờ anh phân công',
  completed: 'Chờ anh xác nhận',
  needs_owner: 'Cần anh xem xét',
  needs_check: 'Cần kiểm tra nguồn',
  failed: 'Có lỗi cần xem',
  interrupted: 'Bị gián đoạn',
  waiting_input: 'Cần anh bổ sung',
};

export const isOwnerReport = (j: OfficeJob): boolean => reportStates.has(j.status);

export const pendingReports = (jobs: OfficeJob[]): OfficeJob[] =>
  jobs.filter((j) => isOwnerReport(j) && !j.ownerClosedAt);

export function reportDisplayText(j: OfficeJob): string {
  let text = String(j.result || j.plan?.summary || j.planSummary || '');
  const prefix = `Yêu cầu: ${j.request}`;
  if (text.startsWith(prefix)) text = text.slice(prefix.length).trimStart();
  return (
    text
      .replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1')
      .replace(/\*\*|`/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .trim() || 'Đã ghi nhận yêu cầu.'
  );
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const out: string[] = [];
  for (const line of String(text).split('\n')) {
    let row = '';
    for (const word of line.split(/\s+/)) {
      if (!word) continue;
      if (row && ctx.measureText(`${row} ${word}`).width > width) {
        out.push(row);
        row = '';
      }
      if (ctx.measureText(word).width <= width) {
        row += (row ? ' ' : '') + word;
      } else {
        for (const ch of word) {
          if (ctx.measureText(row + ch).width > width) {
            out.push(row);
            row = '';
          }
          row += ch;
        }
      }
    }
    out.push(row);
  }
  return out;
}

type InboxAction =
  | { type: 'toggle'; id: string; done: boolean }
  | { type: 'compose' }
  | { type: 'retry'; id: string }
  | { type: 'assign'; job: OfficeJob }
  | { type: 'sendNghia'; job: OfficeJob }
  | { type: 'detail'; id: string }
  | { type: 'back' }
  | { type: 'tab'; tab: 'pending' | 'done' }
  | { type: 'nextList'; pages: number }
  | { type: 'nextDetail' | 'previousDetail'; pages: number };

interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  action: InboxAction;
}

export interface OwnerInboxController {
  draw: (next?: OfficeJob[], nextError?: string) => void;
  click: (uv: { x: number; y: number }) => boolean;
  setPending: (id: string | null) => void;
  readonly selectedJobId: string | null;
  readonly pendingCount: number;
}

export function createOwnerInbox(
  target: CanvasTarget,
  callbacks: {
    isOwner?: boolean;
    onToggle: (id: string, done: boolean) => void;
    onCompose: () => void;
    onRetry?: (id: string) => void;
    onAssign?: (job: OfficeJob) => void;
    onSendToNghia?: (job: OfficeJob) => void;
  },
): OwnerInboxController {
  const c = target.ctx;
  const W = target.canvas.width;
  const H = target.canvas.height;
  let jobs: OfficeJob[] = [];
  let tab: 'pending' | 'done' = 'pending';
  let listPage = 0;
  let detailId: string | null = null;
  let detailPage = 0;
  let pendingId: string | null = null;
  let error = '';
  let regions: HitRegion[] = [];

  const text = (
    value: string,
    x: number,
    y: number,
    size = 24,
    color = '#28313d',
  ) => {
    c.font = `${size >= 28 ? '600' : '400'} ${size}px 'Plus Jakarta Sans', 'Segoe UI', sans-serif`;
    c.fillStyle = color;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillText(value, x, y);
  };

  const clip = (value: string, width: number, size = 23) => {
    c.font = `${size}px 'Plus Jakarta Sans', 'Segoe UI', sans-serif`;
    const normalized = String(value).replace(/\s+/g, ' ');
    let s = normalized;
    while (s.length && c.measureText(`${s}…`).width > width) {
      s = s.slice(0, -1);
    }
    return s.length < normalized.length ? `${s}…` : s;
  };

  function region(x: number, y: number, w: number, h: number, action: InboxAction) {
    regions.push({ x, y, w, h, action });
  }

  function checkbox(j: OfficeJob, x: number, y: number) {
    const checked = !!j.ownerClosedAt;
    c.fillStyle = checked ? '#b78346' : '#ffffff';
    c.strokeStyle = checked ? '#b78346' : '#929aa4';
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x, y, 28, 28, 5);
    c.fill();
    c.stroke();
    if (checked) {
      c.strokeStyle = '#fff';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x + 6, y + 14);
      c.lineTo(x + 12, y + 20);
      c.lineTo(x + 23, y + 8);
      c.stroke();
    }
    region(x - 14, y - 14, 56, 56, { type: 'toggle', id: j.id, done: !checked });
  }

  function draw(next = jobs, nextError = error) {
    jobs = next;
    error = nextError;
    regions = [];
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    text('CN8-2 / ĐỨC · THÀNH VIÊN QUẢN LÝ DỰ ÁN', 40, 42, 21, '#737b85');
    text('Hộp báo cáo', 40, 101, 44);
    const waiting = pendingReports(jobs);
    const closed = jobs.filter((j) => isOwnerReport(j) && j.ownerClosedAt);
    text(`${waiting.length} đang chờ  ·  ${closed.length} đã xong`, 40, 142, 25, '#9b6d37');
    text('Tick ô bên phải khi anh đã xử lý xong báo cáo.', 40, 176, 20, '#737b85');

    const detail = jobs.find((j) => j.id === detailId && isOwnerReport(j));
    if (detail) {
      text('‹ Danh sách', 40, 217, 22, '#9b6d37');
      region(26, 191, 190, 40, { type: 'back' });
      if (callbacks.isOwner !== false) {
        if (detail.status === 'waiting_owner_assignment' && !detail.ownerClosedAt) {
          c.fillStyle = '#b78346';
          c.beginPath();
          c.roundRect(236, 189, 226, 38, 6);
          c.fill();
          text('PHÂN CÔNG TIẾP', 252, 216, 19, '#ffffff');
          region(236, 189, 226, 38, { type: 'assign', job: detail });

          c.fillStyle = '#eef2f6';
          c.beginPath();
          c.roundRect(478, 189, 178, 38, 6);
          c.fill();
          text('GỬI NGHĨA', 502, 216, 19, '#27313e');
          region(478, 189, 178, 38, { type: 'sendNghia', job: detail });
        } else {
          c.fillStyle = '#eef2f6';
          c.beginPath();
          c.roundRect(478, 189, 178, 38, 6);
          c.fill();
          text('GỬI NGHĨA', 502, 216, 19, '#27313e');
          region(478, 189, 178, 38, { type: 'sendNghia', job: detail });
        }
        checkbox(detail, W - 82, 197);
        text(
          detail.ownerClosedAt ? 'Đã kết thúc' : 'Xong',
          W - 244,
          219,
          22,
          detail.ownerClosedAt ? '#9b6d37' : '#737b85',
        );
      }
      c.font = "23px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      const body = `${detail.ownerClosedAt ? 'Đã kết thúc' : stateNames[detail.status] || detail.status}\n\n${reportDisplayText(detail)}`;
      const lines = wrapText(c, body, W - 80);
      const pages = Math.max(1, Math.ceil(lines.length / 10));
      detailPage %= pages;
      lines.slice(detailPage * 10, detailPage * 10 + 10).forEach((line, i) => {
        text(line, 40, 258 + i * 27, 23);
      });
      text('‹ Trước', 40, 535, 20, '#737b85');
      region(25, 511, 155, 37, { type: 'previousDetail', pages });
      text(`Trang ${detailPage + 1}/${pages} · Tiếp ›`, W - 283, 535, 20, '#737b85');
      region(W - 310, 511, 285, 37, { type: 'nextDetail', pages });
    } else {
      detailId = null;
      const rows = tab === 'pending' ? waiting : closed;
      const pages = Math.max(1, Math.ceil(rows.length / 5));
      listPage %= pages;
      rows.slice(listPage * 5, listPage * 5 + 5).forEach((j, i) => {
        const y = 201 + i * 66;
        c.fillStyle = '#f4f3f0';
        c.beginPath();
        c.roundRect(28, y, W - 56, 60, 9);
        c.fill();
        const title = j.plan?.summary || j.planSummary || j.request || 'Báo cáo';
        text(clip(title, W - 170), 44, y + 25, 23);
        text(
          j.ownerClosedAt ? 'Đã kết thúc' : stateNames[j.status] || j.status,
          44,
          y + 48,
          18,
          '#737b85',
        );
        region(28, y, W - 140, 60, { type: 'detail', id: j.id });
        checkbox(j, W - 82, y + 16);
      });
      if (!rows.length) {
        text(
          tab === 'pending'
            ? 'Không còn báo cáo chờ xử lý.'
            : 'Chưa có báo cáo được đánh dấu xong.',
          40,
          282,
          26,
          '#737b85',
        );
      }
      if (pages > 1) {
        text(`Trang ${listPage + 1}/${pages} ›`, W - 235, 545, 20, '#737b85');
        region(W - 270, 522, 242, 30, { type: 'nextList', pages });
      }
    }

    c.fillStyle = '#edeae4';
    c.fillRect(22, 554, W - 44, 66);
    const canRetry =
      detail &&
      !detail.ownerClosedAt &&
      ['failed', 'interrupted', 'needs_check'].includes(detail.status);
    if (canRetry) {
      text('CHẠY LẠI', 42, 595, 20, '#9b6d37');
      region(22, 554, 210, 66, { type: 'retry', id: detail.id });
    } else {
      text(
        detail?.status === 'waiting_input' && !detail.ownerClosedAt ? 'BỔ SUNG' : 'GIAO LINH',
        42,
        595,
        20,
      );
      region(22, 554, 210, 66, { type: 'compose' });
    }
    text(`ĐANG CHỜ ${waiting.length}`, 282, 595, 20, tab === 'pending' ? '#9b6d37' : '#737b85');
    region(260, 554, 240, 66, { type: 'tab', tab: 'pending' });
    text(`ĐÃ XONG ${closed.length}`, 548, 595, 20, tab === 'done' ? '#9b6d37' : '#737b85');
    region(520, 554, 230, 66, { type: 'tab', tab: 'done' });
    text('☑ Kết thúc việc', 778, 595, 18, '#737b85');

    if (error || pendingId) {
      c.fillStyle = '#fff2da';
      c.fillRect(24, 150, W - 48, 36);
      text(error || 'Đang lưu…', 40, 176, 20, '#84501b');
    }
    target.texture.needsUpdate = true;
  }

  return {
    draw,
    click(uv) {
      if (pendingId) return true;
      const x = uv.x * W;
      const y = (1 - uv.y) * H;
      const hit = [...regions]
        .reverse()
        .find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      if (!hit) return true;
      const a = hit.action;
      error = '';
      if (a.type === 'toggle') callbacks.onToggle(a.id, a.done);
      else if (a.type === 'compose') callbacks.onCompose();
      else if (a.type === 'retry') callbacks.onRetry?.(a.id);
      else if (a.type === 'assign') callbacks.onAssign?.(a.job);
      else if (a.type === 'sendNghia') callbacks.onSendToNghia?.(a.job);
      else if (a.type === 'detail') {
        detailId = a.id;
        detailPage = 0;
        draw();
      } else if (a.type === 'back') {
        detailId = null;
        draw();
      } else if (a.type === 'tab') {
        tab = a.tab;
        detailId = null;
        listPage = 0;
        draw();
      } else if (a.type === 'nextList') {
        listPage = (listPage + 1) % a.pages;
        draw();
      } else if (a.type === 'nextDetail' || a.type === 'previousDetail') {
        detailPage = (detailPage + (a.type === 'nextDetail' ? 1 : -1) + a.pages) % a.pages;
        draw();
      }
      return true;
    },
    setPending(id) {
      pendingId = id;
      draw();
    },
    get selectedJobId() {
      return detailId;
    },
    get pendingCount() {
      return pendingReports(jobs).length;
    },
  };
}
