# CN8-2 AI Office

Văn phòng 3D gồm 10 bàn, 8 trợ lý, bàn Đức — Quản lý dự án và Dashboard trên tường. Tương tác trực tiếp trong 3D, không có thanh điều khiển ngoài phòng. Bản mã nguồn 0.12.1 được chuẩn bị từ ứng dụng local 0.12.0.

## Hai nơi sửa, một kho mã

Kho `vminhduc/CN8-2-Office` là nơi lưu bản chuẩn. Có thể sửa bằng Google AI Studio hoặc Codex/GPT rồi cập nhật về cùng kho. Các công cụ không tự biết thay đổi chưa được lưu lên GitHub của nhau.

1. Trước khi sửa, lấy bản mới nhất từ GitHub.
2. Chỉ giao một nơi sửa một nhóm file tại một thời điểm. Nếu làm song song, dùng nhánh riêng.
3. Kiểm tra `npm test` và `npm run build`, xem thử giao diện rồi mới lưu thay đổi.
4. Đẩy lên GitHub. Sang công cụ còn lại, lấy bản mới trước khi tiếp tục.
5. Không dùng force push để ghi đè thay đổi chưa đối chiếu. Giữ lịch sử để có thể quay về bản trước.

Xem [hướng dẫn AI Studio và Codex](docs/EDITING.md), [bản đồ mã nguồn](docs/ARCHITECTURE.md) và [hướng dẫn cho tác nhân](AGENTS.md).

## Xem thử trong AI Studio hoặc máy bất kỳ

Yêu cầu Node.js 22 trở lên.

```sh
npm ci --ignore-scripts
npm run dev
```

Mở địa chỉ được in ra, thường là `http://localhost:3000`. Máy chủ dùng biến `PORT` khi môi trường cung cấp. Đây là bản xem thử chỉ dùng dữ liệu giả được ghi rõ **DỮ LIỆU MẪU**; không gọi Codex, không đọc email/ổ D:, không gửi thông báo hay phê duyệt. Checkbox trong bản xem thử chỉ lưu trong bộ nhớ, được đặt lại khi máy chủ xem thử khởi động lại.

Giao diện có thể chỉnh trực tiếp bằng JavaScript/Three.js hiện có; không cần chuyển sang React hoặc thay toàn bộ ứng dụng.

## Chạy việc thật trên máy đã cấu hình

```sh
npm start
```

Bản local dùng `http://127.0.0.1:8882`, gọi Codex CLI đã đăng nhập trên máy. Chỉ mở một máy chủ trên cổng này. Cần Codex CLI, Python với pypdf và Poppler nếu đọc PDF. Cấu hình thư mục được cấp quyền, nguồn Sheet và tài khoản mail trong `office.local.json` dựa theo `office.local.example.json`. Có thể chỉ rõ đường dẫn Python/Poppler trong file cấu hình. Không commit file cấu hình này.

Model và vai trò nằm trong `team.json`; My có cấu hình Fast/priority. Chưa có đăng nhập Google, chia sẻ người dùng, backend cloud hay tự khởi động Windows. Lịch email 21:00 vẫn tạm dừng; mã nguồn không tạo hoặc bật lịch của ứng dụng Codex. Mã local có bảo vệ phiên và chỉ phục vụ loopback; không đưa máy chủ local thẳng ra Internet.

Checkbox báo cáo local ghi nhận Đức kết thúc việc, lưu lâu dài trong `.office-data/`, giảm số chờ và cho phép mở lại trong “Đã xong”. Điều này không gửi phê duyệt sang SPM hoặc Notion và không thay kết luận chuyên môn.

## Kiểm tra và xuất giao diện

```sh
npm test
npm run build
```

`public/` chỉ chứa giao diện và thư viện đã chọn, không chứa backend, cấu hình hoặc dữ liệu nội bộ. Nó chưa phải ứng dụng vận hành độc lập trên cloud. Thư viện Three.js được lưu kèm giấy phép trong `vendor/`; logo Casa Luna thuộc chủ sở hữu thương hiệu, chỉ dùng trong phạm vi được phép.

## Không đưa lên GitHub

Không đưa `.office-data/`, hồ sơ dự án, file scan/PDF, nội dung email, ảnh chụp công việc, token, mật khẩu, lịch sử đăng nhập hoặc `office.local.json` lên kho. `.gitignore` đã loại các mục chính; vẫn xem danh sách thay đổi trước mỗi lần lưu.

Ứng dụng đang chạy trước khi đóng gói nằm ở thư mục `project-office` cũ. Bản Git này là bản nguồn để tiếp tục phát triển; việc cập nhật mã không tự khởi động lại hay thay thế ứng dụng đang chạy.
