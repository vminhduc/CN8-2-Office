# Quy ước phát triển CN8-2 AI Office

- Đọc README.md và docs/ARCHITECTURE.md trước khi sửa. Giữ yêu cầu người dùng ưu tiên cao nhất.
- Giữ văn phòng hoàn toàn 3D, góc nhìn toàn cảnh cố định. Chỉ zoom khi chọn nhân vật/đối tượng; không thêm bảng HTML hoặc thanh điều khiển ngoài phòng khi chưa được yêu cầu.
- Giữ đủ 10 bàn, 8 trợ lý và bàn Đức — Quản lý dự án ở góc. Giữ model/High và Fast của My trong team.json trừ khi người dùng đổi.
- Giữ nền trắng cho màn hình; tông xám than/be gỗ và nhận diện Casa Luna. Tên nhân vật nhỏ; mây chỉ xuất hiện khi xử lý thật. Hoạt cảnh rảnh không phải bằng chứng tác nhân đang thực hiện công việc.
- Số báo cáo chờ dựa trên báo cáo chưa được Đức tick. Không tự tick báo cáo thật, không suy diễn kiểm duyệt AI là phê duyệt của người dùng. Giữ dữ liệu và lịch sử khi đóng/mở lại báo cáo.
- Preview chỉ dùng dữ liệu giả ghi rõ là mẫu. Không nối preview với ổ đĩa, Codex, email, Zalo, SPM hoặc nguồn dữ liệu thật nếu chưa có yêu cầu cụ thể.
- Không commit office.local.json, .office-data, bí mật, PDF, email hoặc nhật ký. Không nới quyền của local server hoặc connector đọc hồ sơ để làm preview chạy được.
- Không tự bật lịch email hay Notion, không gửi thông báo ngoài hệ thống từ bước kiểm thử. Giữ tác vụ chỉ đọc khi chưa được cho phép ghi.
- Trước khi sửa, fetch và đối chiếu GitHub; giữ thay đổi chưa commit của người dùng. Làm bằng nhánh khi cần, không force push. Nếu thay cùng file từ AI Studio và Codex thì giải quyết xung đột trước khi ghi bản mới.
- Chạy npm test và npm run build sau thay đổi liên quan. Kiểm tra giao diện bằng trình duyệt được công cụ cho phép; không dùng bài kiểm tra mô phỏng để tuyên bố đã kiểm tra trình duyệt.
- Không tự tạo subagent, gửi mail/chat, tạo Notion task hoặc triển khai cloud chỉ vì đọc file này.
