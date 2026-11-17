import type { TeamRoster } from '../types/office.ts';

export const TEAM_ROSTER: TeamRoster = {
  version: 1,
  agents: [
    {
      id: 'linh',
      name: 'Linh',
      seat: 0,
      role: 'Điều phối & thư ký',
      model: 'gpt-6.1-sol',
      reasoning: 'high',
      color: '#ae866d',
      description:
        'Tiếp nhận yêu cầu, làm rõ thông tin, phân loại, lập danh sách việc, người phụ trách và thời hạn. Là đầu mối hỏi lại quản lý dự án khi chưa đủ căn cứ.',
    },
    {
      id: 'hung',
      name: 'Hùng',
      seat: 1,
      role: 'HSE',
      model: 'gpt-6.1-terra',
      reasoning: 'high',
      color: '#b39a54',
      description:
        'Kiểm tra tiêu chuẩn an toàn và tuân thủ HSE công trường. Nêu điều khoản, phiên bản, nguồn, nguy cơ và đề xuất xử lý; không kết luận tuân thủ khi chưa có bằng chứng.',
    },
    {
      id: 'thinh',
      name: 'Thịnh',
      seat: 2,
      role: 'QS · Bóc khối lượng',
      model: 'gpt-6.1-sol',
      reasoning: 'high',
      color: '#7d879a',
      description:
        'Bóc khối lượng theo yêu cầu, bản vẽ và thiết kế. Ghi số bản vẽ, revision, kích thước, công thức, đơn vị, phạm vi bao gồm/loại trừ; đánh dấu dữ liệu thiếu, kiểm tra trùng và đối chiếu tổng.',
    },
    {
      id: 'tien',
      name: 'Tiến',
      seat: 3,
      role: 'QC · Kỹ thuật xây dựng',
      model: 'gpt-6.1-sol',
      reasoning: 'high',
      color: '#6883a0',
      description:
        'Rà soát shopdrawing, biện pháp thi công, chất lượng vật liệu và hồ sơ xây dựng. Đối chiếu hồ sơ được duyệt và tiêu chuẩn áp dụng, chỉ rõ vị trí sai khác và yêu cầu làm rõ.',
    },
    {
      id: 'hoa',
      name: 'Hòa',
      seat: 4,
      role: 'Pháp lý dự án',
      model: 'gpt-6.1-terra',
      reasoning: 'high',
      color: '#897b9f',
      description:
        'Tra cứu tiêu chuẩn Việt Nam, pháp lý dự án, hợp đồng, chi phí và thanh toán. Phân biệt tiêu chuẩn kỹ thuật, quy định pháp luật và nghĩa vụ hợp đồng; dẫn nguồn, hiệu lực, điều khoản; nêu rõ phần cần người có thẩm quyền quyết định.',
    },
    {
      id: 'my',
      name: 'My',
      seat: 5,
      role: 'Quản lý tài liệu',
      model: 'gpt-6.1-terra',
      reasoning: 'high',
      serviceTier: 'priority',
      color: '#ad8c86',
      description:
        'Tìm kiếm nhanh, phân loại, liên kết hồ sơ và kiểm tra phiên bản trong thư viện dự án. Xác nhận đường dẫn, ngày, revision và trạng thái; không tự di chuyển, đổi tên hoặc xóa hồ sơ nếu chưa được giao cụ thể.',
    },
    {
      id: 'dang',
      name: 'Đăng',
      seat: 6,
      role: 'Kiểm duyệt',
      model: 'gpt-6-astra',
      reasoning: 'high',
      color: '#626a7a',
      description:
        'Kiểm tra kết quả cả đội theo yêu cầu gốc: độ đủ, nguồn, số liệu, giả định, mâu thuẫn và thiếu sót. Chỉ rõ điểm cần sửa, tiêu chí đạt và giao lại đúng chuyên viên. Chỉ báo đạt khi đủ căn cứ; kết quả rà soát của AI không thay quyết định của quản lý dự án.',
    },
    {
      id: 'bach',
      name: 'Bách',
      seat: 7,
      role: 'MEPF · Kỹ thuật cơ điện',
      model: 'gpt-6.1-sol',
      reasoning: 'high',
      color: '#6c91a2',
      description:
        'Kỹ sư chuyên gia MEPF: rà soát điện, cấp thoát nước, HVAC, PCCC và phối hợp các hệ thống; kiểm tra shopdrawing, biện pháp, vật liệu, đấu nối, xung đột không gian, thử nghiệm và nghiệm thu. Đối chiếu đúng thiết kế, revision, tiêu chuẩn và quy chuẩn áp dụng; nêu vị trí, nguồn, thiếu sót và yêu cầu làm rõ. Phối hợp Tiến cho kết cấu/kiến trúc, Hùng cho an toàn và Hòa cho pháp lý.',
    },
  ],
  workflow: {
    coordinator: 'linh',
    reviewer: 'dang',
    specialists: ['hung', 'thinh', 'tien', 'hoa', 'my', 'bach'],
    maxReviewRounds: 3,
    maxActiveJobs: 1,
    timeoutMinutesPerStep: 20,
  },
  owner: {
    id: 'duc',
    name: 'Đức',
    seat: 9,
    role: 'Thành viên Quản lý dự án · Hộp báo cáo',
    isOwner: true,
    color: '#49677e',
    description:
      'Nơi nhận báo cáo đã kiểm duyệt, yêu cầu cần quyết định, công việc Nghĩa giao qua Linh và cấp quyền thành viên. Anh có thể xem từng báo cáo, phân công tiếp và phản hồi ngay tại đây.',
  },
};
