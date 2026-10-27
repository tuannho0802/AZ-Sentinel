//+------------------------------------------------------------------+
//| AZ_Spike.mq5 - EA tracking (Plan 3C, patch 10)                    |
//| Chi noi chuyen voi Gateway cuc bo qua HTTP loopback. Khong giu    |
//| khoa Cloudflare, khong biet URL cloud.                            |
//|   TRACK   : ping moi InpPingSec giay, gui event khi co tin hieu.  |
//|   LIVE    : gui samples THEO TICK (OnTick), cach nhau toi thieu    |
//|             interval_ms (Gateway quyet dinh); OnTimer 1 giay du   |
//|             phong khi thi truong khong co tick.                   |
//|   GW_DOWN : Gateway khong tra loi, chi ghi nhan cuc bo, ping thua.|
//|   Canh bao lo float: Gateway tra alert_bp (basis point Balance);   |
//|             EA do Float P/L / Balance, vuot nguong thi POST       |
//|             /v1/alert, het lenh thi bao clear (Plan 5, v0.4.0).   |
//|   Giao dich thu cong tu xa (v0.5.0): Gateway dua lenh (tr_*) trong |
//|             phan hoi ping/samples; EA dong lenh, dong mot phan,   |
//|             sua SL/TP roi POST /v1/trade_result. MAC DINH TAT:    |
//|             chi chay khi InpAllowRemoteTrading = true.            |
//|   Pha 2 (v0.6.0): dong hang loat theo bo loc (close_all), va MO   |
//|             lenh moi (market, lenh cho limit/stop kem SL/TP). MO   |
//|             lenh can THEM InpAllowRemoteOpen = true (mac dinh tat) |
//|             va bi chan boi InpMaxRemoteVolume.                    |
//| Ten file giu nguyen de giu lich su git (Q2); doi ten khi phat hanh|
//+------------------------------------------------------------------+
#property copyright "AZ Team"
#property version "0.60"
#property description "AZ Sentinel tracking EA: ping, samples, event toi Gateway cuc bo; tuy chon dieu khien lenh tu xa (dong, sua, mo lenh)"

#include <Trade\Trade.mqh>

#define EA_VER "0.6.0"
#define MAX_SAMPLES 20
#define MAX_POSITIONS 200
#define MAX_PENDING_EVENTS 100
#define EVENTS_PER_REQUEST 50
#define ALERT_REPORT_SEC 60      // nhac lai "dang vuot nguong lo float" moi chung nay giay (Server loc)
#define ALERT_RETRY_SEC 10       // gui that bai (Gateway chua nhan): thu lai sau chung nay giay
#define TR_MIN_START_MS 3000     // chi BAT DAU thuc thi lenh tu xa khi han dung (tr_ttl) con it nhat chung nay ms
#define TR_MAX_RUN_MS 8000       // close_all: ngung dong them khi da chay chung nay ms (de ket qua kip ve truoc khi Gateway bao timeout)
#define TR_RESULT_TRIES 20       // gui ket qua lenh toi Gateway that bai thi thu lai toi da chung nay lan (moi 2 giay)
#define ALERT_ZERO_TICKS 3       // can chung nay lan do lien tiep thay 0 lenh moi bao "clear" (tranh sai luc moi khoi dong)

input string InpGateway = "http://127.0.0.1:47800"; // Gateway cuc bo (phai nam trong Allow WebRequest)
input string InpApiKey = "";            // De trong = tu dong theo token ca nhan cua Gateway. Neu nhap: API key cua lien ket, khong chia se
input int InpPingSec = 5;                           // Nhip ping Gateway (giay, toi thieu 2)
input int InpTimeoutMs = 1000;                      // Timeout WebRequest (ms). Gateway tra loi duoi 50 ms
input bool InpAllowRemoteTrading = false;           // CHO PHEP dieu khien lenh tu xa (dong lenh, dong mot phan, sua SL/TP, close all). MAC DINH TAT. Bat = ai co quyen tren web deu dieu khien duoc tai khoan nay
input bool InpAllowRemoteOpen = false;              // CHO PHEP MO LENH MOI tu xa (market, lenh cho). MAC DINH TAT, can bat them InpAllowRemoteTrading. Bat = nguoi co quyen tren web co the tang rui ro tai khoan nay
input double InpMaxRemoteVolume = 1.0;              // Khoi luong toi da (lot) cua MOT lenh MO MOI tu xa; vuot thi tu choi. Chan go nham so lot
input int InpSlippagePts = 30;                      // Do truot gia toi da (point) cho lenh dong tu xa
input double InpMarginLevelAlert = 0.0;             // Canh bao khi margin level (%) xuong duoi muc nay. 0 = tat

enum EaState
{
   ST_TRACK = 0,
   ST_LIVE = 1,
   ST_GW_DOWN = 2
};

string g_sid;
EaState g_state = ST_TRACK;

//--- lich (ms theo GetTickCount64)
ulong g_nextPingMs = 0;
ulong g_nextSendMs = 0;
ulong g_nextEventMs = 0;
ulong g_lastOkMs = 0;

//--- ket noi Gateway
int g_failStreak = 0;
int g_lastHttpErr = 0;
string g_lastBind = "";
int g_intervalMs = 1000;
int g_leaseMs = 15000;
bool g_prevConn = true;

//--- mau live (mang song song, toi da MAX_SAMPLES)
long g_sT[];
double g_sEq[];
double g_sBal[];
double g_sFl[];
double g_sMl[]; // -1 nghia la null
double g_sMg[]; // margin dang dung
int g_nSamples = 0;
long g_samplesSeq = 0;
string g_lastPosHash = "";
bool g_sendPositions = true;

//--- canh bao lo float (Plan 5). EA chi do va bao Gateway; Server quyet dinh co thong bao hay khong.
int g_alertBp = 0;       // nguong theo basis point cua Balance (500 = 5%), 0 = tat. Gateway tra trong ping/samples
bool g_inBreach = false; // dang co "dot canh bao" chua clear (luu qua GlobalVariable de song sot khi EA khoi dong lai)
long g_epStartUtc = 0;   // luc bat dau dot (UTC)
ulong g_nextAlertMs = 0; // lich gui ke tiep (GetTickCount64)
long g_lastAseq = 0;     // so thu tu bao cao cuoi, don dieu tang
int g_zeroTicks = 0;     // so lan do lien tiep thay 0 lenh

//--- giao dich thu cong tu xa (v0.5.0)
CTrade g_trade;
string g_trResult = "";    // JSON ket qua lenh chua gui duoc toi Gateway (mot lenh tai mot thoi diem)
ulong g_trNextTryMs = 0;
int g_trTries = 0;

//--- hang doi su kien giao dich (JSON da dung san)
string g_evJson[];
ulong g_evDeal[];
long g_evTime[]; // thoi gian deal theo gio server, de nho moc ack
int g_nEv = 0;
int g_evInflight = 0; // so su kien dau hang da gui, chua duoc ack (gui lai dung lo cu, cung seq)
long g_evSeq = 0;
bool g_balancePending = false;
bool g_riskPending = false;
bool g_marginAlerted = false;
bool g_evOverflow = false;
long g_ackDealTime = 0;

//--- bo nho dem sl/tp cua vi the de phat hien lenh sua
ulong g_pTicket[];
double g_pSl[];
double g_pTp[];
int g_nPos = 0;

//+------------------------------------------------------------------+
//| JSON helpers                                                      |
//+------------------------------------------------------------------+
string JsonEscape(const string s)
{
   string out = "";
   int n = StringLen(s);
   for (int i = 0; i < n; i++)
   {
      ushort c = StringGetCharacter(s, i);
      switch (c)
      {
      case '"':
         out += "\\\"";
         break;
      case '\\':
         out += "\\\\";
         break;
      case '\n':
         out += "\\n";
         break;
      case '\r':
         out += "\\r";
         break;
      case '\t':
         out += "\\t";
         break;
      default:
         if (c < 0x20)
            out += StringFormat("\\u%04x", c);
         else
            out += ShortToString(c);
      }
   }
   return out;
}

string Num(const double v) // tien, 2 so le, luon dung dau cham
{
   if (!MathIsValidNumber(v))
      return "0.00";
   return DoubleToString(v, 2);
}

string TrimZeros(string s)
{
   if (StringFind(s, ".") < 0)
      return s;
   int n = StringLen(s);
   while (n > 1 && StringGetCharacter(s, n - 1) == '0')
      n--;
   if (StringGetCharacter(s, n - 1) == '.')
      n--;
   return StringSubstr(s, 0, n);
}

string P(const double v) // gia va khoi luong: toi da 8 so le, bo so 0 thua
{
   if (!MathIsValidNumber(v))
      return "0";
   return TrimZeros(DoubleToString(v, 8));
}

string PNull(const double v) // sl/tp: 0 nghia la khong dat
{
   return (v > 0.0) ? P(v) : "null";
}

string ApiKeyOrAuto()
{
   // De trong InpApiKey: gui "auto", Gateway/cloud tu gan lien ket theo token ca nhan.
   return (StringLen(InpApiKey) == 0 ? "auto" : InpApiKey);
}

string Q(const string s) // chuoi JSON co dau nhay
{
   return "\"" + JsonEscape(s) + "\"";
}

bool JsonBool(const string s, const string key, const bool def)
{
   int p = StringFind(s, "\"" + key + "\":");
   if (p < 0)
      return def;
   p += StringLen(key) + 3;
   return StringSubstr(s, p, 4) == "true";
}

long JsonInt(const string s, const string key, const long def)
{
   int p = StringFind(s, "\"" + key + "\":");
   if (p < 0)
      return def;
   p += StringLen(key) + 3;
   int e = p;
   int n = StringLen(s);
   while (e < n)
   {
      ushort c = StringGetCharacter(s, e);
      if ((c >= '0' && c <= '9') || c == '-')
         e++;
      else
         break;
   }
   if (e == p)
      return def;
   return StringToInteger(StringSubstr(s, p, e - p));
}

string JsonStr(const string s, const string key)
{
   int p = StringFind(s, "\"" + key + "\":\"");
   if (p < 0)
      return "";
   p += StringLen(key) + 4;
   int e = StringFind(s, "\"", p);
   if (e < 0)
      return "";
   return StringSubstr(s, p, e - p);
}

//+------------------------------------------------------------------+
//| Thoi gian                                                         |
//+------------------------------------------------------------------+
//--- DEAL_TIME va POSITION_TIME la gio server broker; Plan 1 yeu cau Unix giay UTC.
long ServerToUtc(const long t)
{
   long off = (long)(TimeTradeServer() - TimeGMT());
   off = (long)MathRound((double)off / 900.0) * 900; // lam tron 15 phut
   return t - off;
}

//+------------------------------------------------------------------+
//| Tai khoan                                                         |
//+------------------------------------------------------------------+
string AccountModeStr()
{
   switch ((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE))
   {
   case ACCOUNT_TRADE_MODE_DEMO:
      return "demo";
   case ACCOUNT_TRADE_MODE_CONTEST:
      return "contest";
   default:
      return "real";
   }
}

bool IdentityReady()
{
   return AccountInfoInteger(ACCOUNT_LOGIN) > 0 && StringLen(AccountInfoString(ACCOUNT_SERVER)) > 0;
}

bool JsonHas(const string s, const string key)
{
   return StringFind(s, "\"" + key + "\":") >= 0;
}

double JsonDbl(const string s, const string key, const double def)
{
   int p = StringFind(s, "\"" + key + "\":");
   if (p < 0)
      return def;
   p += StringLen(key) + 3;
   int e = p;
   int n = StringLen(s);
   while (e < n)
   {
      ushort c = StringGetCharacter(s, e);
      if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E')
         e++;
      else
         break;
   }
   if (e == p)
      return def;
   return StringToDouble(StringSubstr(s, p, e - p));
}

string Ident()
{
   return "\"v\":1,\"sid\":" + Q(g_sid) + ",\"key\":" + Q(ApiKeyOrAuto()) +
          ",\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) +
          ",\"server\":" + Q(AccountInfoString(ACCOUNT_SERVER));
}

string MarginLevelJson()
{
   if (AccountInfoDouble(ACCOUNT_MARGIN) > 0.0)
      return Num(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL));
   return "null";
}

string SnapJson()
{
   return "{\"bal\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE)) +
          ",\"eq\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY)) +
          ",\"margin\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN)) +
          ",\"fl\":" + Num(AccountInfoDouble(ACCOUNT_PROFIT)) +
          ",\"ml\":" + MarginLevelJson() + "}";
}

//+------------------------------------------------------------------+
//| HTTP toi Gateway                                                  |
//+------------------------------------------------------------------+
void LogHttpError(const int err)
{
   if (err == g_lastHttpErr)
      return; // khong lap lai cung mot loi, tranh tran log khi Gateway tat
   g_lastHttpErr = err;
   if (err == 4014)
      PrintFormat("AZ: URL chua duoc cho phep. Them %s vao Tools > Options > Expert Advisors > Allow WebRequest.", InpGateway);
   else if (err == 5203 || err == 5201 || err == 5202)
      PrintFormat("AZ: khong noi duoc Gateway %s (loi %d). Gateway da chay chua?", InpGateway, err);
   else
      PrintFormat("AZ: WebRequest loi %d", err);
}

int HttpPost(const string path, const string body, string &resp)
{
   char data[];
   char result[];
   string resHeaders;
   int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if (n > 0)
      ArrayResize(data, n - 1); // bo ky tu ket thuc chuoi
   string headers = "Content-Type: application/json\r\n";

   ResetLastError();
   int code = WebRequest("POST", InpGateway + path, headers, InpTimeoutMs, data, result, resHeaders);
   if (code == -1)
   {
      LogHttpError(GetLastError());
      resp = "";
      return -1;
   }
   resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return code;
}

//+------------------------------------------------------------------+
//| May trang thai                                                    |
//+------------------------------------------------------------------+
const string StateName(const EaState s)
{
   if (s == ST_LIVE)
      return "LIVE";
   if (s == ST_GW_DOWN)
      return "GW_DOWN";
   return "TRACK";
}

void SetState(const EaState s)
{
   if (g_state == s)
      return;
   PrintFormat("AZ: %s -> %s", StateName(g_state), StateName(s));
   g_state = s;
}

void ClearSamples()
{
   g_nSamples = 0;
}

void EnterLive()
{
   ClearSamples();
   g_sendPositions = true; // gui day du vi the o lan dau cua moi dot live
   g_lastPosHash = "";
   g_nextSendMs = GetTickCount64() + (ulong)g_intervalMs;
   SetState(ST_LIVE);
}

void LeaveLive()
{
   ClearSamples();
   SetState(ST_TRACK);
}

void OnGatewayFail()
{
   g_failStreak++;
   if (g_state == ST_LIVE && g_failStreak >= 2)
      LeaveLive();
   if (g_failStreak >= 3 && g_state != ST_GW_DOWN)
   {
      ClearSamples();
      SetState(ST_GW_DOWN);
   }
}

ulong NextPingDelayMs()
{
   int sec = MathMax(2, InpPingSec);
   if (g_state == ST_GW_DOWN)
   {
      if (g_failStreak >= 7)
         sec = MathMax(sec, 30);
      else if (g_failStreak >= 5)
         sec = MathMax(sec, 15);
   }
   return (ulong)sec * 1000;
}

//+------------------------------------------------------------------+
//| Giao dich thu cong tu xa (v0.5.0)                                  |
//| Gateway dua lenh vao phan hoi ping/samples (tr_*). Nguyen tac:    |
//|  - Mac dinh TAT (InpAllowRemoteTrading). Tat thi chi bao lai loi.  |
//|  - Toi da MOT LAN: cmd_id duoc ghi nho (GlobalVariable, song sot   |
//|    khi EA khoi dong lai) TRUOC khi goi san. Mat ket qua thi nguoi  |
//|    dung tu xem lai bang lenh, khong bao gio chay lenh hai lan.     |
//|  - Chi BAT DAU khi han dung con >= TR_MIN_START_MS.                |
//|  - Ket qua la retcode that cua MT5, khong bao thanh cong gia.      |
//+------------------------------------------------------------------+
string CmdVarName()
{
   return "AZ_LC_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
}

//--- 13 ky tu hex dau cua cmd_id (52 bit) -> so nguyen chinh xac trong double
double CmdHash(const string id)
{
   ulong h = 0;
   int n = MathMin(13, StringLen(id));
   for (int i = 0; i < n; i++)
   {
      ushort c = StringGetCharacter(id, i);
      ulong v = 0;
      if (c >= '0' && c <= '9')
         v = (ulong)(c - '0');
      else if (c >= 'a' && c <= 'f')
         v = (ulong)(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F')
         v = (ulong)(c - 'A' + 10);
      h = h * 16 + v;
   }
   return (double)h;
}

bool CmdAlreadyDone(const string id)
{
   string v = CmdVarName();
   return GlobalVariableCheck(v) && GlobalVariableGet(v) == CmdHash(id);
}

void MarkCmdDone(const string id)
{
   GlobalVariableSet(CmdVarName(), CmdHash(id));
}

//--- Gui ket qua toi Gateway; that bai thi giu lai va thu lai tu OnTimer (SendPendingTradeResult).
void SendPendingTradeResult()
{
   if (StringLen(g_trResult) == 0)
      return;
   ulong now = GetTickCount64();
   if (now < g_trNextTryMs)
      return;
   string resp;
   int code = HttpPost("/v1/trade_result", g_trResult, resp);
   if (code == 200)
   {
      g_trResult = "";
      g_trTries = 0;
      return;
   }
   g_trTries++;
   if (g_trTries >= TR_RESULT_TRIES)
   {
      Print("AZ: bo ket qua lenh tu xa, Gateway khong nhan duoc. Hay kiem tra lai bang lenh.");
      g_trResult = "";
      g_trTries = 0;
      return;
   }
   g_trNextTryMs = now + 2000;
}

//--- left < 0 nghia la khong biet khoi luong con lai
//--- order > 0: ticket lenh vua tao; nOk/nFail >= 0: ket qua dong hang loat (close_all)
void QueueTradeResult(const string id, const string status, const string reason, const int code, const string detail, const double left,
                      const long order = 0, const int nOk = -1, const int nFail = -1)
{
   g_trResult = "{" + Ident() +
                ",\"cmd_id\":" + Q(id) +
                ",\"status\":" + Q(status) +
                ",\"reason\":" + Q(reason) +
                ",\"code\":" + IntegerToString(code) +
                ",\"detail\":" + Q(StringSubstr(detail, 0, 120)) +
                ((left >= 0.0) ? ",\"left\":" + P(left) : "") +
                ((order > 0) ? ",\"order\":" + IntegerToString(order) : "") +
                ((nOk >= 0) ? ",\"n_ok\":" + IntegerToString(nOk) : "") +
                ((nFail >= 0) ? ",\"n_fail\":" + IntegerToString(nFail) : "") + "}";
   g_trTries = 0;
   g_trNextTryMs = 0;
   PrintFormat("AZ: lenh tu xa %s -> %s (%s, retcode %d)", id, status, reason, code);
   SendPendingTradeResult();
}

string ReasonForRetcode(const uint rc)
{
   switch (rc)
   {
   case TRADE_RETCODE_DONE:
   case TRADE_RETCODE_DONE_PARTIAL:
   case TRADE_RETCODE_PLACED:
      return "ok";
   case TRADE_RETCODE_MARKET_CLOSED:
      return "market_closed";
   case TRADE_RETCODE_INVALID_STOPS:
      return "bad_stops";
   case TRADE_RETCODE_INVALID_PRICE:
      return "bad_price";
   case TRADE_RETCODE_NO_MONEY:
      return "no_money";
   case TRADE_RETCODE_INVALID_VOLUME:
      return "bad_volume";
   case TRADE_RETCODE_CLIENT_DISABLES_AT:
   case TRADE_RETCODE_SERVER_DISABLES_AT:
      return "algo_off";
   default:
      return "retcode";
   }
}

//--- Doc retcode cua CTrade sau mot thao tac roi bao ket qua. `ticket` de tinh khoi luong con lai.
void ReportTradeOutcome(const string id, const ulong ticket)
{
   uint rc = g_trade.ResultRetcode();
   bool done = (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL);
   string detail = g_trade.ResultRetcodeDescription();
   if (rc == 0)
      detail = StringFormat("call failed, err %d", GetLastError());
   double left = PositionSelectByTicket(ticket) ? PositionGetDouble(POSITION_VOLUME) : 0.0;
   QueueTradeResult(id, done ? "done" : "failed", ReasonForRetcode(rc), (int)rc, detail, left);
}

//--- Bao ket qua mot lenh MO MOI (market, lenh cho): retcode that cua san va ticket lenh vua tao.
void ReportOrderOutcome(const string id)
{
   uint rc = g_trade.ResultRetcode();
   bool done = (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL || rc == TRADE_RETCODE_PLACED);
   string detail = g_trade.ResultRetcodeDescription();
   if (rc == 0)
      detail = StringFormat("call failed, err %d", GetLastError());
   long ord = done ? (long)g_trade.ResultOrder() : 0;
   QueueTradeResult(id, done ? "done" : "failed", ReasonForRetcode(rc), (int)rc, detail, -1.0, ord);
}

//--- Khoi luong cua lenh MO MOI: dung buoc lot, trong [min, max] cua san, khong vuot InpMaxRemoteVolume.
//--- Khong tu lam tron (giong dong mot phan). Tra ve chuoi rong neu hop le, nguoc lai la mo ta loi.
string OpenVolumeError(const string sym, const double vol)
{
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double minv = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double maxv = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if (step <= 0.0 || vol <= 0.0)
      return "invalid volume";
   if (vol > InpMaxRemoteVolume + 1e-9)
      return "volume exceeds InpMaxRemoteVolume";
   double aligned = MathRound(vol / step) * step;
   if (MathAbs(aligned - vol) > step * 1e-6)
      return "volume not a multiple of step";
   if (vol < minv - 1e-9 || (maxv > 0.0 && vol > maxv + 1e-9))
      return "volume outside symbol min/max";
   return "";
}

//--- Cua chung cua MOI thao tac MO lenh moi: cong tac rieng InpAllowRemoteOpen, ma giao dich, khoi luong.
//--- Tra ve false (da bao ket qua that bai) neu khong duoc phep.
bool OpenAllowed(const string id, const string sym, const double vol)
{
   if (!InpAllowRemoteOpen)
   {
      QueueTradeResult(id, "failed", "remote_disabled", 0, "InpAllowRemoteOpen is off", -1.0);
      return false;
   }
   if (StringLen(sym) == 0 || !SymbolSelect(sym, true))
   {
      QueueTradeResult(id, "failed", "bad_symbol", 0, "symbol not found: " + sym, -1.0);
      return false;
   }
   long tm = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   if (tm == SYMBOL_TRADE_MODE_DISABLED || tm == SYMBOL_TRADE_MODE_CLOSEONLY)
   {
      QueueTradeResult(id, "failed", "bad_symbol", 0, "symbol does not allow opening trades", -1.0);
      return false;
   }
   string verr = OpenVolumeError(sym, vol);
   if (StringLen(verr) > 0)
   {
      QueueTradeResult(id, "failed", "bad_volume", 0, verr, -1.0);
      return false;
   }
   return true;
}

//--- Mo vi the theo gia thi truong (tr_sym, tr_side, tr_vol, tr_sl, tr_tp). sl/tp = 0: khong dat.
void RemoteMarket(const string resp, const string id)
{
   string sym = JsonStr(resp, "tr_sym");
   string side = JsonStr(resp, "tr_side");
   double vol = JsonDbl(resp, "tr_vol", 0.0);
   if ((side != "buy" && side != "sell") || !JsonHas(resp, "tr_sl") || !JsonHas(resp, "tr_tp"))
   {
      QueueTradeResult(id, "failed", "bad_request", 0, "market needs tr_side, tr_sl and tr_tp", -1.0);
      return;
   }
   if (!OpenAllowed(id, sym, vol))
      return;

   double sl = JsonDbl(resp, "tr_sl", 0.0);
   double tp = JsonDbl(resp, "tr_tp", 0.0);
   if (sl < 0.0 || tp < 0.0)
   {
      QueueTradeResult(id, "failed", "bad_stops", 0, "negative price", -1.0);
      return;
   }
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   sl = (sl > 0.0) ? NormalizeDouble(sl, digits) : 0.0;
   tp = (tp > 0.0) ? NormalizeDouble(tp, digits) : 0.0;

   bool isBuy = (side == "buy");
   // Vi the mua dong o Bid, vi the ban dong o Ask: SL/TP phai dung phia so voi gia do.
   double ref = isBuy ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);
   if (ref <= 0.0)
   {
      QueueTradeResult(id, "failed", "market_closed", 0, "no quote for symbol", -1.0);
      return;
   }
   bool sideOk = isBuy ? ((sl == 0.0 || sl < ref) && (tp == 0.0 || tp > ref))
                       : ((sl == 0.0 || sl > ref) && (tp == 0.0 || tp < ref));
   if (!sideOk)
   {
      QueueTradeResult(id, "failed", "bad_stops", 0, "SL/TP on the wrong side of the market price", -1.0);
      return;
   }

   g_trade.SetTypeFillingBySymbol(sym);
   if (isBuy)
      g_trade.Buy(vol, sym, 0.0, sl, tp, "AZ remote");
   else
      g_trade.Sell(vol, sym, 0.0, sl, tp, "AZ remote");
   ReportOrderOutcome(id);
}

//--- Dat lenh cho (tr_sym, tr_kind, tr_vol, tr_px, tr_sl, tr_tp). sl/tp = 0: khong dat. Het han: GTC.
void RemotePending(const string resp, const string id)
{
   string sym = JsonStr(resp, "tr_sym");
   string kind = JsonStr(resp, "tr_kind");
   double vol = JsonDbl(resp, "tr_vol", 0.0);
   double px = JsonDbl(resp, "tr_px", 0.0);
   if (px <= 0.0 || !JsonHas(resp, "tr_sl") || !JsonHas(resp, "tr_tp") ||
       (kind != "buy_limit" && kind != "sell_limit" && kind != "buy_stop" && kind != "sell_stop"))
   {
      QueueTradeResult(id, "failed", "bad_request", 0, "pending needs tr_kind, tr_px, tr_sl and tr_tp", -1.0);
      return;
   }
   if (!OpenAllowed(id, sym, vol))
      return;

   double sl = JsonDbl(resp, "tr_sl", 0.0);
   double tp = JsonDbl(resp, "tr_tp", 0.0);
   if (sl < 0.0 || tp < 0.0)
   {
      QueueTradeResult(id, "failed", "bad_stops", 0, "negative price", -1.0);
      return;
   }
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   px = NormalizeDouble(px, digits);
   sl = (sl > 0.0) ? NormalizeDouble(sl, digits) : 0.0;
   tp = (tp > 0.0) ? NormalizeDouble(tp, digits) : 0.0;

   bool isBuy = (StringFind(kind, "buy") == 0);
   // SL/TP phai dung phia so voi gia vao: mua SL < gia < TP; ban TP < gia < SL.
   bool sideOk = isBuy ? ((sl == 0.0 || sl < px) && (tp == 0.0 || tp > px))
                       : ((sl == 0.0 || sl > px) && (tp == 0.0 || tp < px));
   if (!sideOk)
   {
      QueueTradeResult(id, "failed", "bad_stops", 0, "SL/TP on the wrong side of the entry price", -1.0);
      return;
   }

   // Gia vao phai dung phia so voi thi truong: buy_limit < Ask, buy_stop > Ask, sell_limit > Bid, sell_stop < Bid.
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   if (ask <= 0.0 || bid <= 0.0)
   {
      QueueTradeResult(id, "failed", "market_closed", 0, "no quote for symbol", -1.0);
      return;
   }
   bool pxOk = false;
   if (kind == "buy_limit")
      pxOk = (px < ask);
   else if (kind == "buy_stop")
      pxOk = (px > ask);
   else if (kind == "sell_limit")
      pxOk = (px > bid);
   else
      pxOk = (px < bid);
   if (!pxOk)
   {
      QueueTradeResult(id, "failed", "bad_price", 0, "entry price on the wrong side of the market price", -1.0);
      return;
   }

   g_trade.SetTypeFilling(ORDER_FILLING_RETURN);
   if (kind == "buy_limit")
      g_trade.BuyLimit(vol, px, sym, sl, tp, ORDER_TIME_GTC, 0, "AZ remote");
   else if (kind == "sell_limit")
      g_trade.SellLimit(vol, px, sym, sl, tp, ORDER_TIME_GTC, 0, "AZ remote");
   else if (kind == "buy_stop")
      g_trade.BuyStop(vol, px, sym, sl, tp, ORDER_TIME_GTC, 0, "AZ remote");
   else
      g_trade.SellStop(vol, px, sym, sl, tp, ORDER_TIME_GTC, 0, "AZ remote");
   ReportOrderOutcome(id);
}

//--- Dong hang loat vi the theo bo loc tr_filter: all | profit | loss | buy | sell.
//--- profit: lai + swap > 0; loss: lai + swap < 0 (cung quy tac voi matchesCloseAll cua Shared). Khong dung lenh cho.
//--- Chi GIAM rui ro nen dung chung cong tac InpAllowRemoteTrading. Dung them lenh khi qua TR_MAX_RUN_MS.
void RemoteCloseAll(const string resp, const string id)
{
   string filter = JsonStr(resp, "tr_filter");
   if (filter != "all" && filter != "profit" && filter != "loss" && filter != "buy" && filter != "sell")
   {
      QueueTradeResult(id, "failed", "bad_request", 0, "close_all needs tr_filter", -1.0);
      return;
   }

   // Chot danh sach ticket truoc, vi dong lenh lam doi chi so cua PositionsTotal.
   ulong tickets[];
   int n = 0;
   int total = PositionsTotal();
   for (int i = 0; i < total; i++)
   {
      ulong t = PositionGetTicket(i);
      if (t == 0)
         continue;
      double net = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      long type = PositionGetInteger(POSITION_TYPE);
      bool hit = (filter == "all") ||
                 (filter == "profit" && net > 0.0) ||
                 (filter == "loss" && net < 0.0) ||
                 (filter == "buy" && type == POSITION_TYPE_BUY) ||
                 (filter == "sell" && type == POSITION_TYPE_SELL);
      if (!hit)
         continue;
      ArrayResize(tickets, n + 1);
      tickets[n] = t;
      n++;
   }
   if (n == 0)
   {
      QueueTradeResult(id, "failed", "no_match", 0, "no open position matches the filter", -1.0, 0, 0, 0);
      return;
   }

   ulong startMs = GetTickCount64();
   int okN = 0;
   int failN = 0;
   uint lastRc = 0;
   string lastDetail = "";
   bool stopped = false;
   for (int k = 0; k < n; k++)
   {
      if (GetTickCount64() - startMs > TR_MAX_RUN_MS)
      {
         failN += n - k;
         stopped = true;
         break;
      }
      if (!PositionSelectByTicket(tickets[k]))
         continue; // da bi dong o noi khac trong luc chay: khong tinh vao ket qua
      g_trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
      g_trade.PositionClose(tickets[k], (ulong)InpSlippagePts);
      uint rc = g_trade.ResultRetcode();
      if (rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL)
         okN++;
      else
      {
         failN++;
         lastRc = rc;
         lastDetail = (rc == 0) ? StringFormat("call failed, err %d", GetLastError()) : g_trade.ResultRetcodeDescription();
      }
   }

   string detail = StringFormat("closed %d, failed %d", okN, failN);
   if (stopped)
      detail += ", stopped at time limit";
   else if (failN > 0)
      detail += ", last: " + lastDetail;
   if (failN == 0)
      QueueTradeResult(id, "done", "ok", (int)TRADE_RETCODE_DONE, detail, -1.0, 0, okN, 0);
   else if (okN > 0)
      QueueTradeResult(id, "failed", "partial", (int)lastRc, detail, -1.0, 0, okN, failN);
   else
      QueueTradeResult(id, "failed", ReasonForRetcode(lastRc), (int)lastRc, detail, -1.0, 0, 0, failN);
}

void ProcessTradeCommand(const string resp, const string id)
{
   if (StringLen(id) != 16 || CmdAlreadyDone(id))
      return;
   MarkCmdDone(id); // TRUOC khi chay: toi da mot lan

   string op = JsonStr(resp, "tr_op");
   ulong ticket = (ulong)JsonInt(resp, "tr_ticket", 0);
   long ttl = JsonInt(resp, "tr_ttl", 0);

   if (!InpAllowRemoteTrading)
   {
      QueueTradeResult(id, "failed", "remote_disabled", 0, "InpAllowRemoteTrading is off", -1.0);
      return;
   }
   if (ttl < TR_MIN_START_MS)
   {
      QueueTradeResult(id, "failed", "expired", 0, "command expired before start", -1.0);
      return;
   }
   if (!(bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !(bool)MQLInfoInteger(MQL_TRADE_ALLOWED) ||
       !(bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) || !(bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
   {
      QueueTradeResult(id, "failed", "algo_off", 0, "trading not allowed (Algo Trading / account)", -1.0);
      return;
   }
   // Pha 2: lenh khong gan voi mot ticket co san. Moi ham tu kiem cong tac/gioi han cua minh truoc khi goi san.
   if (op == "market")
   {
      RemoteMarket(resp, id);
      return;
   }
   if (op == "pending")
   {
      RemotePending(resp, id);
      return;
   }
   if (op == "close_all")
   {
      RemoteCloseAll(resp, id);
      return;
   }
   if (ticket == 0 || !PositionSelectByTicket(ticket))
   {
      QueueTradeResult(id, "failed", "no_position", 0, "position not found", -1.0);
      return;
   }

   string sym = PositionGetString(POSITION_SYMBOL);
   double posVol = PositionGetDouble(POSITION_VOLUME);
   g_trade.SetTypeFillingBySymbol(sym);

   if (op == "close")
   {
      g_trade.PositionClose(ticket, (ulong)InpSlippagePts);
      ReportTradeOutcome(id, ticket);
      return;
   }

   if (op == "partial_close")
   {
      double want = JsonDbl(resp, "tr_vol", 0.0);
      double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
      double minv = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
      if (step <= 0.0 || want <= 0.0 || want > posVol + 1e-9)
      {
         QueueTradeResult(id, "failed", "bad_volume", 0, "volume exceeds position or invalid", -1.0);
         return;
      }
      double aligned = MathRound(want / step) * step;
      // Khong tu y lam tron: khoi luong khong dung buoc thi tu choi de nguoi dung biet.
      if (MathAbs(aligned - want) > step * 1e-6 || aligned < minv - 1e-9)
      {
         QueueTradeResult(id, "failed", "bad_volume", 0, "volume not a multiple of step or below minimum", -1.0);
         return;
      }
      double rest = posVol - aligned;
      if (rest > 1e-9 && rest < minv - 1e-9)
      {
         QueueTradeResult(id, "failed", "bad_volume", 0, "remaining volume would be below minimum", -1.0);
         return;
      }
      if (rest <= 1e-9)
         g_trade.PositionClose(ticket, (ulong)InpSlippagePts);
      else
         g_trade.PositionClosePartial(ticket, NormalizeDouble(aligned, 8), (ulong)InpSlippagePts);
      ReportTradeOutcome(id, ticket);
      return;
   }

   if (op == "modify")
   {
      if (!JsonHas(resp, "tr_sl") || !JsonHas(resp, "tr_tp"))
      {
         QueueTradeResult(id, "failed", "bad_request", 0, "modify needs tr_sl and tr_tp", -1.0);
         return;
      }
      double sl = JsonDbl(resp, "tr_sl", 0.0);
      double tp = JsonDbl(resp, "tr_tp", 0.0);
      if (sl < 0.0 || tp < 0.0)
      {
         QueueTradeResult(id, "failed", "bad_stops", 0, "negative price", -1.0);
         return;
      }
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      sl = (sl > 0.0) ? NormalizeDouble(sl, digits) : 0.0; // 0 = bo SL
      tp = (tp > 0.0) ? NormalizeDouble(tp, digits) : 0.0; // 0 = bo TP
      g_trade.PositionModify(ticket, sl, tp);
      ReportTradeOutcome(id, ticket);
      return;
   }

   QueueTradeResult(id, "failed", "bad_request", 0, "unknown op", -1.0);
}

//--- Xu ly phan hoi cua /v1/ping va /v1/samples. Tra ve true neu HTTP 200.
bool HandleReply(const int code, const string resp)
{
   if (code != 200)
   {
      if (code != -1 && code != g_lastHttpErr)
      {
         g_lastHttpErr = code;
         PrintFormat("AZ: Gateway tra ma %d: %s", code, StringSubstr(resp, 0, 200));
      }
      OnGatewayFail();
      return false;
   }
   g_lastHttpErr = 0;
   g_failStreak = 0;
   g_lastOkMs = GetTickCount64();
   if (g_state == ST_GW_DOWN)
      SetState(ST_TRACK);

   g_intervalMs = (int)MathMin(5000, MathMax(100, JsonInt(resp, "interval_ms", 1000)));
   g_leaseMs = (int)MathMin(60000, MathMax(5000, JsonInt(resp, "lease_ms", 15000)));
   g_alertBp = (int)MathMin(10000, MathMax(0, JsonInt(resp, "alert_bp", 0)));

   string bind = JsonStr(resp, "bind");
   if (bind != g_lastBind)
   {
      g_lastBind = bind;
      if (bind == "rejected")
         PrintFormat("AZ: cloud tu choi khoa (ma %d). Kiem tra InpApiKey.", (int)JsonInt(resp, "code", 0));
      else if (bind == "ok")
         Print("AZ: da gan voi lien ket tren cloud.");
   }

   bool watch = JsonBool(resp, "watch", false);
   if (watch && g_state == ST_TRACK)
      EnterLive();
   else if (!watch && g_state == ST_LIVE)
      LeaveLive();

   // Lenh giao dich thu cong tu xa (neu co). Gateway gui lai cung lenh moi phan hoi cho toi khi nhan ket qua;
   // ProcessTradeCommand tu loai trung theo cmd_id nen chi chay mot lan.
   string trId = JsonStr(resp, "tr_id");
   if (StringLen(trId) > 0)
      ProcessTradeCommand(resp, trId);
   return true;
}

//+------------------------------------------------------------------+
//| ping                                                              |
//+------------------------------------------------------------------+
string BuildPing()
{
   bool conn = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   return "{" + Ident() +
          ",\"ea_ver\":" + Q(EA_VER) +
          ",\"mode\":" + Q(AccountModeStr()) +
          ",\"broker\":" + Q(StringSubstr(AccountInfoString(ACCOUNT_COMPANY), 0, 128)) +
          ",\"name\":" + Q(StringSubstr(AccountInfoString(ACCOUNT_NAME), 0, 128)) +
          ",\"conn\":" + (conn ? "true" : "false") +
          ",\"snap\":" + SnapJson() + "}";
}

void DoPing()
{
   string resp;
   int code = HttpPost("/v1/ping", BuildPing(), resp);
   HandleReply(code, resp);
   g_nextPingMs = GetTickCount64() + NextPingDelayMs();
}

//+------------------------------------------------------------------+
//| samples (chi khi LIVE)                                            |
//+------------------------------------------------------------------+
void CollectSample()
{
   if (g_nSamples >= MAX_SAMPLES)
   {
      // Day (Gateway cham): bo mau cu nhat de luon giu mau moi.
      for (int i = 1; i < g_nSamples; i++)
      {
         g_sT[i - 1] = g_sT[i];
         g_sEq[i - 1] = g_sEq[i];
         g_sBal[i - 1] = g_sBal[i];
         g_sFl[i - 1] = g_sFl[i];
         g_sMl[i - 1] = g_sMl[i];
         g_sMg[i - 1] = g_sMg[i];
      }
      g_nSamples--;
   }
   int k = g_nSamples;
   g_sT[k] = (long)TimeGMT();
   g_sEq[k] = AccountInfoDouble(ACCOUNT_EQUITY);
   g_sBal[k] = AccountInfoDouble(ACCOUNT_BALANCE);
   g_sFl[k] = AccountInfoDouble(ACCOUNT_PROFIT);
   g_sMl[k] = (AccountInfoDouble(ACCOUNT_MARGIN) > 0.0) ? AccountInfoDouble(ACCOUNT_MARGIN_LEVEL) : -1.0;
   g_sMg[k] = AccountInfoDouble(ACCOUNT_MARGIN);
   g_nSamples++;
}

string SamplesJson()
{
   string out = "[";
   for (int i = 0; i < g_nSamples; i++)
   {
      if (i > 0)
         out += ",";
      out += "{\"t\":" + IntegerToString(g_sT[i]) +
             ",\"eq\":" + Num(g_sEq[i]) +
             ",\"bal\":" + Num(g_sBal[i]) +
             ",\"fl\":" + Num(g_sFl[i]) +
             ",\"ml\":" + ((g_sMl[i] >= 0.0) ? Num(g_sMl[i]) : "null") +
             ",\"mg\":" + Num(g_sMg[i]) + "}";
   }
   return out + "]";
}

string PositionTypeStr(const long type)
{
   return (type == POSITION_TYPE_BUY) ? "buy" : "sell";
}

//--- Dung JSON cac vi the dang mo; `hash` doi khi ticket/khoi luong/sl/tp doi (khong tinh profit).
string BuildPositions(string &hash, int &total, bool &truncated)
{
   total = PositionsTotal();
   int n = MathMin(total, MAX_POSITIONS);
   truncated = total > MAX_POSITIONS;
   string out = "[";
   ulong h = 5381;
   int written = 0;
   for (int i = 0; i < n; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket == 0)
         continue;
      double vol = PositionGetDouble(POSITION_VOLUME);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      h = h * 33 + ticket;
      h = h * 33 + (ulong)MathRound(vol * 10000.0);
      h = h * 33 + (ulong)MathRound(sl * 100000.0);
      h = h * 33 + (ulong)MathRound(tp * 100000.0);

      if (written > 0)
         out += ",";
      out += "{\"ticket\":" + (string)ticket +
             ",\"symbol\":" + Q(StringSubstr(PositionGetString(POSITION_SYMBOL), 0, 32)) +
             ",\"type\":\"" + PositionTypeStr(PositionGetInteger(POSITION_TYPE)) + "\"" +
             ",\"volume\":" + P(vol) +
             ",\"time\":" + IntegerToString(ServerToUtc(PositionGetInteger(POSITION_TIME))) +
             ",\"price\":" + P(PositionGetDouble(POSITION_PRICE_OPEN)) +
             ",\"sl\":" + PNull(sl) +
             ",\"tp\":" + PNull(tp) +
             ",\"profit\":" + Num(PositionGetDouble(POSITION_PROFIT)) +
             ",\"swap\":" + Num(PositionGetDouble(POSITION_SWAP)) +
             ",\"comment\":" + Q(StringSubstr(PositionGetString(POSITION_COMMENT), 0, 128)) +
             ",\"magic\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC)) + "}";
      written++;
   }
   hash = StringFormat("%I64x", h);
   return out + "]";
}

//--- Lai/lo hien tai tung vi the: {"<ticket>":profit,...}. Tinh cung `hash` voi BuildPositions
//--- (ticket/khoi luong/sl/tp) nen chi dung JSON day du khi hash doi; moi tick chi gui goi nay.
string BuildPl(string &hash)
{
   int n = MathMin(PositionsTotal(), MAX_POSITIONS);
   string out = "{";
   ulong h = 5381;
   int written = 0;
   for (int i = 0; i < n; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket == 0)
         continue;
      double vol = PositionGetDouble(POSITION_VOLUME);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      h = h * 33 + ticket;
      h = h * 33 + (ulong)MathRound(vol * 10000.0);
      h = h * 33 + (ulong)MathRound(sl * 100000.0);
      h = h * 33 + (ulong)MathRound(tp * 100000.0);
      if (written > 0)
         out += ",";
      out += "\"" + (string)ticket + "\":" + Num(PositionGetDouble(POSITION_PROFIT));
      written++;
   }
   hash = StringFormat("%I64x", h);
   return out + "}";
}

void SendSamples()
{
   if (g_nSamples == 0)
      return;
   string hash = "";
   string pl = BuildPl(hash);

   string body = "{" + Ident() +
                 ",\"seq\":" + IntegerToString(g_samplesSeq + 1) +
                 ",\"samples\":" + SamplesJson();
   bool withPos = g_sendPositions || hash != g_lastPosHash;
   if (withPos)
   {
      // Cau truc danh sach doi (hoac dau dot live): gui day du. Con lai chi gui `pl` cho nhe.
      int total = 0;
      bool truncated = false;
      string h2 = "";
      string pos = BuildPositions(h2, total, truncated);
      body += ",\"positions\":" + pos + ",\"pos_hash\":\"" + hash + "\"" +
              ",\"total_positions\":" + IntegerToString(total);
      if (truncated)
         body += ",\"truncated\":true";
   }
   else if (pl != "{}")
      body += ",\"pl\":" + pl;
   body += "}";

   string resp;
   int code = HttpPost("/v1/samples", body, resp);
   if (HandleReply(code, resp))
   {
      g_samplesSeq++; // chi tang khi thanh cong: gui lai cung seq thi Gateway loai trung
      if (g_state == ST_LIVE)
      {
         ClearSamples();
         if (withPos)
         {
            g_lastPosHash = hash;
            g_sendPositions = false;
         }
      }
   }
   g_nextSendMs = GetTickCount64() + (ulong)g_intervalMs;
   g_nextPingMs = GetTickCount64() + NextPingDelayMs(); // samples da la tin hieu song, khong can ping them
}

//+------------------------------------------------------------------+
//| Su kien giao dich                                                 |
//+------------------------------------------------------------------+
void CacheRebuild()
{
   int total = PositionsTotal();
   ArrayResize(g_pTicket, total);
   ArrayResize(g_pSl, total);
   ArrayResize(g_pTp, total);
   g_nPos = 0;
   for (int i = 0; i < total; i++)
   {
      ulong t = PositionGetTicket(i);
      if (t == 0)
         continue;
      g_pTicket[g_nPos] = t;
      g_pSl[g_nPos] = PositionGetDouble(POSITION_SL);
      g_pTp[g_nPos] = PositionGetDouble(POSITION_TP);
      g_nPos++;
   }
}

int CacheFind(const ulong ticket)
{
   for (int i = 0; i < g_nPos; i++)
      if (g_pTicket[i] == ticket)
         return i;
   return -1;
}

bool HasQueuedDeal(const ulong deal)
{
   for (int i = 0; i < g_nEv; i++)
      if (g_evDeal[i] == deal)
         return true;
   return false;
}

void PushEvent(const ulong deal, const long dealTimeServer, const string json)
{
   if (g_nEv >= MAX_PENDING_EVENTS)
   {
      // Hang doi day: bo su kien cu nhat va nho de doi chieu lich su sau.
      for (int i = 1; i < g_nEv; i++)
      {
         g_evJson[i - 1] = g_evJson[i];
         g_evDeal[i - 1] = g_evDeal[i];
         g_evTime[i - 1] = g_evTime[i];
      }
      g_nEv--;
      if (g_evInflight > 0)
         g_evInflight--;
      g_evOverflow = true;
   }
   g_evJson[g_nEv] = json;
   g_evDeal[g_nEv] = deal;
   g_evTime[g_nEv] = dealTimeServer;
   g_nEv++;
}

string DealTypeToPosType(const long dealType, const bool isOpen)
{
   // Deal dong lenh co chieu nguoc voi vi the: deal SELL dong vi the BUY.
   bool buy = (dealType == DEAL_TYPE_BUY);
   if (!isOpen)
      buy = !buy;
   return buy ? "buy" : "sell";
}

//--- Dung su kien open/close tu mot deal da nam trong lich su. Tra ve "" neu khong phai deal giao dich.
string BuildDealEvent(const ulong deal, long &dealTime)
{
   long dtype = HistoryDealGetInteger(deal, DEAL_TYPE);
   if (dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL)
      return "";
   long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
   bool isOpen = (entry == DEAL_ENTRY_IN);
   ulong posId = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);
   dealTime = HistoryDealGetInteger(deal, DEAL_TIME);

   string sym = HistoryDealGetString(deal, DEAL_SYMBOL);
   double sl = 0.0, tp = 0.0;
   if (isOpen && PositionSelectByTicket(posId))
   {
      sl = PositionGetDouble(POSITION_SL);
      tp = PositionGetDouble(POSITION_TP);
   }

   string json = "{\"kind\":\"" + (isOpen ? "open" : "close") + "\"" +
                 ",\"deal_ticket\":" + (string)deal +
                 ",\"position_id\":" + (string)posId +
                 ",\"symbol\":" + Q(StringSubstr(sym, 0, 32)) +
                 ",\"type\":\"" + DealTypeToPosType(dtype, isOpen) + "\"" +
                 ",\"volume\":" + P(HistoryDealGetDouble(deal, DEAL_VOLUME)) +
                 ",\"time\":" + IntegerToString(ServerToUtc(dealTime)) +
                 ",\"price\":" + P(HistoryDealGetDouble(deal, DEAL_PRICE)) +
                 ",\"sl\":" + PNull(sl) + ",\"tp\":" + PNull(tp);
   if (!isOpen)
   {
      // Hoa hong tinh tong cac deal cua vi the (mo + dong) de upsert khong ghi de bang so 0.
      double commission = HistoryDealGetDouble(deal, DEAL_COMMISSION);
      double profit = HistoryDealGetDouble(deal, DEAL_PROFIT);
      double swap = HistoryDealGetDouble(deal, DEAL_SWAP);
      if (HistorySelectByPosition(posId))
      {
         commission = 0.0;
         int n = HistoryDealsTotal();
         for (int i = 0; i < n; i++)
         {
            ulong d = HistoryDealGetTicket(i);
            if (d != 0)
               commission += HistoryDealGetDouble(d, DEAL_COMMISSION);
         }
      }
      json += ",\"profit\":" + Num(profit) + ",\"swap\":" + Num(swap) + ",\"commission\":" + Num(commission);
   }
   json += ",\"comment\":" + Q(StringSubstr(HistoryDealGetString(deal, DEAL_COMMENT), 0, 128)) +
           ",\"magic\":" + IntegerToString(HistoryDealGetInteger(deal, DEAL_MAGIC)) + "}";
   return json;
}

void QueueDeal(const ulong deal)
{
   if (HasQueuedDeal(deal))
      return;
   if (!HistoryDealSelect(deal))
   {
      // Lich su chua nap deal nay: nap cua so gan day roi thu lai.
      HistorySelect(TimeCurrent() - 3600, TimeCurrent() + 60);
      if (!HistoryDealSelect(deal))
         return;
   }
   long dtype = HistoryDealGetInteger(deal, DEAL_TYPE);
   if (dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL)
   {
      g_balancePending = true; // nap/rut/credit/hieu chinh: khong co lenh, chi can lam moi snapshot
      return;
   }
   long dealTime = 0;
   string json = BuildDealEvent(deal, dealTime);
   if (StringLen(json) > 0)
      PushEvent(deal, dealTime, json);
}

void QueueModify(const ulong posTicket)
{
   if (!PositionSelectByTicket(posTicket))
      return;
   string json = "{\"kind\":\"modify\",\"deal_ticket\":0" +
                 ",\"position_id\":" + (string)posTicket +
                 ",\"symbol\":" + Q(StringSubstr(PositionGetString(POSITION_SYMBOL), 0, 32)) +
                 ",\"type\":\"" + PositionTypeStr(PositionGetInteger(POSITION_TYPE)) + "\"" +
                 ",\"volume\":" + P(PositionGetDouble(POSITION_VOLUME)) +
                 ",\"time\":" + IntegerToString((long)TimeGMT()) +
                 ",\"sl\":" + PNull(PositionGetDouble(POSITION_SL)) +
                 ",\"tp\":" + PNull(PositionGetDouble(POSITION_TP)) + "}";
   PushEvent(0, 0, json);
}

//--- Doi chieu lich su tu moc ack cuoi: bu su kien bi mat khi EA tat hoac hang doi tran.
void BackfillDeals()
{
   if (g_ackDealTime <= 0)
      return;
   if (!HistorySelect((datetime)g_ackDealTime, TimeCurrent() + 60))
      return;
   int n = HistoryDealsTotal();
   int queued = 0;
   for (int i = 0; i < n && g_nEv < MAX_PENDING_EVENTS; i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if (d == 0 || HasQueuedDeal(d))
         continue;
      long dtype = HistoryDealGetInteger(d, DEAL_TYPE);
      if (dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL)
         continue;
      long dt = 0;
      string json = BuildDealEvent(d, dt);
      if (StringLen(json) > 0)
      {
         PushEvent(d, dt, json);
         queued++;
      }
      // BuildDealEvent da doi cua so lich su (HistorySelectByPosition cho lenh dong): chon lai.
      HistorySelect((datetime)g_ackDealTime, TimeCurrent() + 60);
      n = HistoryDealsTotal();
   }
   if (queued > 0)
      PrintFormat("AZ: doi chieu lich su, them %d su kien chua gui.", queued);
}

string ackVarName()
{
   return "AZS_ack_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
}

void SaveAck(const long dealTime)
{
   if (dealTime > g_ackDealTime)
   {
      g_ackDealTime = dealTime;
      GlobalVariableSet(ackVarName(), (double)dealTime);
   }
}

string ReasonJson()
{
   string r = "";
   if (g_nEv > 0 || g_balancePending)
      r += "\"trade_event\"";
   if (g_riskPending)
      r += (StringLen(r) > 0 ? "," : "") + "\"risk\"";
   return "[" + r + "]";
}

void FlushEvents()
{
   if (g_state == ST_GW_DOWN)
      return; // ping thanh cong se dua ve TRACK, luc do moi gui bu
   if (g_nEv == 0 && !g_balancePending && !g_riskPending)
      return;
   if (GetTickCount64() < g_nextEventMs)
      return;

   int cnt = (g_evInflight > 0) ? g_evInflight : MathMin(g_nEv, EVENTS_PER_REQUEST);
   string events = "[";
   for (int i = 0; i < cnt; i++)
      events += (i > 0 ? "," : "") + g_evJson[i];
   events += "]";

   long seq = g_evSeq + 1;
   string body = "{" + Ident() +
                 ",\"seq\":" + IntegerToString(seq) +
                 ",\"reason\":" + ReasonJson() +
                 ",\"events\":" + events +
                 ",\"snap\":" + SnapJson() + "}";

   string resp;
   int code = HttpPost("/v1/event", body, resp);
   if (code == 200 && JsonInt(resp, "ack_seq", -1) == seq)
   {
      g_lastHttpErr = 0;
      g_failStreak = 0;
      g_lastOkMs = GetTickCount64();
      long maxTime = 0;
      for (int i = 0; i < cnt; i++)
         if (g_evTime[i] > maxTime)
            maxTime = g_evTime[i];
      for (int i = cnt; i < g_nEv; i++)
      {
         g_evJson[i - cnt] = g_evJson[i];
         g_evDeal[i - cnt] = g_evDeal[i];
         g_evTime[i - cnt] = g_evTime[i];
      }
      g_nEv -= cnt;
      g_evInflight = 0;
      g_evSeq = seq;
      g_balancePending = false;
      g_riskPending = false;
      if (maxTime > 0)
         SaveAck(maxTime);
      if (g_evOverflow && g_nEv == 0)
      {
         g_evOverflow = false;
         BackfillDeals();
      }
      return;
   }
   // That bai: giu nguyen lo da dong goi (cung seq) de Gateway loai trung neu lan truoc da toi noi.
   g_evInflight = cnt;
   if (code != 200)
      HandleReply(code, resp);
   g_nextEventMs = GetTickCount64() + 2000;
}

//+------------------------------------------------------------------+
//| Tin hieu dinh ky                                                  |
//+------------------------------------------------------------------+
void CheckConnection()
{
   bool conn = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   if (conn != g_prevConn)
   {
      g_prevConn = conn;
      PrintFormat("AZ: broker %s", conn ? "da noi lai" : "mat ket noi");
      g_nextPingMs = 0; // bao Gateway ngay, khong cho het chu ky ping
   }
}

void CheckMarginAlert()
{
   if (InpMarginLevelAlert <= 0.0 || AccountInfoDouble(ACCOUNT_MARGIN) <= 0.0)
   {
      g_marginAlerted = false;
      return;
   }
   double ml = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   if (ml < InpMarginLevelAlert && !g_marginAlerted)
   {
      g_marginAlerted = true; // chi bao khi cat nguong
      g_riskPending = true;
      PrintFormat("AZ: margin level %.1f%% duoi nguong %.1f%%", ml, InpMarginLevelAlert);
   }
   else if (ml >= InpMarginLevelAlert)
      g_marginAlerted = false;
}

//+------------------------------------------------------------------+
//| Canh bao lo float (Plan 5)                                        |
//+------------------------------------------------------------------+
string epVarName()
{
   return "AZS_ep_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
}

//--- Nguoc lai voi ServerToUtc: doi Unix giay UTC sang gio server broker (de goi HistorySelect).
long UtcToServer(const long t)
{
   long off = (long)(TimeTradeServer() - TimeGMT());
   off = (long)MathRound((double)off / 900.0) * 900; // lam tron 15 phut
   return t + off;
}

//--- Tong lai/lo da chot tu luc bat dau dot: profit + swap + commission + fee cua cac deal dong lenh.
//--- Tra ve false neu khong doc duoc lich su (khi do khong gui closed_pl, khong gui so 0 gia).
bool ClosedPlSince(const long fromUtc, double &sum)
{
   sum = 0.0;
   datetime from = (datetime)UtcToServer(fromUtc - 60);
   datetime to = (datetime)(TimeTradeServer() + 86400);
   if (!HistorySelect(from, to))
      return false;
   int total = HistoryDealsTotal();
   for (int i = 0; i < total; i++)
   {
      ulong deal = HistoryDealGetTicket(i);
      if (deal == 0)
         continue;
      ENUM_DEAL_TYPE type = (ENUM_DEAL_TYPE)HistoryDealGetInteger(deal, DEAL_TYPE);
      if (type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
         continue; // bo nap/rut tien, credit, ...
      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal, DEAL_ENTRY);
      if (entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT && entry != DEAL_ENTRY_OUT_BY)
         continue;
      sum += HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_SWAP) +
             HistoryDealGetDouble(deal, DEAL_COMMISSION) + HistoryDealGetDouble(deal, DEAL_FEE);
   }
   return true;
}

//--- Gui mot bao cao cho Gateway. true khi Gateway da nhan (ack_aseq khop), khong co nghia cloud da nhan.
//--- aseq = max(aseq truoc + 1, TimeGMT()) nen don dieu ca khi EA khoi dong lai.
bool SendAlert(const string kind, const bool hasClosed, const double closedPl)
{
   long aseq = (long)TimeGMT();
   if (aseq <= g_lastAseq)
      aseq = g_lastAseq + 1;
   g_lastAseq = aseq;

   string body = "{" + Ident() +
                 ",\"aseq\":" + IntegerToString(aseq) +
                 ",\"kind\":" + Q(kind) +
                 ",\"ts\":" + IntegerToString((long)TimeGMT()) +
                 ",\"bal\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE)) +
                 ",\"eq\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY)) +
                 ",\"fl\":" + Num(AccountInfoDouble(ACCOUNT_PROFIT)) +
                 ",\"n\":" + IntegerToString(PositionsTotal()) +
                 ",\"ccy\":" + Q(AccountInfoString(ACCOUNT_CURRENCY));
   if (hasClosed)
      body += ",\"closed_pl\":" + Num(closedPl);
   body += "}";

   string resp;
   int code = HttpPost("/v1/alert", body, resp);
   return (code == 200 && JsonInt(resp, "ack_aseq", -1) == aseq);
}

//--- Goi tu OnTimer (moi giay). WebRequest chan luong nen KHONG goi trong OnTradeTransaction.
void CheckLossAlert()
{
   if (g_state == ST_GW_DOWN)
      return; // Gateway khong tra loi: khong chan luong them; thu lai khi ping thanh cong
   ulong now = GetTickCount64();
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double fl = AccountInfoDouble(ACCOUNT_PROFIT);
   int open = PositionsTotal();

   if (open > 0)
      g_zeroTicks = 0;
   else if (g_zeroTicks < 1000)
      g_zeroTicks++;

   // Het lenh trong luc dang co dot: bao "clear" kem lai/lo da chot. Chi xoa co khi Gateway da nhan.
   if (g_inBreach && open == 0)
   {
      if (g_zeroTicks < ALERT_ZERO_TICKS || !(bool)TerminalInfoInteger(TERMINAL_CONNECTED))
         return;
      if (now < g_nextAlertMs)
         return;
      g_nextAlertMs = now + (ulong)ALERT_RETRY_SEC * 1000;
      double pl = 0.0;
      bool has = ClosedPlSince(g_epStartUtc, pl);
      if (SendAlert("clear", has, pl))
      {
         g_inBreach = false;
         GlobalVariableDel(epVarName());
         g_nextAlertMs = 0;
         PrintFormat("AZ: da bao clear lenh, P/L da chot %.2f", pl);
      }
      return;
   }

   bool breach = (g_alertBp > 0 && bal > 0.0 && fl < 0.0 && (-fl / bal) * 10000.0 >= (double)g_alertBp);
   if (!breach)
   {
      g_nextAlertMs = 0; // lan vuot nguong ke tiep bao ngay
      return;
   }

   if (!g_inBreach)
   {
      g_inBreach = true;
      g_epStartUtc = (long)TimeGMT();
      GlobalVariableSet(epVarName(), (double)g_epStartUtc);
      PrintFormat("AZ: lo float vuot nguong %.2f%% Balance", g_alertBp / 100.0);
   }
   if (now < g_nextAlertMs)
      return;
   if (SendAlert("breach", false, 0.0))
      g_nextAlertMs = now + (ulong)ALERT_REPORT_SEC * 1000;
   else
      g_nextAlertMs = now + (ulong)ALERT_RETRY_SEC * 1000;
}

//+------------------------------------------------------------------+
//| Vong doi EA                                                       |
//+------------------------------------------------------------------+
bool AnotherInstanceRunning()
{
   long me = ChartID();
   string name = MQLInfoString(MQL_PROGRAM_NAME);
   for (long id = ChartFirst(); id >= 0; id = ChartNext(id))
   {
      if (id == me)
         continue;
      if (ChartGetString(id, CHART_EXPERT_NAME) == name)
         return true;
   }
   return false;
}

int OnInit()
{
   if (MQLInfoInteger(MQL_TESTER))
   {
      Print("AZ: Strategy Tester khong dung duoc WebRequest, khong gui.");
      return (INIT_SUCCEEDED);
   }
   if (AnotherInstanceRunning())
   {
      Print("AZ: da co mot EA AZ khac dang chay tren terminal nay. Chi gan MOT EA cho moi terminal.");
      return (INIT_FAILED);
   }

   ArrayResize(g_sT, MAX_SAMPLES);
   ArrayResize(g_sEq, MAX_SAMPLES);
   ArrayResize(g_sBal, MAX_SAMPLES);
   ArrayResize(g_sFl, MAX_SAMPLES);
   ArrayResize(g_sMl, MAX_SAMPLES);
   ArrayResize(g_sMg, MAX_SAMPLES);
   ArrayResize(g_evJson, MAX_PENDING_EVENTS);
   ArrayResize(g_evDeal, MAX_PENDING_EVENTS);
   ArrayResize(g_evTime, MAX_PENDING_EVENTS);

   MathSrand((int)(GetTickCount() ^ (uint)TimeLocal() ^ (uint)ChartID()));
   g_sid = StringFormat("%08X", (uint)(GetTickCount() ^ (uint)TimeLocal() ^ (uint)MathRand()));
   g_prevConn = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);

   if (IdentityReady())
   {
      CacheRebuild();
      string v = ackVarName();
      if (GlobalVariableCheck(v))
      {
         g_ackDealTime = (long)GlobalVariableGet(v);
         BackfillDeals(); // bu su kien xay ra luc EA tat
      }
      else
      {
         g_ackDealTime = (long)TimeCurrent(); // cai lan dau: khong bu lich su cu
         GlobalVariableSet(v, (double)g_ackDealTime);
      }
   }

   // Khoi phuc dot canh bao lo float dang mo (EA khoi dong lai giua chung): van bao "clear" khi het lenh.
   if (IdentityReady() && GlobalVariableCheck(epVarName()))
   {
      g_inBreach = true;
      g_epStartUtc = (long)GlobalVariableGet(epVarName());
   }

   // Tre ngau nhien 0 den 5 giay truoc ping dau de nhieu EA khong ban cung luc.
   g_nextPingMs = GetTickCount64() + (ulong)(MathRand() % 5000);

   if (!EventSetTimer(1))
   {
      Print("AZ: EventSetTimer that bai.");
      return (INIT_FAILED);
   }
   if (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      Print("AZ: canh bao: Algo Trading dang tat tren terminal.");
   g_trade.SetDeviationInPoints((ulong)InpSlippagePts);
   g_trade.SetAsyncMode(false);
   g_trade.LogLevel(LOG_LEVEL_ERRORS);
   if (InpAllowRemoteTrading)
      Print("AZ: CANH BAO: da BAT dieu khien lenh tu xa (InpAllowRemoteTrading = true).");
   if (InpAllowRemoteTrading && InpAllowRemoteOpen)
      PrintFormat("AZ: CANH BAO: da BAT MO LENH MOI tu xa (InpAllowRemoteOpen = true, toi da %.2f lot/lenh).", InpMaxRemoteVolume);
   PrintFormat("AZ: bat dau, ver %s, sid %s, Gateway %s", EA_VER, g_sid, InpGateway);
   return (INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

//--- Lay mau va gui khi da toi nhip. Goi tu OnTick (chinh) va OnTimer (du phong); `g_nextSendMs`
//--- chung nen khong bao gio gui nhanh hon interval_ms du hai noi cung goi.
void LiveStep(const ulong now)
{
   if (g_state != ST_LIVE || now < g_nextSendMs)
      return;
   CollectSample();
   SendSamples();
}

void OnTimer()
{
   if (!IdentityReady())
      return;
   ulong now = GetTickCount64();

   CheckConnection();
   CheckMarginAlert();

   if (g_state == ST_LIVE && now - g_lastOkMs > (ulong)g_leaseMs)
   {
      Print("AZ: het lease, ngung gui mau.");
      LeaveLive();
   }

   if (now >= g_nextPingMs)
      DoPing();

   // Du phong: khi khong co tick (thi truong dong/it tick) van gui toi thieu moi interval_ms.
   LiveStep(now);

   FlushEvents();
   CheckLossAlert();
   SendPendingTradeResult();
}

//--- Moi tick: chi lam viec khi dang LIVE va da toi nhip (re khi khong co ai xem).
void OnTick()
{
   if (g_state != ST_LIVE || !IdentityReady())
      return;
   LiveStep(GetTickCount64());
}

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if (!IdentityReady())
      return;
   if (trans.type == TRADE_TRANSACTION_DEAL_ADD && trans.deal > 0)
   {
      QueueDeal(trans.deal);
      CacheRebuild();
   }
   else if (trans.type == TRADE_TRANSACTION_POSITION && trans.position > 0)
   {
      if (!PositionSelectByTicket(trans.position))
         return;
      int i = CacheFind(trans.position);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      if (i < 0)
      {
         CacheRebuild();
         return;
      }
      if (sl != g_pSl[i] || tp != g_pTp[i])
      {
         g_pSl[i] = sl;
         g_pTp[i] = tp;
         QueueModify(trans.position);
      }
   }
   // Gui o OnTimer (toi da 1 giay): WebRequest chan luong, khong goi trong ham xu ly giao dich.
}