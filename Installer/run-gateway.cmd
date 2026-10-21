@echo off
rem Trinh giam sat: chay Gateway, neu thoat (loi, hoac bam "Luu va khoi dong lai" tren giao dien,
rem hoac cap nhat) thi bat lai sau 5 giay. Duoc Task Scheduler chay luc khoi dong may (tai khoan SYSTEM).
rem
rem Co "da tat": nguoi dung bam "Tat hoan toan" tren giao dien thi Gateway ghi file disabled.flag roi thoat.
rem Co file nay thi trinh giam sat KHONG bat lai, ke ca sau khi khoi dong lai may, cho den khi nguoi dung
rem bam shortcut "AZ Gateway" (scripts\start-gateway.ps1 xoa co roi bat tac vu).
rem Ten co va thu muc phai khop voi Gateway\src\config.ts (OFF_FLAG_NAME) va scripts\*.ps1.
rem
rem Dung ping thay timeout vi timeout loi khi chay nen khong co console.
set "AZ_GW_SUPERVISED=1"
set "DATA=%ProgramData%\AZSentinel"
if defined AZ_GW_DATA set "DATA=%AZ_GW_DATA%"
cd /d "%~dp0"
:loop
if exist "%DATA%\disabled.flag" exit /b 0
"%~dp0az-gateway.exe"
if exist "%DATA%\disabled.flag" exit /b 0
ping -n 6 127.0.0.1 >nul
goto loop
