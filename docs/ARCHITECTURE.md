# Bản đồ mã nguồn

| File | Vai trò |
|---|---|
| office.js | Phòng, bàn, đồ vật, camera và tương tác Three.js |
| office-avatar.js / office-life.js | Nhân vật, chân có khớp, bước đi, hoạt cảnh, tên/mây/số báo cáo |
| office-dashboard.js | Biểu đồ vẽ trên màn hình 3D, nền trắng |
| office-inbox.js | Danh sách báo cáo của Đức, checkbox, đang chờ/đã xong |
| agent-knowledge.cjs | Nguồn tra cứu riêng theo tác nhân; link thật chỉ lưu trong .office-data và không vào Git |
| team.json | Tên, vai trò, model và vị trí các thành viên |
| preview-server.cjs / preview-data.cjs | Xem thử đa nền tảng, dữ liệu giả, không gọi AI thật |
| server.cjs | Máy chủ local giới hạn loopback và mã phiên |
| agent-runtime.cjs | Linh phân công, chuyên viên xử lý, Đăng rà soát, lưu kết quả |
| project-docs-mcp.cjs | Connector đọc hồ sơ có giới hạn thư mục, không sửa file |
| dashboard-data.cjs | Đọc/chuẩn hóa Sheet thực theo cấu hình local |
| mail-workflow.cjs / .json | Phân nhánh mail, kiểm tra chứng cứ và điều kiện workflow; chưa tự là lịch chạy |
| office-config.cjs | Đọc cấu hình riêng trên máy; office.local.json luôn bị loại khỏi Git |
| scripts/build.cjs | Xuất danh sách tài sản UI cho phép vào public/ |
| test-*.cjs | Kiểm tra bằng dữ liệu giả, không cần hồ sơ dự án thật |

Môi trường sửa giao diện ưu tiên `npm run dev`. Môi trường xử lý thật cần `npm start`, Codex đăng nhập và cấu hình đường dẫn/quyền đọc trên máy. Bản Git không chứa công cụ đăng nhập, dữ liệu hồ sơ hay cấu hình nguồn thật. Chưa triển khai backend cloud và đăng nhập Google.
