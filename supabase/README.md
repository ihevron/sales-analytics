# Supabase Postgres migration draft

This folder prepares a parallel Supabase Postgres setup without deleting or replacing the existing SQLite/Render flow.

## Safe migration order

1. Keep Render and the current SQLite file active.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Run the migration script with a service-role key:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
npm run migrate:supabase
```

4. Compare row counts in Supabase against the SQLite source.
5. Switch one app screen to Postgres read mode for testing.
6. Only after all workflows pass, remove the Render dependency.

Do not expose the service-role key in browser code.
