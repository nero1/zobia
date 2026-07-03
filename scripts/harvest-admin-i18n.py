#!/usr/bin/env python3
"""
scripts/harvest-admin-i18n.py

One-off tool: scans apps/android/src/**/admin/**/*.tsx (plus TopBar.tsx) for
t('admin.xxx.yyy', 'English default') calls and merges any keys missing from
shared/i18n/locales/en.json. Existing keys are never overwritten. Also pulls
in adminNav.ts's labelKey/labelDefault pairs. Not part of the app build --
a maintenance script, run manually when new admin.* t() calls are added.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID_SRC = ROOT / "apps/android/src"
EN_JSON = ROOT / "shared/i18n/locales/en.json"

# t('admin.foo.bar', 'Default text') or t("admin.foo.bar", "Default text")
# Value may contain escaped quotes of its own type.
T_CALL_RE = re.compile(
    r"""t\(\s*(['"])(admin\.[A-Za-z0-9_.]+)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3""",
    re.DOTALL,
)

NAV_ITEM_RE = re.compile(
    r"""labelKey:\s*(['"])(admin\.[A-Za-z0-9_.]+)\1,\s*labelDefault:\s*(['"])((?:\\.|(?!\3).)*)\3"""
)


def unescape(quote: str, s: str) -> str:
    # Reverse simple JS string escaping for the quote char used and \\, \n
    s = s.replace(f"\\{quote}", quote)
    s = s.replace("\\n", "\n").replace("\\\\", "\\")
    return s


def scan_file(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    found = {}
    for m in T_CALL_RE.finditer(text):
        key, vquote, value = m.group(2), m.group(3), m.group(4)
        found[key] = unescape(vquote, value)
    for m in NAV_ITEM_RE.finditer(text):
        key, vquote, value = m.group(2), m.group(3), m.group(4)
        found[key] = unescape(vquote, value)
    return found


def main() -> int:
    files = list((ANDROID_SRC / "routes" / "admin").rglob("*.tsx"))
    files += list((ANDROID_SRC / "components" / "admin").glob("*.tsx"))
    files += [ANDROID_SRC / "components" / "layout" / "TopBar.tsx"]

    harvested: dict[str, str] = {}
    for f in files:
        if not f.exists():
            continue
        for k, v in scan_file(f).items():
            if k in harvested and harvested[k] != v:
                print(f"WARN: conflicting defaults for {k!r}: {harvested[k]!r} vs {v!r} (from {f})", file=sys.stderr)
                continue
            harvested[k] = v

    existing = json.loads(EN_JSON.read_text(encoding="utf-8"))

    added = {}
    for k, v in sorted(harvested.items()):
        if k not in existing:
            existing[k] = v
            added[k] = v

    EN_JSON.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Harvested {len(harvested)} admin.* keys from {len(files)} files.")
    print(f"Added {len(added)} new keys to {EN_JSON.relative_to(ROOT)}.")
    for k in sorted(added):
        print(f"  + {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
