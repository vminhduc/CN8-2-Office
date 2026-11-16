# Sửa bằng Google AI Studio hoặc Codex

## Trong Google AI Studio

1. Mở Build, chọn dấu **+ → Import from GitHub** và chọn kho private `vminhduc/CN8-2-Office` bằng tài khoản được cấp quyền.
2. Yêu cầu đọc README.md và AGENTS.md, chạy `npm ci --ignore-scripts`, sau đó `npm run dev` để xem thử. Giữ JavaScript/Three.js hiện có.
3. Nêu thay đổi cần làm; kiểm tra bằng `npm test`, `npm run build` và xem giao diện.
4. Trong Settings → GitHub, xem diff rồi push thay đổi. Khi đã sửa ở Codex, pull thay đổi từ GitHub tại đây trước khi giao việc mới.

Khả năng và vị trí nút có thể thay đổi. Tài liệu chính thức được đối chiếu ngày 16/11/2026: https://aistudio.google.com/docs/aistudio-build-mode . Tài liệu hiện mô tả import cùng đồng bộ push/pull hai chiều. Nếu tài khoản chưa có pull hoặc không nhận đúng nhánh, xuất ZIP, đưa vào nhánh riêng trong Git và đối chiếu diff; không ghi đè cả kho từ một bản cũ.

Prompt khởi đầu gợi ý:

> Tiếp tục dự án CN8-2 AI Office này. Đọc README.md, AGENTS.md và docs/ARCHITECTURE.md. Giữ toàn bộ văn phòng tương tác 3D, vai trò nhân vật và mô hình AI. Dùng npm run dev để xem giao diện với dữ liệu mẫu. Chỉ sửa theo yêu cầu của tôi, không thay backend local bằng Gemini hay kết nối dữ liệu công trường khi chưa được yêu cầu. Trước khi hoàn tất chạy npm test và npm run build, cho biết file đã đổi và xem diff trước khi push GitHub.

## Trong Codex/GPT có công cụ sửa kho mã

Mở thư mục Git này hoặc kết nối kho private. Có thể yêu cầu:

> Lấy bản mới nhất của vminhduc/CN8-2-Office, đọc AGENTS.md, sửa [yêu cầu], chạy kiểm tra và cập nhật GitHub. Giữ các thay đổi chưa commit và không tự triển khai.

Quy trình bằng Git:

```sh
git status
git fetch origin
git pull --ff-only
git switch -c codex/ten-thay-doi
# sửa mã, npm test, npm run build
git add <các-file-đã-kiểm-tra>
git commit -m "Mô tả thay đổi"
git push -u origin codex/ten-thay-doi
```

Sau đó hợp nhất nhánh qua pull request. Nếu dùng AI Studio với nhánh mặc định, hoàn tất và đồng bộ một thay đổi trước khi chuyển công cụ. Chat chỉ đọc link GitHub chưa bảo đảm có quyền ghi: cần đăng nhập/kết nối GitHub và công cụ chỉnh mã phù hợp.

GitHub là nơi lưu mã. Việc sửa hoặc push không tự cập nhật ứng dụng local đang chạy, không cấp quyền đọc hồ sơ trên máy cho AI Studio và không triển khai website.
