//+------------------------------------------------------------------+
//| AZ_Spike.mq5 - EA tracking (Plan 3C, patch 10)                    |
//| Chi noi chuyen voi Gateway cuc bo qua HTTP loopback. Khong giu    |
//| khoa Cloudflare, khong biet URL cloud.                            |
//|   TRACK   : ping moi InpPingSec giay, gui event khi co tin hieu.  |
//|   LIVE    : them lay mau 1 giay va gui samples moi interval_ms.   |
//|   GW_DOWN : Gateway khong tra loi, chi ghi nhan cuc bo, ping thua.|
//| Ten file giu nguyen de giu lich su git (Q2); doi ten khi phat hanh|
//+------------------------------------------------------------------+
#property copyright "AZ Team"
#property version "0.20"
#property description "AZ Sentinel tracking EA: ping, samples, event toi Gateway cuc bo"

#define EA_VER "0.2.0"
#define MAX_SAMPLES 20
#define MAX_POSITIONS 200
#define MAX_PENDING_EVENTS 100
#define EVENTS_PER_REQUEST 50

input string InpGateway = "http://127.0.0.1:47800"; // Gateway cuc bo (phai nam trong Allow WebRequest)
input string InpApiKey = "";                        // API key cua lien ket. Khong chia se, khong commit
input int InpPingSec = 5;                           // Nhip ping Gateway (giay, toi thieu 2)
input int InpTimeoutMs = 1000;                      // Timeout WebRequest (ms). Gateway tra loi duoi 50 ms
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
int g_intervalMs = 2000;
int g_leaseMs = 15000;
bool g_prevConn = true;

//--- mau live (mang song song, toi da MAX_SAMPLES)
long g_sT[];
double g_sEq[];
double g_sBal[];
double g_sFl[];
double g_sMl[]; // -1 nghia la null
int g_nSamples = 0;
long g_samplesSeq = 0;
string g_lastPosHash = "";
bool g_sendPositions = true;

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

string Ident()
{
   return "\"v\":1,\"sid\":" + Q(g_sid) + ",\"key\":" + Q(InpApiKey) +
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

   g_intervalMs = (int)MathMin(5000, MathMax(1000, JsonInt(resp, "interval_ms", 2000)));
   g_leaseMs = (int)MathMin(60000, MathMax(5000, JsonInt(resp, "lease_ms", 15000)));

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
      }
      g_nSamples--;
   }
   int k = g_nSamples;
   g_sT[k] = (long)TimeGMT();
   g_sEq[k] = AccountInfoDouble(ACCOUNT_EQUITY);
   g_sBal[k] = AccountInfoDouble(ACCOUNT_BALANCE);
   g_sFl[k] = AccountInfoDouble(ACCOUNT_PROFIT);
   g_sMl[k] = (AccountInfoDouble(ACCOUNT_MARGIN) > 0.0) ? AccountInfoDouble(ACCOUNT_MARGIN_LEVEL) : -1.0;
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
             ",\"ml\":" + ((g_sMl[i] >= 0.0) ? Num(g_sMl[i]) : "null") + "}";
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

void SendSamples()
{
   if (g_nSamples == 0)
      return;
   string hash = "";
   int total = 0;
   bool truncated = false;
   string pos = BuildPositions(hash, total, truncated);

   string body = "{" + Ident() +
                 ",\"seq\":" + IntegerToString(g_samplesSeq + 1) +
                 ",\"samples\":" + SamplesJson();
   bool withPos = g_sendPositions || hash != g_lastPosHash;
   if (withPos)
   {
      body += ",\"positions\":" + pos + ",\"pos_hash\":\"" + hash + "\"" +
              ",\"total_positions\":" + IntegerToString(total);
      if (truncated)
         body += ",\"truncated\":true";
   }
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
   if (StringLen(InpApiKey) == 0)
   {
      Print("AZ: thieu InpApiKey.");
      return (INIT_PARAMETERS_INCORRECT);
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

   // Tre ngau nhien 0 den 5 giay truoc ping dau de nhieu EA khong ban cung luc.
   g_nextPingMs = GetTickCount64() + (ulong)(MathRand() % 5000);

   if (!EventSetTimer(1))
   {
      Print("AZ: EventSetTimer that bai.");
      return (INIT_FAILED);
   }
   if (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      Print("AZ: canh bao: Algo Trading dang tat tren terminal.");
   PrintFormat("AZ: bat dau, ver %s, sid %s, Gateway %s", EA_VER, g_sid, InpGateway);
   return (INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if (!IdentityReady())
      return;
   ulong now = GetTickCount64();

   CheckConnection();
   CheckMarginAlert();

   if (g_state == ST_LIVE)
   {
      CollectSample();
      if (now - g_lastOkMs > (ulong)g_leaseMs)
      {
         Print("AZ: het lease, ngung gui mau.");
         LeaveLive();
      }
   }

   if (now >= g_nextPingMs)
      DoPing();

   if (g_state == ST_LIVE && now >= g_nextSendMs)
      SendSamples();

   FlushEvents();
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