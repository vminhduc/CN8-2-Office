# Cầu nối Windows chạy nền — CN8-2 Office

Cầu nối này chạy trực tiếp trên máy tính Windows tại công trường để nối bộ **Codex CLI** và hồ sơ nội bộ (`D:\CN8-2`, thư viện, `Downloads\CHECK`) với ứng dụng **CN8-2 Office** trên cloud.

## Nguyên tắc bảo mật & vận hành
- **Chỉ kết nối HTTPS chủ động ra ngoài (`outbound`)** tới backend cloud; **không mở cổng vào máy công trường**.
- **Chỉ nhận danh sách tác vụ đã định nghĩa** (`codex_plan`, `codex_specialist`, `codex_review`, `codex_revise`, ...); **không có API chạy lệnh shell tùy ý**.
- **Không tự vượt khóa màn hình**: nếu máy sleep hoặc khóa màn hình (`LogonUI.exe`), worker báo trạng thái chờ thiết bị/chờ Đức mở khóa thay vì tự chạy sai.
- **Không lưu bí mật vào Git**: `worker/worker.local.json` và `.office-data/agent-knowledge.json` đã được đưa vào `.gitignore`.

## 1. Chuẩn bị trên máy Windows công trường
1. Đảm bảo đã cài **Node.js (>=20)** và đã đăng nhập **Codex CLI** (`codex --version` chạy bình thường).
2. Sao chép file mẫu cấu hình:
   ```powershell
   Copy-Item worker\worker.local.example.json worker\worker.local.json
   ```
3. Đăng ký thiết bị trên cloud (qua tài khoản Quản lý dự án `POST /api/devices/register`) để lấy `workerToken` một lần, sau đó điền `serverUrl`, `deviceId`, `workerToken` và đường dẫn thật (`projectRoot`, `libraryRoot`, `downloadRoot`) vào `worker\worker.local.json`.
4. (Tuỳ chọn — cho Hòa tra cứu TCVN & Hợp đồng) Sao chép `worker\agent-knowledge.example.json` vào `.office-data\agent-knowledge.json` và điền link NotebookLM riêng của anh (không commit file này).

## 2. Chạy thử trực tiếp (kiểm tra kết nối)
```powershell
node worker\cn82-worker.mjs
```
Nếu thành công, log sẽ hiện `Đang kết nối outbound HTTPS tới ...` và bàn làm việc trong văn phòng 3D sẽ chuyển sang trạng thái trực tuyến.

## 3. Cài đặt chạy nền không cần mở trình duyệt hay cửa sổ terminal
Mở PowerShell tại thư mục dự án:
```powershell
# Cài đặt Scheduled Task tự khởi động khi đăng nhập Windows
.\worker\install-worker.ps1 -Action install

# Bật chạy nền
.\worker\install-worker.ps1 -Action start

# Kiểm tra tình trạng
.\worker\install-worker.ps1 -Action status

# Khởi động lại
.\worker\install-worker.ps1 -Action restart

# Tạm dừng
.\worker\install-worker.ps1 -Action stop

# Gỡ cài đặt
.\worker\install-worker.ps1 -Action uninstall
```
Logs chạy nền được ghi tại `.office-data\worker\worker.out.log` và `worker.err.log`.

## 4. Thu hồi quyền thiết bị
Khi cần ngắt máy công trường khỏi hệ thống cloud, Quản lý dự án gọi `POST /api/devices/:id/revoke`. Mọi yêu cầu tiếp theo từ `deviceId` đó sẽ bị chặn (`403`) ngay lập tức.

## 5. Cloud Scheduler (21:00 hằng ngày giờ Việt Nam)
Lịch 21:00 mặc định **tạm dừng** cho đến khi anh kiểm thử xong Gmail/Sheets/Drive/SPM và xác nhận bật. Khi cấu hình Google Cloud Scheduler trên cloud, trỏ HTTP POST tới:
- URL: `<APP_URL>/api/scheduler/tick`
- Lịch cron: `0 21 * * *` (Time zone: `Asia/Ho_Chi_Minh`)
- Header: `X-Scheduler-Secret: <CN82_SCHEDULER_SECRET>`
