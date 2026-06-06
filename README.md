# מערכת ניתוח מכירות

אפליקציית ניתוח מכירות בעברית מלאה, RTL, עם ייבוא Excel, SQL מקומי בדפדפן ו-DB משותף דרך שרת Node.

## הרצה מקומית

```powershell
cd C:\Users\ihevr\Documents\Codex\2026-06-06\build-a-hebrew-sales-analytics-application\outputs\sales-analytics
npm start
```

כתובת מקומית:

```text
http://localhost:4173/
```

כתובת למובייל באותה רשת:

```text
http://192.168.7.14:4173/
```

## הרצת פרודקשן בשרת

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

חשוב להגדיר את `DATA_DIR` לתיקייה קבועה שמגובה ולא נמחקת בפריסה.

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

- ייבוא מכירות ומוצרים דורס את הנתונים הקיימים באותה טבלה.
- ההמלצות הידניות נשמרות ואינן נמחקות בייבוא.
- הממוצעים מחושבים לפי חודשים מלאים אחרונים בלבד. חודש נוכחי חלקי לא נכנס לממוצעים.
- מסכי UI אינם מציגים את טבלת `sales_raw` הגולמית.
- קובצי Excel נקראים באמצעות SheetJS, והאגרגציות מתבצעות ב-sql.js.
