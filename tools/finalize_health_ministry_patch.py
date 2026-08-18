from pathlib import Path

path = Path("health-ministry-src/health-ministry.js")
js = path.read_text(encoding="utf-8")

replacements = [
    (
        '''      console.warn("לא ניתן היה להעביר את הנתונים הקבועים המקומיים ל-Supabase", error);\n    }''',
        '''      console.warn("לא ניתן היה להעביר את הנתונים הקבועים המקומיים ל-Supabase", error);\n      payload.settings = localFixed;\n    }''',
        "fixed fallback",
    ),
    (
        '''      console.warn("לא ניתן היה להעביר את רשימת החסומים המקומית ל-Supabase", error);\n    }''',
        '''      console.warn("לא ניתן היה להעביר את רשימת החסומים המקומית ל-Supabase", error);\n      payload.rules = localRules;\n    }''',
        "rules fallback",
    ),
    (
        '''  const response = await healthMinistryApi("/customers/replace", {\n    method: "POST",\n    body: JSON.stringify({ customers, fileName }),\n  });\n  state.datasetMeta.customers = {''',
        '''  const response = await healthMinistryApi("/customers/replace", {\n    method: "POST",\n    body: JSON.stringify({ customers, fileName }),\n  });\n  state.cloudLoaded = true;\n  state.datasetMeta.customers = {''',
        "customers cloud flag",
    ),
    (
        '''  const response = await healthMinistryApi("/cities/replace", {\n    method: "POST",\n    body: JSON.stringify({ cities, fileName }),\n  });\n  state.datasetMeta.cities = {''',
        '''  const response = await healthMinistryApi("/cities/replace", {\n    method: "POST",\n    body: JSON.stringify({ cities, fileName }),\n  });\n  state.cloudLoaded = true;\n  state.datasetMeta.cities = {''',
        "cities cloud flag",
    ),
    (
        '''    saveFixedFields();\n    const parsed = await ensureParsedData();''',
        '''    saveFixedFields();\n    await saveFixedFieldsToCloud({ silent: true });\n    const parsed = await ensureParsedData();''',
        "report saves fixed fields",
    ),
]

for old, new, label in replacements:
    if old not in js:
        raise SystemExit(f"{label}: marker not found")
    js = js.replace(old, new, 1)

path.write_text(js, encoding="utf-8")
print("Finalized Ministry of Health Supabase frontend behavior")
