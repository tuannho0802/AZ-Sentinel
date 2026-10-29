# Tài liệu AZ Sentinel

Tổng quan dự án và cách chạy nhanh: [`../README.md`](../README.md). Tài liệu viết bằng tiếng Việt; mỗi tệp ghi rõ phần nào đã chạy thử và phần nào chưa.

## Đọc theo mục đích

| Muốn | Đọc |
|---|---|
| Cài môi trường phát triển | [Local_Setup](AZ_Sentinel_Local_Setup.md) |
| Cài và vận hành (Admin, User) | [User_Gateway_Flow](AZ_Sentinel_User_Gateway_Flow.md), [Server_Installer](AZ_Sentinel_Server_Installer.md), [Gateway_Installer](AZ_Sentinel_Gateway_Installer.md), [Gateway_Token](AZ_Sentinel_Gateway_Token.md) |
| Hiểu VPS chính + Cloudflare dự phòng | [Plan3E_VPS_Primary](AZ_Sentinel_Plan3E_VPS_Primary.md), [Quick_Tunnel](AZ_Sentinel_Quick_Tunnel.md) |
| Cài và tối ưu PWA | [PWA](AZ_Sentinel_PWA.md) |
| Giới hạn ai được vào | [Whitelist_IP](AZ_Sentinel_Whitelist_IP.md) (gồm whitelist thiết bị) |
| Giao dịch từ xa | [Remote_Trading](AZ_Sentinel_Remote_Trading.md) |
| Thông báo lỗ float | [Plan5_Notifications](AZ_Sentinel_Plan5_Notifications.md) |
| Phát hành, CI | [CI_Tags_And_Gateway_Power](AZ_Sentinel_CI_Tags_And_Gateway_Power.md) |
| Server ép Gateway tự cập nhật bản mới | [Gateway_AutoUpdate](AZ_Sentinel_Gateway_AutoUpdate.md) |
| Kiểm thử thủ công | [Manual_Test_EA](AZ_Sentinel_Manual_Test_EA.md), [Manual_Test_Gateway](AZ_Sentinel_Manual_Test_Gateway.md) |

## Quy tắc và nhật ký (đọc trước khi sửa mã)

| Tệp | Nội dung |
|---|---|
| [Rules_BE](AZ_Sentinel_Rules_BE.md), [Rules_FE](AZ_Sentinel_Rules_FE.md) | Quy tắc viết mã và checklist |
| [BE_Workflow](AZ_Sentinel_BE_Workflow.md), [FE_Workflow](AZ_Sentinel_FE_Workflow.md) | Theo dõi tiến độ, quyết định, việc còn nợ; mục 6 là **nhật ký chỉ append**, mỗi thay đổi đáng kể thêm một dòng |

## Kế hoạch theo giai đoạn

| Tệp | Nội dung |
|---|---|
| [Plan1_EA](AZ_Sentinel_Plan1_EA.md) | EA MT5 gửi dữ liệu |
| [Plan2_System_DB](AZ_Sentinel_Plan2_System_DB.md) | Hệ thống và cơ sở dữ liệu |
| [Plan3_Implementation](AZ_Sentinel_Plan3_Implementation.md) | Kế hoạch triển khai theo Part |
| [Plan3B_Live_On_Demand](AZ_Sentinel_Plan3B_Live_On_Demand.md) | Live theo yêu cầu |
| [Plan3C_Local_Gateway](AZ_Sentinel_Plan3C_Local_Gateway.md) | Gateway chạy cạnh MT5 |
| [Plan3D_Free_Tier](AZ_Sentinel_Plan3D_Free_Tier.md) | Tối ưu gói free Cloudflare |
| [Plan3E_VPS_Primary](AZ_Sentinel_Plan3E_VPS_Primary.md) | VPS chính, Cloudflare dự phòng |
| [Quick_Tunnel](AZ_Sentinel_Quick_Tunnel.md) | Plan 3G đến 3K: Quick Tunnel tự theo, Worker chuyển hướng, mã thiết bị |
| [Plan5_Notifications](AZ_Sentinel_Plan5_Notifications.md) | Thông báo |
| [spike-results](spike-results.md) | Kết quả thử nghiệm ban đầu |

Nhiều tệp Plan là bản thiết kế lúc đó; khi lệch với mã, **mã và các tệp vận hành ở bảng trên là chuẩn**.
