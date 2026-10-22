; Bo cai AZ Gateway cho Windows Server VPS. Build: ISCC /DMyAppVersion=0.2.0 Installer\az-gateway.iss
; Dau vao: Gateway\dist\az-gateway.exe (pnpm --filter @az-sentinel/gateway build:exe).
; Cai dat don gian nhat: dan "ma ket noi" azc1... (do quan tri vien gui) vao trang Ket noi cloud, hoac im lang:
;   AZSentinel-Gateway-Setup.exe /VERYSILENT /VPS=VPS-01 /CODE=azc1.... [/SKIPTOKENCHECK=1]
; Cai dat im lang (cach cu): AZSentinel-Gateway-Setup.exe /VERYSILENT /VPS=VPS-01 /CLOUDURL=wss://... /TOKEN=azt_... [/FALLBACKURL=wss://...] [/SKIPTOKENCHECK=1]
; TOKEN la token ca nhan azt_... do quan tri vien cap rieng cho tung nguoi (khong con khoa chung dung chung cho moi nguoi).
; Bo cai goi "az-gateway.exe check-token <url> <token>" (GET /api/gw/check) de kiem token: 401 thi dung cai.

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
; Ban tam de kiem token ngay tren trang nhap (cung noi dung voi dong tren, Inno chi luu mot ban).
Source: "..\Gateway\dist\az-gateway.exe"; Flags: dontcopy
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
  { Nang cap tu ban dung khoa chung cu: config con token khong phai azt_..., phai nhap token ca nhan. }
  MigrateMode: Boolean;

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

function ReadConfig: String;
var
  Raw: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(ConfigPath, Raw) then Result := String(Raw);
end;

{ Doc gia tri chuoi cua mot khoa trong config.json (ghi theo dang "khoa": "gia tri"). Khong xu ly ky tu thoat. }
function JsonGetString(const Json, Key: String): String;
var
  P, Q: Integer;
  Rest: String;
begin
  Result := '';
  P := Pos('"' + Key + '": "', Json);
  if P = 0 then Exit;
  Rest := Copy(Json, P + Length(Key) + 5, MaxInt);
  Q := Pos('"', Rest);
  if Q = 0 then Exit;
  Result := Copy(Rest, 1, Q - 1);
end;

{ Khop Shared/src/token-schema.ts (looksLikeGwToken): azt_ + ky tu A-Z a-z 0-9 _ -, dai 20..128. }
function IsTokenShape(const T: String): Boolean;
var
  I: Integer;
  C: Char;
begin
  Result := False;
  if (Length(T) < 20) or (Length(T) > 128) then Exit;
  if Copy(T, 1, 4) <> 'azt_' then Exit;
  for I := 1 to Length(T) do
  begin
    C := T[I];
    if not (((C >= 'a') and (C <= 'z')) or ((C >= 'A') and (C <= 'Z')) or
            ((C >= '0') and (C <= '9')) or (C = '_') or (C = '-')) then Exit;
  end;
  Result := True;
end;

function IsWsUrl(const U: String): Boolean;
begin
  Result := ((Pos('wss://', Lowercase(U)) = 1) or (Pos('ws://', Lowercase(U)) = 1)) and (Pos('"', U) = 0);
end;

function SkipTokenCheck: Boolean;
begin
  Result := ExpandConstant('{param:SKIPTOKENCHECK|}') <> '';
end;

{ Cai moi, hoac chay lai voi /CLOUDURL=...: ghi lai toan bo config.json. }
function WillWriteFresh: Boolean;
begin
  Result := (not FileExists(ConfigPath)) or (ExpandConstant('{param:CLOUDURL|}') <> '');
end;

{ Co config.json noi cloud ma token thieu hoac con la khoa chung cu (khong phai azt_...). }
function NeedsTokenMigration: Boolean;
var
  Json: String;
begin
  Result := False;
  if WillWriteFresh then Exit;
  Json := ReadConfig;
  if JsonGetString(Json, 'cloudUrl') = '' then Exit;
  Result := not IsTokenShape(JsonGetString(Json, 'cloudToken'));
end;

{ Chay "az-gateway.exe check-token <url> <token>". Tra ma thoat: 0 hop le, 1 bi tu choi, 2 khong hoi duoc cloud,
  3 dau vao sai; -1 neu khong chay duoc exe (khi do coi nhu chua ket luan). }
function CheckTokenOnline(const Url, Tok: String): Integer;
var
  RC: Integer;
begin
  Result := -1;
  try
    ExtractTemporaryFile('az-gateway.exe');
    if Exec(ExpandConstant('{tmp}\az-gateway.exe'), 'check-token "' + Url + '" "' + Tok + '"', '',
            SW_HIDE, ewWaitUntilTerminated, RC) then
      Result := RC;
  except
    Result := -1;
  end;
end;

function IsCodeShape(const C: String): Boolean;
begin
  Result := (Pos('azc1.', Trim(C)) = 1) and (Length(Trim(C)) >= 40) and (Pos('"', C) = 0);
end;

function HasCode: Boolean;
begin
  Result := Trim(CfgPage.Values[0]) <> '';
end;

{ Chay "az-gateway.exe check-code <ma>". Cung ma thoat voi check-token (0/1/2/3). }
function CheckCodeOnline(const Code: String): Integer;
var
  RC: Integer;
begin
  Result := -1;
  try
    ExtractTemporaryFile('az-gateway.exe');
    if Exec(ExpandConstant('{tmp}\az-gateway.exe'), 'check-code "' + Trim(Code) + '"', '',
            SW_HIDE, ewWaitUntilTerminated, RC) then
      Result := RC;
  except
    Result := -1;
  end;
end;

procedure InitializeWizard;
var
  Json: String;
begin
  MigrateMode := NeedsTokenMigration;
  CfgPage := CreateInputQueryPage(wpSelectDir, 'Ket noi cloud',
    'Thong tin de Gateway gui du lieu len he thong AZ Sentinel',
    'Dan "Ma ket noi" (azc1...) do quan tri vien gui cho ban la xong, khong can go gi them. ' +
    'Cac o con lai chi can khi khong co ma. Co the de trong het de chay cuc bo truoc, cau hinh sau tren giao dien web cua Gateway.');
  CfgPage.Add('Ma ket noi (dan ma azc1... vao day):', False);
  CfgPage.Add('Ten VPS (hien tren web):', False);
  CfgPage.Add('Cloud URL (vi du wss://ten.workers.dev/api/gw/ws):', False);
  CfgPage.Add('Cloud URL du phong (tuy chon):', False);
  CfgPage.Add('Token ca nhan (azt_..., do quan tri vien cap):', True);
  CfgPage.Values[0] := ExpandConstant('{param:CODE|}');
  CfgPage.Values[1] := ExpandConstant('{param:VPS|{computername}}');
  CfgPage.Values[2] := ExpandConstant('{param:CLOUDURL|}');
  CfgPage.Values[3] := ExpandConstant('{param:FALLBACKURL|}');
  CfgPage.Values[4] := ExpandConstant('{param:TOKEN|}');
  if MigrateMode then
  begin
    { Giu nguyen ten VPS va dia chi cu, chi doi token (cac khoa khac trong config.json khong bi dong vao). }
    Json := ReadConfig;
    CfgPage.Values[1] := JsonGetString(Json, 'vps');
    CfgPage.Values[2] := JsonGetString(Json, 'cloudUrl');
    CfgPage.Values[3] := JsonGetString(Json, 'cloudFallbackUrl');
    CfgPage.Edits[1].Enabled := False;
    CfgPage.Edits[2].Enabled := False;
    CfgPage.Edits[3].Enabled := False;
    CfgPage.PageDescription := 'Doi sang token ca nhan';
    CfgPage.SubCaptionLabel.Caption :=
      'Khoa ket noi chung cu khong con dung duoc. Hay nhap token ca nhan azt_... do quan tri vien cap cho ban. ' +
      'Cac cai dat khac giu nguyen.';
  end;
end;

{ Nang cap: da co config.json (va token da dung dang azt_...) thi khong hoi lai, tru khi truyen /CLOUDURL=... }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (PageID = CfgPage.ID) and FileExists(ConfigPath) and (not MigrateMode) and
     (ExpandConstant('{param:CLOUDURL|}') = '') and (ExpandConstant('{param:CODE|}') = '') then
    Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Url, Fb, Tok: String;
  Code: Integer;
begin
  Result := True;
  if CurPageID <> CfgPage.ID then Exit;
  Url := Trim(CfgPage.Values[2]);
  Fb := Trim(CfgPage.Values[3]);
  Tok := Trim(CfgPage.Values[4]);

  if Trim(CfgPage.Values[1]) = '' then
  begin
    MsgBox('Hay nhap ten VPS.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  { Co ma ket noi: chi can kiem ma, bo qua cac o URL/token (ma ghi de chung). }
  if HasCode then
  begin
    if not IsCodeShape(CfgPage.Values[0]) then
    begin
      MsgBox('Ma ket noi khong dung. Hay dan lai nguyen ma azc1... do quan tri vien gui.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if not SkipTokenCheck then
    begin
      Code := CheckCodeOnline(CfgPage.Values[0]);
      if Code = 3 then
      begin
        MsgBox('Ma ket noi khong doc duoc. Hay dan lai nguyen ma azc1... do quan tri vien gui.', mbError, MB_OK);
        Result := False;
      end
      else if Code = 1 then
      begin
        MsgBox('He thong tu choi ma nay: da bi thu hoi hoac da dat lai. Hay xin quan tri vien ma moi.', mbError, MB_OK);
        Result := False;
      end
      else if Code = 2 then
      begin
        if MsgBox('Khong hoi duoc may chu nen chua kiem tra duoc ma (mang hoac may chu dang tat).' + #13#10 +
                  'Van tiep tuc cai dat?', mbConfirmation, MB_YESNO) = IDNO then
          Result := False;
      end;
    end;
    Exit;
  end;
  if (Url <> '') and (not IsWsUrl(Url)) then
  begin
    MsgBox('Cloud URL phai bat dau bang wss:// (hoac ws://).', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Fb <> '') and (not IsWsUrl(Fb)) then
  begin
    MsgBox('Cloud URL du phong phai bat dau bang wss:// (hoac ws://).', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Tok <> '') and (not IsTokenShape(Tok)) then
  begin
    MsgBox('Token phai la token ca nhan dang azt_... (do quan tri vien cap). Khoa ket noi chung cu khong con dung.',
      mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if MigrateMode and (Tok = '') then
  begin
    MsgBox('Hay nhap token ca nhan azt_... de tiep tuc.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if (Url <> '') and (Tok = '') then
  begin
    if MsgBox('Chua nhap token: Gateway se khong ket noi duoc cloud cho den khi ban nhap token trong phan Cai dat.' + #13#10 +
              'Tiep tuc cai dat?', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
    Exit;
  end;
  if (Url <> '') and (Tok <> '') and (not SkipTokenCheck) then
  begin
    Code := CheckTokenOnline(Url, Tok);
    if Code = 1 then
    begin
      MsgBox('Cloud tu choi token nay: sai, da bi thu hoi hoac da dat lai. Hay xin quan tri vien token moi.',
        mbError, MB_OK);
      Result := False;
    end
    else if Code = 2 then
    begin
      if MsgBox('Khong hoi duoc cloud nen chua kiem tra duoc token (mang hoac dia chi sai).' + #13#10 +
                'Van tiep tuc cai dat?', mbConfirmation, MB_YESNO) = IDNO then
        Result := False;
    end;
  end;
end;

{ Dung ban dang chay truoc khi ghi de file (cap nhat tai cho). Dung tac vu truoc, roi moi diet exe.
  Cai im lang khong qua trang nhap, nen kiem token o day: bi tu choi (401) thi dung cai de khoi trien khai sai hang loat. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  RC, Code: Integer;
  Url, Tok: String;
begin
  Result := '';
  if WizardSilent and (not SkipTokenCheck) and HasCode then
  begin
    if not IsCodeShape(CfgPage.Values[0]) then
    begin
      Result := 'Tham so /CODE phai la ma ket noi azc1... do quan tri vien gui.';
      Exit;
    end;
    Code := CheckCodeOnline(CfgPage.Values[0]);
    if Code = 3 then
    begin
      Result := 'Ma ket noi (/CODE) khong doc duoc.';
      Exit;
    end;
    if Code = 1 then
    begin
      Result := 'He thong tu choi ma ket noi (da thu hoi hoac da dat lai). Dung /SKIPTOKENCHECK=1 neu van muon cai.';
      Exit;
    end;
  end
  else if WizardSilent and (not SkipTokenCheck) and (WillWriteFresh or MigrateMode) then
  begin
    Url := Trim(CfgPage.Values[2]);
    Tok := Trim(CfgPage.Values[4]);
    if (Url <> '') and (Tok <> '') then
    begin
      if not IsTokenShape(Tok) then
      begin
        Result := 'Tham so /TOKEN phai la token ca nhan dang azt_... (khoa chung cu khong con dung).';
        Exit;
      end;
      Code := CheckTokenOnline(Url, Tok);
      if Code = 1 then
      begin
        Result := 'Cloud tu choi token (sai, da thu hoi hoac da dat lai). Dung /SKIPTOKENCHECK=1 neu van muon cai.';
        Exit;
      end;
    end;
  end;
  WasInstalled := FileExists(ExpandConstant('{app}\az-gateway.exe'));
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "AZ Gateway"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM az-gateway.exe', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Sleep(800);
end;

{ Nang cap tu khoa chung cu: chi thay gia tri cloudToken trong config.json, giu nguyen cac khoa khac. }
procedure MigrateToken(const NewTok: String);
var
  Json, Old: String;
begin
  if NewTok = '' then Exit;
  Json := ReadConfig;
  Old := JsonGetString(Json, 'cloudToken');
  if Pos('"cloudToken": "', Json) > 0 then
    StringChangeEx(Json, '"cloudToken": "' + Old + '"', '"cloudToken": "' + JsonEscape(NewTok) + '"', True)
  else
    StringChangeEx(Json, '{', '{' + #13#10 + '  "cloudToken": "' + JsonEscape(NewTok) + '",', False);
  SaveStringToFile(ConfigPath, Json, False);
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
    if HasCode then
    begin
      { Ma ket noi: de az-gateway.exe giai ma va ghi config.json (giu cac khoa khac, tao moi neu chua co). }
      ExtractTemporaryFile('az-gateway.exe');
      if (not Exec(ExpandConstant('{tmp}\az-gateway.exe'),
            'apply-code "' + Trim(CfgPage.Values[0]) + '" "' + Trim(CfgPage.Values[1]) + '"', '',
            SW_HIDE, ewWaitUntilTerminated, RC)) or (RC <> 0) then
        MsgBox('Khong ghi duoc cau hinh tu ma ket noi. Hay mo giao dien AZ Gateway va dan ma vao muc Cai dat.',
          mbError, MB_OK);
    end
    else if WillWriteFresh then
    begin
      Json := '{' + #13#10 +
        '  "vps": "' + JsonEscape(Trim(CfgPage.Values[1])) + '",' + #13#10 +
        '  "cloudUrl": "' + JsonEscape(Trim(CfgPage.Values[2])) + '",' + #13#10 +
        '  "cloudFallbackUrl": "' + JsonEscape(Trim(CfgPage.Values[3])) + '",' + #13#10 +
        '  "cloudToken": "' + JsonEscape(Trim(CfgPage.Values[4])) + '"' + #13#10 + '}' + #13#10;
      SaveStringToFile(ConfigPath, Json, False);
    end
    else if MigrateMode then
      MigrateToken(Trim(CfgPage.Values[4]));
    { Token nam trong config.json: chi Administrators va SYSTEM duoc doc. }
    Exec(ExpandConstant('{sys}\icacls.exe'),
      ExpandConstant('"{#DataDir}" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F'),
      '', SW_HIDE, ewWaitUntilTerminated, RC);
  end;
end;
