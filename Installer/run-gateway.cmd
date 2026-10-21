@echo off
rem Trinh giam sat: chay Gateway, neu thoat (loi, hoac bam "Luu va khoi dong lai" tren giao dien,
rem hoac cap nhat) thi bat lai sau 5 giay. Duoc Task Scheduler chay luc khoi dong may (tai khoan SYSTEM).
rem Dung ping thay timeout vi timeout loi khi chay nen khong co console.
cd /d "%~dp0"
:loop
"%~dp0az-gateway.exe"
ping -n 6 127.0.0.1 >nul
goto loop
