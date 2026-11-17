import type { DashboardData, OfficeJob } from '../types/office.ts';

// Fictional data for UI development/preview only. Never use as an actual project report.
export function createPreviewData(): DashboardData {
  const dates = Array.from(
    { length: 14 },
    (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`,
  );
  return {
    source: {
      classification: 'demo',
      title: 'Dữ liệu mẫu giao diện',
      readAt: '2020-01-14T00:00:00Z',
      url: null,
    },
    weekly: Array.from({ length: 10 }, (_, i) => ({
      week: `Week ${i + 1}`,
      date: `2020-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`,
      plan: 5 + i * 3,
      actual: i < 6 ? 4 + i * 2.8 : null,
    })),
    work: {
      kind: 'work',
      unit: 'điểm %',
      dates,
      rows: Array.from({ length: 12 }, (_, i) => ({
        id: `demo-work-${i}`,
        label: `MẪU · Khu vực ${(i % 2) + 1} · Công tác minh họa ${i + 1}`,
        values: dates.map((_, j) =>
          j % 4 === 0 ? null : (i + j) % 6 === 0 ? -2 : (i + j) % 5,
        ),
      })),
    },
    manpower: {
      kind: 'manpower',
      unit: 'người',
      dates,
      rows: ['Cốt thép mẫu', 'Cốp pha mẫu', 'MEP mẫu'].map((label, i) => ({
        id: `demo-people-${i}`,
        label,
        values: dates.map((_, j) => 8 + i * 4 + (j % 3)),
      })),
    },
    refreshing: false,
    error: null,
  };
}

export function createPreviewJobs(): OfficeJob[] {
  return ['Báo cáo mẫu giao diện', 'Báo cáo mẫu trạng thái'].map(
    (title, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      status: 'completed',
      request: `MẪU · ${title}`,
      plan: { summary: `MẪU · ${title}` },
      result:
        'BẢN XEM THỬ — dữ liệu giả để thiết kế giao diện. Không gọi AI, không kiểm tra hồ sơ công trường. Anh có thể thử tick rồi mở lại báo cáo này.',
      preview: true,
      ownerClosedAt: null,
      createdAt: '2020-01-14T00:00:00Z',
    }),
  );
}
