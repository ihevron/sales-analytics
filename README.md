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
