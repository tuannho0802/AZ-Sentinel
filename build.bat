@echo off
REM Chay file nay tren MAY LOCAL (Windows, da cai Python 3.12 64-bit).
REM Ket qua: dist\az-spike\  va  az-spike.zip  (copy file zip len VPS)
setlocal
cd /d "%~dp0"

if not exist venv (
    py -3.12 -m venv venv || goto :err
)
call venv\Scripts\activate.bat || goto :err
python -m pip install --upgrade pip || goto :err
pip install MetaTrader5 psutil pyinstaller || goto :err

REM onedir (khong phai onefile): khong giai nen vao %TEMP% moi lan chay,
REM quan trong vi chuong trinh sinh nhieu worker.
pyinstaller --noconfirm --clean --onedir --console ^
    --name az-spike ^
    --collect-all MetaTrader5 ^
    spike.py || goto :err

if exist az-spike.zip del az-spike.zip
powershell -NoProfile -Command "Compress-Archive -Path 'dist\az-spike\*' -DestinationPath 'az-spike.zip'" || goto :err

echo.
echo XONG. Thu muc: dist\az-spike\az-spike.exe
echo Goi len VPS: az-spike.zip
dir az-spike.zip | find "az-spike.zip"
exit /b 0

:err
echo.
echo LOI - xem thong bao phia tren.
exit /b 1
