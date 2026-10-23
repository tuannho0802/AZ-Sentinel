@echo off
rem Quan ly token Gateway tren VPS: token.cmd issue|list|reset|revoke (khong tham so = in huong dan).
rem Dung cung server.env va thu muc du lieu voi tac vu "AZ Server". Can chay bang quyen Administrator
rem (co so du lieu nam trong %ProgramData%\AZSentinelServer, chi Administrators/SYSTEM ghi duoc).
set "AZ_ENV_FILE=%~dp0server.env"
set "NODE=node"
rem Windows 8.1 / Server 2012 R2: Node tu choi chay neu khong bo qua kiem tra nen tang.
set "NODE_SKIP_PLATFORM_CHECK=1"
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
"%NODE%" --disable-warning=ExperimentalWarning "%~dp0server.mjs" token %*
