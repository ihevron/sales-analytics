# מערכת ניתוח מכירות

אפליקציית ניתוח מכירות בעברית מלאה, RTL, עם ייבוא Excel, ניתוחים מהירים על בסיס SQLite בדפדפן, ושמירת DB דרך שרת Node.

## הרצה מקומית

```powershell
cd C:\Users\ihevr\Documents\Codex\2026-06-06\build-a-hebrew-sales-analytics-application\outputs\sales-analytics
npm start
```

כתובת מקומית:

```text
http://localhost:4173/
```

## פרודקשן מקומי עם קובץ DB

```powershell
$env:NODE_ENV="production"
$env:PORT="4173"
$env:HOST="0.0.0.0"
$env:DATA_DIR="C:\sales-analytics-data"
npm start
```

ה-DB נשמר ב:

```text
DATA_DIR\sales-analytics.sqlite
```

## Render עם Supabase Storage

זה המסלול המומלץ כשאין Persistent Disk בתוכנית החינמית של Render.
Render מריץ את האפליקציה, ו-Supabase שומר את קובץ ה-SQLite באופן קבוע.

1. צור פרויקט Supabase.
2. ב-Supabase, עבור אל Storage וצור bucket פרטי בשם:

```text
sales-analytics
```

3. ב-Render, הוסף Environment Variables:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_BUCKET=sales-analytics
SUPABASE_DB_OBJECT=sales-analytics.sqlite
NODE_ENV=production
HOST=0.0.0.0
MAX_DB_BYTES=1073741824
```

חשוב: `SUPABASE_SERVICE_ROLE_KEY` הוא סודי. לשים אותו רק ב-Render Environment Variables, לא ב-GitHub ולא בקוד צד לקוח.

## Docker

```powershell
docker build -t hebrew-sales-analytics .
docker run -d --name sales-analytics -p 4173:4173 -v sales-analytics-data:/data hebrew-sales-analytics
```

## Price Audit API

Server-only internal API for supplier price audits. The service role key is read only from environment variables and is never exposed to browser code.

Required environment variables:

```text
SUPABASE_POSTGRES_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_POSTGRES_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
PRICE_AUDIT_API_KEY=choose-a-private-api-key
```

Before using the API, run `supabase/schema.sql` in Supabase SQL Editor. It adds `products.barcode`, creates `supplier_rules`, and seeds the initial supplier rules.

Examples:

```bash
curl -H "Authorization: Bearer $PRICE_AUDIT_API_KEY" \
  "http://localhost:4173/api/price-audit/product?barcode=7290001548950"

curl -H "Authorization: Bearer $PRICE_AUDIT_API_KEY" \
  "http://localhost:4173/api/price-audit/product?itemCode=2165"

curl -X POST "http://localhost:4173/api/price-audit/products/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PRICE_AUDIT_API_KEY" \
  -d '{"items":[{"barcode":"7290001548950","itemCode":"2165"},{"barcode":"7290018704660","itemCode":"M2260"}]}'

curl -H "Authorization: Bearer $PRICE_AUDIT_API_KEY" \
  "http://localhost:4173/api/price-audit/supplier-rules?supplier=Import4U"
```

Vercel:

- Add the same environment variables in Vercel Project Settings.
- The Serverless Functions live under `api/price-audit/...`.
- Deploy the repository root `outputs/sales-analytics`.
- Test the same URLs with the Vercel domain.

בדיקת בריאות:

```text
http://localhost:4173/healthz
```

## הערות שימוש

- ייבוא מכירות או מוצרים דורס את הנתונים הקיימים באותה טבלה.
- המלצות המכירה הידניות נשמרות ואינן נמחקות בייבוא.
- הממוצעים מחושבים לפי חודשים מלאים אחרונים בלבד. חודש נוכחי חלקי לא נכנס לממוצעים.
- אחרי ייבוא מכירות האפליקציה בודקת מחדש אם צריך תיקון הזחת חודש.
- מסכי UI אינם מציגים את טבלת `sales_raw` הגולמית.
