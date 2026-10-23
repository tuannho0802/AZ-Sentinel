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
DisableDirPage=yes
DisableReadyPage=yes
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
; Bo cai Gateway (neu CI da build) de cai luon tren VPS chinh; chi duoc chay khi nguoi dung tick o "Cai luon AZ Gateway".
Source: "..\Gateway\dist\AZSentinel-Gateway-Setup.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall skipifsourcedoesntexist
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
  ModePage: TInputOptionWizardPage;
  FreshInstall: Boolean;
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

{ Cài nhanh (mặc định) chỉ hỏi tài khoản quản trị; các ô kỹ thuật chỉ hiện khi chọn Tùy chỉnh nâng cao. }
function WantAdvanced: Boolean;
begin
  Result := ModePage.Values[1] or (ExpandConstant('{param:ADVANCED|}') = '1');
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

{ Windows 8.1 / Server 2012 R2: Node (trong az-gateway.exe, node.exe) tu choi chay neu khong bo qua kiem tra nen tang.
  Dat bien nay cho tien trinh bo cai de moi lenh con (check-code, check-token...) chay duoc; cac tac vu tu chay
  dat lai trong run-*.cmd. }
function SetEnvironmentVariableW(Name, Value: String): Boolean; external 'SetEnvironmentVariableW@kernel32.dll stdcall';

procedure InitializeWizard;
begin
  SetEnvironmentVariableW('NODE_SKIP_PLATFORM_CHECK', '1');
  FreshInstall := WillWriteEnv;
  ModePage := CreateInputOptionPage(wpWelcome, 'Chọn cách cài đặt',
    'Bạn muốn cài AZ Server theo cách nào?',
    'Nếu chưa chắc, cứ chọn "Cài nhanh": chỉ cần tạo tài khoản quản trị, mọi thứ còn lại bộ cài tự lo. ' +
    'Có thể đổi các thiết lập nâng cao sau trong tệp server.env.',
    True, False);
  ModePage.Add('Cài nhanh (khuyên dùng): tạo tài khoản quản trị, tự cài luôn AZ Gateway trên máy này.');
  ModePage.Add('Tùy chỉnh nâng cao: tên máy chủ, cổng, địa chỉ công khai (Cloudflare Tunnel), dự phòng Cloudflare, mạng nội bộ.');
  ModePage.Values[0] := True;

  AdmPage := CreateInputQueryPage(ModePage.ID, 'Tài khoản quản trị',
    'Dùng tài khoản này để đăng nhập web sau khi cài xong',
    'Điền email, tên và mật khẩu (tối thiểu 10 ký tự). Đây là tài khoản quản trị gốc, giữ mật khẩu cẩn thận.');
  AdmPage.Add('Email đăng nhập:', False);
  AdmPage.Add('Tên hiển thị:', False);
  AdmPage.Add('Mật khẩu (tối thiểu 10 ký tự):', True);
  AdmPage.Add('Nhập lại mật khẩu:', True);
  AdmPage.Values[0] := ExpandConstant('{param:ADMINEMAIL|}');
  AdmPage.Values[1] := ExpandConstant('{param:ADMINNAME|}');
  AdmPage.Values[2] := ExpandConstant('{param:ADMINPASSWORD|}');
  AdmPage.Values[3] := ExpandConstant('{param:ADMINPASSWORD|}');

  SrvPage := CreateInputQueryPage(AdmPage.ID, 'Cau hinh AZ Server',
    'May chu chinh tren VPS: phuc vu giao dien web va nhan du lieu tu Gateway',
    'Chỉ dành cho người đã quen Cloudflare. Cloud URL và đồng bộ là tùy chọn: để trống thì Server chạy một mình, không có bản dự phòng. ' +
    'Có thể sửa sau trong server.env (thư mục cài).');
  SrvPage.Add('Ten may chu (hien tren web):', False);
  SrvPage.Add('Vi tri (tuy chon, vi du Singapore):', False);
  SrvPage.Add('Cong HTTP:', False);
  SrvPage.Add('Dia chi Worker API du phong (https://...workers.dev, tuy chon):', False);
  SrvPage.Add('URL web du phong cho nguoi dung (https://..., tuy chon):', False);
  SrvPage.Add('Bi mat dong bo SYNC_TOKEN (>= 32 ky tu, trung voi Worker, tuy chon):', True);
  SrvPage.Add('URL cong khai cua VPS nay (https://..., de tao ma ket noi Gateway, tuy chon):', False);
  SrvPage.Add('Token Cloudflare Tunnel (tuy chon, bo cai tu cai cloudflared de VPS co HTTPS cong khai):', True);
  SrvPage.Add('IP duoc phep truy cap (cach nhau dau phay, tuy chon; co dien thi chi cac IP nay moi vao duoc - nho them IP cua ban):', False);
  SrvPage.Values[0] := ExpandConstant('{param:NAME|{computername}}');
  SrvPage.Values[1] := ExpandConstant('{param:LOCATION|}');
  SrvPage.Values[2] := ExpandConstant('{param:PORT|8080}');
  SrvPage.Values[3] := ExpandConstant('{param:CLOUDURL|}');
  SrvPage.Values[4] := ExpandConstant('{param:FALLBACKURL|}');
  SrvPage.Values[5] := ExpandConstant('{param:SYNCTOKEN|}');
  SrvPage.Values[6] := ExpandConstant('{param:PUBLICURL|}');
  SrvPage.Values[7] := ExpandConstant('{param:TUNNELTOKEN|}');
  SrvPage.Values[8] := ExpandConstant('{param:IPS|}');

  NetPage := CreateInputOptionPage(SrvPage.ID, 'Truy cap tu may khac',
    'Mac dinh Server chi nghe 127.0.0.1 (di qua Cloudflare Tunnel hoac reverse proxy)',
    'Chi bat neu muon may khac trong mang noi bo vao thang http://<ip-vps>:cong/ . ' +
    'Token Gateway ca nhan do quan tri vien cap, khong dat o buoc nay.',
    False, False);
  NetPage.Add('Cho phep may khac trong mang noi bo truy cap (AZ_HOST=0.0.0.0)');
  NetPage.Add('Mo cong nay tren Windows Firewall (chi mang Private/Domain)');
  NetPage.Add('Cai luon AZ Gateway tren VPS nay (can tai khoan quan tri o buoc sau)');
  NetPage.Values[0] := ExpandConstant('{param:LAN|}') = '1';
  NetPage.Values[1] := ExpandConstant('{param:FIREWALL|}') = '1';
  NetPage.Values[2] := ExpandConstant('{param:GATEWAY|1}') <> '0';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if ((PageID = ModePage.ID) or (PageID = AdmPage.ID)) and (not WillWriteEnv) then Result := True;
  if ((PageID = SrvPage.ID) or (PageID = NetPage.ID)) and ((not WillWriteEnv) or (not WantAdvanced)) then Result := True;
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
    if Trim(AdmPage.Values[0]) = '' then
    begin
      MsgBox('Hãy nhập email để tạo tài khoản quản trị. Không có tài khoản này bạn sẽ không đăng nhập được.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (Pos('@', AdmPage.Values[0]) < 2) or (Pos('.', AdmPage.Values[0]) = 0) or (Pos(' ', Trim(AdmPage.Values[0])) > 0) then
    begin
      MsgBox('Email không hợp lệ.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if Trim(AdmPage.Values[1]) = '' then
    begin
      MsgBox('Hãy nhập tên hiển thị.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (Length(AdmPage.Values[2]) < 10) or (Length(AdmPage.Values[2]) > 128) then
    begin
      MsgBox('Mật khẩu phải từ 10 đến 128 ký tự.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if AdmPage.Values[2] <> AdmPage.Values[3] then
    begin
      MsgBox('Hai lần nhập mật khẩu không khớp.', mbError, MB_OK);
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
  { Plug and play (Plan 3H): co Worker + SYNC_TOKEN, khong co URL cong khai/token tunnel co ten -> tu bat Quick Tunnel
    (khong can ten mien); Gateway tu tim tunnel moi qua Worker, khong ai phai lam gi khi VPS reset. }
  if (Trim(SrvPage.Values[3]) <> '') and (Length(Trim(SrvPage.Values[5])) >= 32) and
     (Trim(SrvPage.Values[6]) = '') and (Trim(SrvPage.Values[7]) = '') then
    Env := Env + 'AZ_QUICK_TUNNEL=1' + #13#10;
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

{ Cai cloudflared thanh dich vu Windows tu token tunnel (tao o Cloudflare Zero Trust, hostname -> http://localhost:cong). }
procedure SetupTunnel;
var
  RC: Integer;
begin
  if Trim(SrvPage.Values[7]) = '' then Exit;
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\setup-tunnel.ps1') + '" -AppDir "' +
    ExpandConstant('{app}') + '" -TunnelToken "' + Trim(SrvPage.Values[7]) + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
end;

{ Cai luon Gateway cho Admin: cap token cho admin (id 1), cai im lang Gateway noi thang vao Server qua loopback,
  Worker dung lam du phong. Bo qua im lang neu thieu bo cai Gateway hoac khong cap duoc token. }
procedure InstallAdminGateway;
var
  RC: Integer;
  Setup, Tmp, Tok, Fb, Args: String;
  S: AnsiString;
  P: Integer;
begin
  if not NetPage.Values[2] then Exit;
  if Trim(AdmPage.Values[0]) = '' then Exit;
  Setup := ExpandConstant('{tmp}\AZSentinel-Gateway-Setup.exe');
  if not FileExists(Setup) then Exit;
  Tmp := ExpandConstant('{tmp}\azgwtok.txt');
  Exec(ExpandConstant('{cmd}'), '/S /C ""' + ExpandConstant('{app}\token.cmd') + '" issue 1 "Admin" > "' + Tmp + '""',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, RC);
  if not LoadStringFromFile(Tmp, S) then Exit;
  DeleteFile(Tmp);
  P := Pos('azt_', S);
  if P = 0 then Exit;
  Tok := Copy(S, P, 36);
  Fb := Trim(SrvPage.Values[3]);
  if Fb <> '' then
  begin
    StringChangeEx(Fb, 'https://', 'wss://', True);
    StringChangeEx(Fb, 'http://', 'ws://', True);
    if Copy(Fb, Length(Fb), 1) = '/' then Delete(Fb, Length(Fb), 1);
    Fb := Fb + '/api/gw/ws';
  end;
  Args := '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /VPS="' + Trim(SrvPage.Values[0]) + '" /CLOUDURL=ws://127.0.0.1:' +
    IntToStr(PortValue) + '/api/gw/ws /TOKEN=' + Tok + ' /SKIPTOKENCHECK=1';
  if Fb <> '' then Args := Args + ' /FALLBACKURL=' + Fb;
  Exec(Setup, Args, '', SW_HIDE, ewWaitUntilTerminated, RC);
end;

{ Nap whitelist IP ban dau (neu co dien) roi bat che do "chi IP trong danh sach". Danh sach nam trong co so du
  lieu cua Server nen con nguyen khi VPS khoi dong lai; chinh sua tiep tren web (muc Whitelist IP) hoac ip.cmd. }
procedure SeedWhitelist;
var
  RC, P: Integer;
  List, One: String;
begin
  List := Trim(SrvPage.Values[8]);
  if List = '' then Exit;
  while List <> '' do
  begin
    P := Pos(',', List);
    if P = 0 then
    begin
      One := Trim(List);
      List := '';
    end
    else
    begin
      One := Trim(Copy(List, 1, P - 1));
      Delete(List, 1, P);
    end;
    if One <> '' then
      Exec(ExpandConstant('{cmd}'), '/S /C ""' + ExpandConstant('{app}\ip.cmd') + '" add "' + One + '" "Bo cai""',
        ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, RC);
  end;
  Exec(ExpandConstant('{cmd}'), '/S /C ""' + ExpandConstant('{app}\ip.cmd') + '" on"',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, RC);
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
    if WillWriteEnv then
    begin
      CreateAdmin;
      SetupTunnel;
      InstallAdminGateway;
      SeedWhitelist;
    end;
  end;
end;

{ Trang kết thúc: nói rõ địa chỉ và tài khoản để người dùng không phải đoán bước tiếp theo. }
procedure CurPageChanged(CurPageID: Integer);
var
  Text: String;
begin
  if (CurPageID = wpFinished) and FreshInstall and (not WizardSilent) then
  begin
    Text := 'AZ Sentinel đã sẵn sàng và tự chạy mỗi khi máy khởi động.' + #13#10#13#10 +
      'Địa chỉ: http://127.0.0.1:' + IntToStr(PortValue) + '/' + #13#10 +
      'Đăng nhập bằng: ' + Trim(AdmPage.Values[0]) + #13#10#13#10 +
      'Bước tiếp theo: đăng nhập, mở mục Bắt đầu nhanh trên trang Tổng quan, cấp mã kết nối cho người dùng rồi bấm "Sao chép lời mời" để gửi cho họ.';
    WizardForm.FinishedLabel.Caption := Text;
  end;
end;
