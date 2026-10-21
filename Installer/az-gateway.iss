; Bo cai AZ Gateway cho Windows Server VPS. Build: ISCC /DMyAppVersion=0.2.0 Installer\az-gateway.iss
; Dau vao: Gateway\dist\az-gateway.exe (pnpm --filter @az-sentinel/gateway build:exe).
; Cai dat im lang: AZSentinel-Gateway-Setup.exe /VERYSILENT /VPS=VPS-01 /CLOUDURL=wss://... /TOKEN=...

#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif
#define MyAppName "AZ Gateway"
#define DataDir "{commonappdata}\AZSentinel"

[Setup]
AppId={{FB1FF701-0D99-4C8C-B35E-D67FE7B66ED3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=AZ Sentinel
DefaultDirName={autopf}\AZSentinel\Gateway
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\Gateway\dist
OutputBaseFilename=AZSentinel-Gateway-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=az-gateway.ico
UninstallDisplayIcon={app}\az-gateway.ico
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\Gateway\dist\az-gateway.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "run-gateway.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "az-gateway.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "scripts\*.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "ea\*.ex5"; DestDir: "{app}\ea"; Flags: ignoreversion skipifsourcedoesntexist

[INI]
Filename: "{app}\AZ Gateway.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://127.0.0.1:47800/"
Filename: "{app}\AZ Gateway.url"; Section: "InternetShortcut"; Key: "IconFile"; String: "{app}\az-gateway.ico"
Filename: "{app}\AZ Gateway.url"; Section: "InternetShortcut"; Key: "IconIndex"; String: "0"

[Icons]
; Hai shortcut mo giao dien chay start-gateway.ps1: Gateway dang chay thi chi mo trinh duyet; dang tat
; (bam "Tat hoan toan" tren giao dien) thi xin quyen Administrator, xoa co va bat lai. Giu ten cu de ban
; cai moi ghi de shortcut cu, khong sinh shortcut thua.
Name: "{autoprograms}\AZ Gateway\Mo giao dien AZ Gateway"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\start-gateway.ps1"""; IconFilename: "{app}\az-gateway.ico"; Comment: "Mo giao dien AZ Gateway, bat lai Gateway neu dang tat"; Flags: runminimized
Name: "{autoprograms}\AZ Gateway\Chep EA vao cac terminal"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-ea.ps1"" -Pause"; IconFilename: "{app}\az-gateway.ico"
Name: "{autodesktop}\AZ Gateway"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\scripts\start-gateway.ps1"""; IconFilename: "{app}\az-gateway.ico"; Comment: "Mo giao dien AZ Gateway, bat lai Gateway neu dang tat"; Flags: runminimized

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-task.ps1"" -AppDir ""{app}"""; Flags: runhidden waituntilterminated; StatusMsg: "Dang ky tac vu tu khoi dong..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-ea.ps1"" -LogFile ""{app}\install-ea.log"""; Flags: runhidden waituntilterminated; StatusMsg: "Tim terminal MT5 va chep EA..."
Filename: "{app}\AZ Gateway.url"; Description: "Mo giao dien AZ Gateway"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-task.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveTask"

[Code]
var
  CfgPage: TInputQueryWizardPage;
  { Da co ban cai truoc (nang cap) hay cai moi: cai moi thi xoa co "da tat" con sot. }
  WasInstalled: Boolean;

function ConfigPath: String;
begin
  Result := ExpandConstant('{#DataDir}\config.json');
end;

function JsonEscape(const S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

procedure InitializeWizard;
begin
  CfgPage := CreateInputQueryPage(wpSelectDir, 'Ket noi cloud',
    'Thong tin de Gateway gui du lieu len he thong AZ Sentinel',
    'Co the de trong Cloud URL va token de chay cuc bo truoc, cau hinh sau tren giao dien web cua Gateway.');
  CfgPage.Add('Ten VPS (hien tren web):', False);
  CfgPage.Add('Cloud URL (vi du wss://ten.workers.dev/api/gw/ws):', False);
  CfgPage.Add('Token ket noi (GW_CONNECT_TOKEN):', True);
  CfgPage.Values[0] := ExpandConstant('{param:VPS|{computername}}');
  CfgPage.Values[1] := ExpandConstant('{param:CLOUDURL|}');
  CfgPage.Values[2] := ExpandConstant('{param:TOKEN|}');
end;

{ Nang cap: da co config.json thi khong hoi lai (giu nguyen), tru khi truyen /CLOUDURL=... }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (PageID = CfgPage.ID) and FileExists(ConfigPath) and (ExpandConstant('{param:CLOUDURL|}') = '') then
    Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Url: String;
begin
  Result := True;
  if CurPageID = CfgPage.ID then
  begin
    Url := Trim(CfgPage.Values[1]);
    if (Url <> '') and (Pos('wss://', Lowercase(Url)) <> 1) and (Pos('ws://', Lowercase(Url)) <> 1) then
    begin
      MsgBox('Cloud URL phai bat dau bang wss:// (hoac ws://).', mbError, MB_OK);
      Result := False;
    end
    else if Trim(CfgPage.Values[0]) = '' then
    begin
      MsgBox('Hay nhap ten VPS.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Dung ban dang chay truoc khi ghi de file (cap nhat tai cho). Dung tac vu truoc, roi moi diet exe. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  RC: Integer;
begin
  WasInstalled := FileExists(ExpandConstant('{app}\az-gateway.exe'));
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "AZ Gateway"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM az-gateway.exe', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Sleep(800);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Json: String;
  RC: Integer;
begin
  if CurStep = ssInstall then
  begin
    ForceDirectories(ExpandConstant('{#DataDir}'));
    { Cai moi (khong phai nang cap) thi xoa co disabled.flag con sot tu lan go truoc, de Gateway tu chay.
      Nang cap thi giu: nguoi dung da tat thi van tat cho den khi bam shortcut. }
    if not WasInstalled then DeleteFile(ExpandConstant('{#DataDir}\disabled.flag'));
    if (not FileExists(ConfigPath)) or (ExpandConstant('{param:CLOUDURL|}') <> '') then
    begin
      Json := '{' + #13#10 +
        '  "vps": "' + JsonEscape(Trim(CfgPage.Values[0])) + '",' + #13#10 +
        '  "cloudUrl": "' + JsonEscape(Trim(CfgPage.Values[1])) + '",' + #13#10 +
        '  "cloudToken": "' + JsonEscape(Trim(CfgPage.Values[2])) + '"' + #13#10 + '}' + #13#10;
      SaveStringToFile(ConfigPath, Json, False);
    end;
    { Token nam trong config.json: chi Administrators va SYSTEM duoc doc. }
    Exec(ExpandConstant('{sys}\icacls.exe'),
      ExpandConstant('"{#DataDir}" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F'),
      '', SW_HIDE, ewWaitUntilTerminated, RC);
  end;
end;
