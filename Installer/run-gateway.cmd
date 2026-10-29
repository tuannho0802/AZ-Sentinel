@echo off
rem Trinh giam sat: chay Gateway, neu thoat (loi, hoac bam "Luu va khoi dong lai" tren giao dien,
rem hoac cap nhat) thi bat lai sau 5 giay. Duoc Task Scheduler chay luc khoi dong may (tai khoan SYSTEM).
rem
rem Co "da tat": nguoi dung bam "Tat hoan toan" tren giao dien thi Gateway ghi file disabled.flag roi thoat.
rem Co file nay thi trinh giam sat KHONG bat lai, ke ca sau khi khoi dong lai may, cho den khi nguoi dung
rem bam shortcut "AZ Gateway" (scripts\start-gateway.ps1 xoa co roi bat tac vu).
rem Ten co va thu muc phai khop voi Gateway\src\config.ts (OFF_FLAG_NAME) va scripts\*.ps1.
rem
rem Tu cap nhat (Server bao ban Gateway moi): Gateway tai az-gateway.exe.new roi thoat. Vong lap duoi day
rem thay file truoc moi lan chay: az-gateway.exe -> .old, .new -> az-gateway.exe, va ghi co .trial (ban moi dang
rem thu). Gateway chay on dinh 30 giay thi tu xoa .old va .trial. Neu ban moi thoat truoc do 3 lan lien tiep
rem (.trial con) thi tra ban cu ve va ghi update-failed.txt (phien ban loi) de Gateway khong nhan lai ban do.
rem Ten file phai khop Gateway\src\self-update.ts va Installer\az-gateway.iss ([InstallDelete]).
rem
rem Dung ping thay timeout vi timeout loi khi chay nen khong co console.
set "AZ_GW_SUPERVISED=1"
rem Windows 8.1 / Server 2012 R2: Node tu choi chay neu khong bo qua kiem tra nen tang.
set "NODE_SKIP_PLATFORM_CHECK=1"
set "DATA=%ProgramData%\AZSentinel"
if defined AZ_GW_DATA set "DATA=%AZ_GW_DATA%"
cd /d "%~dp0"
set "FAILS=0"
:loop
if exist "%DATA%\disabled.flag" exit /b 0
call :swap
"%~dp0az-gateway.exe"
if exist "%DATA%\disabled.flag" exit /b 0
call :trialcheck
ping -n 6 127.0.0.1 >nul
goto loop

:swap
if not exist "%~dp0az-gateway.exe.new" exit /b 0
if exist "%~dp0az-gateway.exe.old" del /f /q "%~dp0az-gateway.exe.old" >nul 2>&1
move /y "%~dp0az-gateway.exe" "%~dp0az-gateway.exe.old" >nul 2>&1
if exist "%~dp0az-gateway.exe" exit /b 0
move /y "%~dp0az-gateway.exe.new" "%~dp0az-gateway.exe" >nul 2>&1
if not exist "%~dp0az-gateway.exe" move /y "%~dp0az-gateway.exe.old" "%~dp0az-gateway.exe" >nul 2>&1
if not exist "%~dp0az-gateway.exe.old" exit /b 0
if exist "%~dp0az-gateway.exe.new.ver" move /y "%~dp0az-gateway.exe.new.ver" "%~dp0az-gateway.exe.trial" >nul 2>&1
if not exist "%~dp0az-gateway.exe.trial" >"%~dp0az-gateway.exe.trial" echo 0.0.0
set "FAILS=0"
exit /b 0

:trialcheck
if not exist "%~dp0az-gateway.exe.trial" set "FAILS=0"
if not exist "%~dp0az-gateway.exe.trial" exit /b 0
set /a FAILS+=1
if %FAILS% LSS 3 exit /b 0
set "FAILS=0"
if not exist "%~dp0az-gateway.exe.old" del /f /q "%~dp0az-gateway.exe.trial" >nul 2>&1
if not exist "%~dp0az-gateway.exe.old" exit /b 0
move /y "%~dp0az-gateway.exe" "%~dp0az-gateway.exe.bad" >nul 2>&1
move /y "%~dp0az-gateway.exe.old" "%~dp0az-gateway.exe" >nul 2>&1
move /y "%~dp0az-gateway.exe.trial" "%DATA%\update-failed.txt" >nul 2>&1
del /f /q "%~dp0az-gateway.exe.bad" >nul 2>&1
exit /b 0
