//+------------------------------------------------------------------+
//| AZ_Spike.mq5 - Part 1 (P1-26): EA spike gửi JSON tài khoản        |
//| Mỗi InpIntervalSec giây POST lên /api/ea/v1/ingest, in mã trả về. |
//| SPIKE: không dùng cho production. Xóa/thay ở Part 6.              |
//+------------------------------------------------------------------+
#property copyright "AZ Team"
#property version "0.01"
#property description "AZ Sentinel spike: gui heartbeat tai khoan qua WebRequest"

input string InpUrl = "";          // URL day du, vd https://<ten>.workers.dev/api/ea/v1/ingest
input string InpApiKey = "";       // API key (X-API-Key). Khong chia se, khong commit
input int InpIntervalSec = 10;     // Nhip gui (giay)
input int InpTimeoutMs = 3000;     // Timeout WebRequest (ms)
input string InpVps = "spike-vps"; // Nhan may VPS (toi da 64 ky tu)

string g_sid;
ulong g_seq = 0;

//--- Escape chuoi cho JSON: dau nhay, gach cheo nguoc, ky tu dieu khien
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

string Num(const double v)
{
   return DoubleToString(v, 2); // luon dung dau cham thap phan
}

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

string MarginModeStr()
{
   switch ((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE))
   {
   case ACCOUNT_MARGIN_MODE_RETAIL_HEDGING:
      return "hedging";
   case ACCOUNT_MARGIN_MODE_EXCHANGE:
      return "exchange";
   default:
      return "netting";
   }
}

//--- Payload ingest v1 toi thieu (heartbeat, khong co lenh)
string BuildPayload()
{
   g_seq++;
   double margin = AccountInfoDouble(ACCOUNT_MARGIN);
   string level = (margin > 0.0) ? Num(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL)) : "null";

   string acc = "{";
   acc += "\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   acc += "\"name\":\"" + JsonEscape(AccountInfoString(ACCOUNT_NAME)) + "\",";
   acc += "\"broker\":\"" + JsonEscape(AccountInfoString(ACCOUNT_COMPANY)) + "\",";
   acc += "\"server\":\"" + JsonEscape(AccountInfoString(ACCOUNT_SERVER)) + "\",";
   acc += "\"currency\":\"" + JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)) + "\",";
   acc += "\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   acc += "\"mode\":\"" + AccountModeStr() + "\",";
   acc += "\"margin_mode\":\"" + MarginModeStr() + "\",";
   acc += "\"balance\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE)) + ",";
   acc += "\"equity\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY)) + ",";
   acc += "\"margin\":" + Num(margin) + ",";
   acc += "\"margin_free\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN_FREE)) + ",";
   acc += "\"margin_level\":" + level + ",";
   acc += "\"floating_pl\":" + Num(AccountInfoDouble(ACCOUNT_PROFIT));
   acc += "}";

   string body = "{";
   body += "\"v\":1,";
   body += "\"sid\":\"" + g_sid + "\",";
   body += "\"seq\":" + IntegerToString((long)g_seq) + ",";
   body += "\"reason\":[\"heartbeat\"],";
   body += "\"ts_utc\":" + IntegerToString((long)TimeGMT()) + ",";
   body += "\"vps\":\"" + JsonEscape(InpVps) + "\",";
   body += "\"ea_ver\":\"spike-0.01\",";
   body += "\"account\":" + acc + ",";
   body += "\"positions\":[],";
   body += "\"events\":[]";
   body += "}";
   return body;
}

void SendOnce()
{
   if (StringLen(InpUrl) == 0 || StringLen(InpApiKey) == 0)
   {
      Print("AZ_Spike: thieu InpUrl hoac InpApiKey, khong gui.");
      return;
   }

   string body = BuildPayload();
   char data[];
   char result[];
   string resHeaders;

   int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if (n > 0)
      ArrayResize(data, n - 1); // bo ky tu ket thuc chuoi

   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n";

   ResetLastError();
   uint t0 = GetTickCount();
   int code = WebRequest("POST", InpUrl, headers, InpTimeoutMs, data, result, resHeaders);
   uint ms = GetTickCount() - t0;

   if (code == -1)
   {
      int err = GetLastError();
      PrintFormat("AZ_Spike: seq=%I64u WebRequest LOI GetLastError()=%d (%u ms)", g_seq, err, ms);
      if (err == 4014)
         Print("AZ_Spike: URL chua duoc cho phep. Them URL vao Tools > Options > Expert Advisors > Allow WebRequest.");
      return;
   }

   string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   PrintFormat("AZ_Spike: seq=%I64u http=%d (%u ms) body=%s", g_seq, code, ms, StringSubstr(resp, 0, 300));
}

int OnInit()
{
   if (MQLInfoInteger(MQL_TESTER))
   {
      Print("AZ_Spike: Strategy Tester khong dung duoc WebRequest, khong gui.");
      return (INIT_SUCCEEDED);
   }
   g_sid = StringFormat("%08X", (uint)(GetTickCount() ^ (uint)TimeLocal()));
   if (!EventSetTimer(MathMax(1, InpIntervalSec)))
   {
      Print("AZ_Spike: EventSetTimer that bai.");
      return (INIT_FAILED);
   }
   PrintFormat("AZ_Spike: bat dau, sid=%s, moi %d giay.", g_sid, InpIntervalSec);
   return (INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   SendOnce();
}
