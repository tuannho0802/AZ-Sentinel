; Bo cai AZ Server (may chu chinh tren VPS Windows): gom Server (Node + BE) va giao dien web (FE/dist) trong mot file.
; Build: pnpm pack:server, chep node.exe vao Server\release\az-server, roi
;   ISCC /DMyAppVersion=0.1.0 Installer\az-server.iss      (CI: .github/workflows/release-server.yml lam het)
; Dau vao: Server\release\az-server\ (server.mjs, node.exe, migrations\, web\, *.ps1, *.cmd, server.env.example).
; Cai dat im lang:
;   AZSentinel-Server-Setup.exe /VERYSILENT /NAME=VPS-MAIN /PORT=8080 /CLOUDURL=https://... /FALLBACKURL=https://... /PUBLICURL=https://... /SYNCTOKEN=...
;       [/LAN=1] [/FIREWALL=1] [/RECONFIGURE=1]
; Khong co /RECONFIGURE thi server.env cu duoc giu nguyen (nang cap khong hoi lai).
; Token Gateway KHONG dat o day: moi nguoi mot token azt_... do quan tri vien cap (token.cmd hoac trang /tokens).

#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif
#define MyAppName "AZ Server"
#define DataDir "{commonappdata}\AZSentinelServer"
#define Src "..\Server\release\az-server"

[Setup]
AppId={{5068C4E5-579B-4E6A-9A4C-62E34230E79D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=AZ Sentinel
DefaultDirName={autopf}\AZSentinel\Server
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\Server\release
OutputBaseFilename=AZSentinel-Server-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=az-gateway.ico
UninstallDisplayIcon={app}\az-sentinel.ico
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
; Ban build cu (ten file giao dien co ma bam) khong duoc de lai khi nang cap.
Type: filesandordirs; Name: "{app}\web"
Type: filesandordirs; Name: "{app}\migrations"

[Files]
Source: "{#Src}\*"; DestDir: "{app}"; Excludes: "server.env"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "az-gateway.ico"; DestDir: "{app}"; DestName: "az-sentinel.ico"; Flags: ignoreversion
; Dung ban cu truoc khi ghi de: chay tu thu muc tam vi thu muc cai dang bi khoa.
Source: "{#Src}\stop-server.ps1"; Flags: dontcopy

[INI]
Filename: "{app}\AZ Server.url"; Section: "InternetShortcut"; Key: "URL"; String: "{code:ServerUrl}"
Filename: "{app}\AZ Server.url"; Section: "InternetShortcut"; Key: "IconFile"; String: "{app}\az-sentinel.ico"
Filename: "{app}\AZ Server.url"; Section: "InternetShortcut"; Key: "IconIndex"; String: "0"

[Icons]
Name: "{autoprograms}\AZ Server\Mo giao dien AZ Sentinel"; Filename: "{app}\AZ Server.url"; IconFilename: "{app}\az-sentinel.ico"
Name: "{autoprograms}\AZ Server\Quan ly token Gateway"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\token-shell.ps1"" -AppDir ""{app}"""; IconFilename: "{app}\az-sentinel.ico"; Comment: "Cap, dat lai, thu hoi token Gateway ca nhan (can quyen Administrator)"
Name: "{autoprograms}\AZ Server\Xem log AZ Server"; Filename: "{win}\explorer.exe"; Parameters: """{#DataDir}\logs"""
Name: "{autodesktop}\AZ Sentinel"; Filename: "{app}\AZ Server.url"; IconFilename: "{app}\az-sentinel.ico"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-task.ps1"" -AppDir ""{app}"""; Flags: runhidden waituntilterminated; StatusMsg: "Dang ky tac vu tu khoi dong..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\open-firewall.ps1"" -Port {code:ServerPort}"; Flags: runhidden waituntilterminated; Check: WantFirewall; StatusMsg: "Mo cong tuong lua..."
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\check-server.ps1"" -Port {code:ServerPort}"; Flags: waituntilterminated skipifsilent; StatusMsg: "Dang cho AZ Server khoi dong..."
Filename: "{app}\AZ Server.url"; Description: "Mo giao dien AZ Sentinel"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-task.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveTask"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\open-firewall.ps1"" -Remove"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewall"

[Code]
var
  SrvPage: TInputQueryWizardPage;
  NetPage: TInputOptionWizardPage;
  AdmPage: TInputQueryWizardPage;

function EnvPath: String;
begin
  Result := ExpandConstant('{app}\server.env');
end;

{ Cai moi, hoac chay lai voi /RECONFIGURE=1: ghi lai server.env. Con lai giu nguyen (nang cap khong hoi lai). }
function WillWriteEnv: Boolean;
begin
  Result := (not FileExists(EnvPath)) or (ExpandConstant('{param:RECONFIGURE|}') <> '');
end;

{ Nang cap giu server.env cu: lay cong tu do (neu khong thi shortcut va buoc kiem tra se tro sai cong). }
function PortFromEnvFile: Integer;
var
  Raw: AnsiString;
  Text: String;
  P, E: Integer;
begin
  Result := 0;
  if not LoadStringFromFile(EnvPath, Raw) then Exit;
  Text := #10 + String(Raw);
  P := Pos(#10 + 'AZ_PORT=', Text);
  if P = 0 then Exit;
  Text := Copy(Text, P + 9, MaxInt);
  E := Pos(#13, Text);
  if E = 0 then E := Pos(#10, Text);
  if E > 0 then Text := Copy(Text, 1, E - 1);
  Result := StrToIntDef(Trim(Text), 0);
end;

function PortValue: Integer;
begin
  Result := 0;
  if not WillWriteEnv then Result := PortFromEnvFile;
  if Result = 0 then Result := StrToIntDef(Trim(SrvPage.Values[2]), 8080);
end;

function ServerPort(Param: String): String;
begin
  Result := IntToStr(PortValue);
end;

function ServerUrl(Param: String): String;
begin
  Result := 'http://127.0.0.1:' + IntToStr(PortValue) + '/';
end;

function WantLan: Boolean;
begin
  Result := NetPage.Values[0] or (ExpandConstant('{param:LAN|}') = '1');
end;

function WantFirewall: Boolean;
begin
  Result := WantLan and (NetPage.Values[1] or (ExpandConstant('{param:FIREWALL|}') = '1'));
end;

function IsHttpUrl(const U: String): Boolean;
begin
  Result := (Pos('https://', Lowercase(U)) = 1) or (Pos('http://', Lowercase(U)) = 1);
end;

procedure InitializeWizard;
begin
  SrvPage := CreateInputQueryPage(wpSelectDir, 'Cau hinh AZ Server',
    'May chu chinh tren VPS: phuc vu giao dien web va nhan du lieu tu Gateway',
    'Cloud URL va dong bo la tuy chon: de trong thi Server chay mot minh, khong co ban du phong tren Cloudflare. ' +
    'Co the sua sau trong server.env (thu muc cai).');
  SrvPage.Add('Ten may chu (hien tren web):', False);
  SrvPage.Add('Vi tri (tuy chon, vi du Singapore):', False);
  SrvPage.Add('Cong HTTP:', False);
  SrvPage.Add('Dia chi Worker API du phong (https://...workers.dev, tuy chon):', False);
  SrvPage.Add('URL web du phong cho nguoi dung (https://..., tuy chon):', False);
  SrvPage.Add('Bi mat dong bo SYNC_TOKEN (>= 32 ky tu, trung voi Worker, tuy chon):', True);
  SrvPage.Add('URL cong khai cua VPS nay (https://..., de tao ma ket noi Gateway, tuy chon):', False);
  SrvPage.Values[0] := ExpandConstant('{param:NAME|{computername}}');
  SrvPage.Values[1] := ExpandConstant('{param:LOCATION|}');
  SrvPage.Values[2] := ExpandConstant('{param:PORT|8080}');
  SrvPage.Values[3] := ExpandConstant('{param:CLOUDURL|}');
  SrvPage.Values[4] := ExpandConstant('{param:FALLBACKURL|}');
  SrvPage.Values[5] := ExpandConstant('{param:SYNCTOKEN|}');
  SrvPage.Values[6] := ExpandConstant('{param:PUBLICURL|}');

  NetPage := CreateInputOptionPage(SrvPage.ID, 'Truy cap tu may khac',
    'Mac dinh Server chi nghe 127.0.0.1 (di qua Cloudflare Tunnel hoac reverse proxy)',
    'Chi bat neu muon may khac trong mang noi bo vao thang http://<ip-vps>:cong/ . ' +
    'Token Gateway ca nhan do quan tri vien cap, khong dat o buoc nay.',
    False, False);
  NetPage.Add('Cho phep may khac trong mang noi bo truy cap (AZ_HOST=0.0.0.0)');
  NetPage.Add('Mo cong nay tren Windows Firewall (chi mang Private/Domain)');
  NetPage.Values[0] := ExpandConstant('{param:LAN|}') = '1';
  NetPage.Values[1] := ExpandConstant('{param:FIREWALL|}') = '1';

  AdmPage := CreateInputQueryPage(NetPage.ID, 'Tai khoan quan tri dau tien',
    'Dung tai khoan nay de dang nhap web sau khi cai xong',
    'Dien du thong tin de bo cai tao luon quan tri vien goc. De trong email thi bo qua; ' +
    'khi do tao sau bang shortcut hoac user.cmd create-admin.');
  AdmPage.Add('Email dang nhap:', False);
  AdmPage.Add('Ten hien thi:', False);
  AdmPage.Add('Mat khau (toi thieu 10 ky tu):', True);
  AdmPage.Add('Nhap lai mat khau:', True);
  AdmPage.Values[0] := ExpandConstant('{param:ADMINEMAIL|}');
  AdmPage.Values[1] := ExpandConstant('{param:ADMINNAME|}');
  AdmPage.Values[2] := ExpandConstant('{param:ADMINPASSWORD|}');
  AdmPage.Values[3] := ExpandConstant('{param:ADMINPASSWORD|}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if ((PageID = SrvPage.ID) or (PageID = NetPage.ID) or (PageID = AdmPage.ID)) and (not WillWriteEnv) then Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Port: Integer;
  Cloud, Fb, Sync: String;
begin
  Result := True;
  if CurPageID = NetPage.ID then
  begin
    { Firewall chi co nghia khi mo cho LAN. }
    if (not NetPage.Values[0]) then NetPage.Values[1] := False;
    Exit;
  end;
  if CurPageID = AdmPage.ID then
  begin
    if Trim(AdmPage.Values[0]) = '' then Exit; { bo qua: tao admin sau }
    if (Pos('@', AdmPage.Values[0]) < 2) or (Pos('.', AdmPage.Values[0]) = 0) or (Pos(' ', Trim(AdmPage.Values[0])) > 0) then
    begin
      MsgBox('Email khong hop le.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Trim(AdmPage.Values[1]) = '' then
    begin
      MsgBox('Hay nhap ten hien thi.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (Length(AdmPage.Values[2]) < 10) or (Length(AdmPage.Values[2]) > 128) then
    begin
      MsgBox('Mat khau phai tu 10 den 128 ky tu.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if AdmPage.Values[2] <> AdmPage.Values[3] then
    begin
      MsgBox('Hai lan nhap mat khau khong khop.', mbError, MB_OK);
      Result := False;
    end;
    Exit;
  end;
  if CurPageID <> SrvPage.ID then Exit;
  Cloud := Trim(SrvPage.Values[3]);
  Fb := Trim(SrvPage.Values[4]);
  Sync := Trim(SrvPage.Values[5]);
  Port := StrToIntDef(Trim(SrvPage.Values[2]), 0);

  if Trim(SrvPage.Values[0]) = '' then
  begin
    MsgBox('Hay nhap ten may chu.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Port < 1) or (Port > 65535) then
  begin
    MsgBox('Cong HTTP phai la so tu 1 den 65535.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Cloud <> '') and (not IsHttpUrl(Cloud)) then
  begin
    MsgBox('Dia chi Worker API phai bat dau bang https:// (hoac http://).', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Trim(SrvPage.Values[6]) <> '') and (not IsHttpUrl(Trim(SrvPage.Values[6]))) then
  begin
    MsgBox('URL cong khai cua VPS phai bat dau bang https:// (hoac http://).', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Fb <> '') and (not IsHttpUrl(Fb)) then
  begin
    MsgBox('URL web du phong phai bat dau bang https:// (hoac http://).', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Sync <> '') and (Length(Sync) < 32) then
  begin
    MsgBox('SYNC_TOKEN phai dai it nhat 32 ky tu (trung voi SYNC_TOKEN cua Worker).', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Cloud <> '') and (Sync = '') then
  begin
    if MsgBox('Co dia chi Worker nhung chua co SYNC_TOKEN: dong bo sang Cloudflare se bi tat.' + #13#10 +
              'Tiep tuc cai dat?', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

{ Dung ban dang chay truoc khi ghi de file (nang cap tai cho). }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  RC: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\server.mjs')) then
  begin
    ExtractTemporaryFile('stop-server.ps1');
    Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\stop-server.ps1') + '" -AppDir "' +
      ExpandConstant('{app}') + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  end;
end;

procedure WriteEnvFile;
var
  Host: String;
  Env: String;
begin
  if WantLan then Host := '0.0.0.0' else Host := '127.0.0.1';
  Env :=
    '# AZ Sentinel Server - tao boi bo cai. Xem them cac tuy chon trong server.env.example cung thu muc.' + #13#10 +
    'AZ_PORT=' + IntToStr(PortValue) + #13#10 +
    'AZ_HOST=' + Host + #13#10 +
    'AZ_SRV_NAME=' + Trim(SrvPage.Values[0]) + #13#10 +
    'AZ_SRV_LOCATION=' + Trim(SrvPage.Values[1]) + #13#10 +
    '# Token Gateway la token ca nhan azt_... do quan tri vien cap (token.cmd), khong dat trong tep nay.' + #13#10 +
    'AZ_SYNC_TOKEN=' + Trim(SrvPage.Values[5]) + #13#10 +
    'AZ_CLOUD_URL=' + Trim(SrvPage.Values[3]) + #13#10 +
    'AZ_FALLBACK_URL=' + Trim(SrvPage.Values[4]) + #13#10 +
    'AZ_PUBLIC_URL=' + Trim(SrvPage.Values[6]) + #13#10;
  SaveStringToFile(EnvPath, Env, False);
end;

{ Tao quan tri vien goc bang user.cmd (mat khau qua tep tam doc stdin, khong nam tren dong lenh). }
procedure CreateAdmin;
var
  RC: Integer;
  Tmp, Cmd: String;
begin
  if Trim(AdmPage.Values[0]) = '' then Exit;
  Tmp := ExpandConstant('{tmp}\azadm.txt');
  SaveStringToFile(Tmp, AdmPage.Values[2] + #13#10, False);
  Cmd := '/S /C ""' + ExpandConstant('{app}\user.cmd') + '" create-admin "' + Trim(AdmPage.Values[0]) +
    '" "' + Trim(AdmPage.Values[1]) + '" --password-stdin < "' + Tmp + '""';
  if (not Exec(ExpandConstant('{cmd}'), Cmd, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, RC)) or (RC <> 0) then
    SuppressibleMsgBox('Khong tao duoc tai khoan quan tri (ma ' + IntToStr(RC) + '). ' +
      'Sau khi cai xong, mo PowerShell Administrator trong thu muc cai va chay: user.cmd create-admin <email> <ten>',
      mbError, MB_OK, IDOK);
  DeleteFile(Tmp);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  RC: Integer;
begin
  if CurStep = ssInstall then
  begin
    ForceDirectories(ExpandConstant('{#DataDir}\logs'));
    { Co so du lieu (co ma bam token) va nhat ky: chi Administrators va SYSTEM. }
    Exec(ExpandConstant('{sys}\icacls.exe'),
      ExpandConstant('"{#DataDir}" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F'),
      '', SW_HIDE, ewWaitUntilTerminated, RC);
  end;
  if CurStep = ssPostInstall then
  begin
    if WillWriteEnv then WriteEnvFile;
    { server.env co SYNC_TOKEN: chi Administrators va SYSTEM duoc doc (thu muc Program Files cho Users doc). }
    Exec(ExpandConstant('{sys}\icacls.exe'),
      '"' + EnvPath + '" /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F', '', SW_HIDE, ewWaitUntilTerminated, RC);
    if WillWriteEnv then CreateAdmin;
  end;
end;
