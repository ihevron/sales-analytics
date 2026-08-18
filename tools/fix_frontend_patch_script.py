from pathlib import Path

path = Path("tools/patch_health_ministry_frontend.py")
text = path.read_text(encoding="utf-8")
replacements = {
    'cloud_block + "function ruleMatches("': 'cloud_block',
    'fixed_block + "function updateCustomerDatalist() {"': 'fixed_block',
    'file_change_block + "function resetRuleForm() {"': 'file_change_block',
    'render_rules_block + "function normalizeImportHeader(value) {"': 'render_rules_block',
    'import_rules_block + "function renderSimpleTable("': 'import_rules_block',
    'ensure_block + "async function processFiles() {"': 'ensure_block',
    "init_block + 'if (typeof module !== \"undefined\" && module.exports) {'": 'init_block',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"missing patch expression: {old}")
    text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print("Corrected frontend patch boundary handling")
