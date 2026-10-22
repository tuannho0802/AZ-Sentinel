@echo off
rem Trinh giam sat: chay AZ Server (Node), neu thoat (loi, cap nhat) thi bat lai sau 5 giay.
rem Duoc Task Scheduler chay luc khoi dong may (tai khoan SYSTEM), xem install-task.ps1.
rem Cau hinh: server.env cung thu muc nay (hoac %AZ_DATA%\server.env). Can Node.js 22.5+ trong PATH
rem hoac dat node.exe canh server.mjs.
rem Dung ping thay timeout vi timeout loi khi chay nen khong co console.
set "DATA=%ProgramData%\AZSentinelServer"
if defined AZ_DATA set "DATA=%AZ_DATA%"
cd /d "%~dp0"
if not defined AZ_ENV_FILE if exist "%~dp0server.env" set "AZ_ENV_FILE=%~dp0server.env"
set "NODE=node"
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
:loop
"%NODE%" --disable-warning=ExperimentalWarning "%~dp0server.mjs"
ping -n 6 127.0.0.1 >nul
goto loop