# DataCheck Core

The data validation engine behind four products.

**Catches the failures that do not throw errors.**

---

## The problem

Every pipeline assumes clean input. Real data isn't clean, and the worst failures are the quiet ones:

| What happens | Why it's dangerous |
|---|---|
| `2026-02-30` appears in a date column | Most parsers accept it. The row lands in your database with a nonsense date. |
| `"$1,250.00"` in a numeric column | `Number()` returns `NaN`. `NaN` becomes `null` on write. The amount silently disappears. |
| The same key appears twice | Your join duplicates every row. Reports double. Nobody notices for weeks. |
| `N/A` where you expected empty | Passes a null check. Poisons the join. |
| `"A-1001 "` with trailing space | `"A-1001 "` ≠ `"A-1001"`. `Merge` returns zero rows and no error. |

None of these throw. They just make your output wrong.

## What it checks

**Free tier:**

- Duplicate rows (byte-identical)
- Duplicate key values (with normalization: `A-001` == `A-1`)
- Empty required fields
- Placeholder values (`N/A`, `null`, `-`, `TBD`, `#VALUE!`)
- Values that fail numeric parsing in a numeric column
- **Dates that parse but do not exist** (`2026-02-30`, `2026-13-45`, `2025-02-29`)
- Leading/trailing whitespace that breaks string joins

**Pro tier:** cross-table consistency, alerting, time-series validation, 5M+ rows.

## Output

Every issue carries four fields:

```json
{
  "type": "impossible_date",
  "severity": "high",
  "column": "date",
  "row": 8,
  "value": "2026/13/45",
  "reason": "month 13 is invalid",
  "fix": "normalize to YYYY-MM-DD, then re-validate"
}
```

Plus a health score and the exact rows that would be silently lost:

```json
{
  "score": 48,
  "summary": "Serious problems. Do not load this as-is.",
  "counts": { "high": 4, "mid": 1, "low": 1 },
  "lossy_rows": [4, 5, 8]
}
```

## Three implementations, one behavior

| File | Language | Used by |
|---|---|---|
| `validator.ts` | TypeScript | n8n node, browser extension |
| `validator.js` | JavaScript | n8n node, MCP server |
| `validator.py` | Python | CLI, MCP server (Python) |

All three produce identical output for identical input — verified by tests.

## Usage

### Python

```python
from validator import validate

result = validate(csv_text, key_column="order_id", required_columns=["email"])

print(result.score, result.counts)
for issue in result.issues:
    print(f"row {issue.row} {issue.column}: {issue.reason}")
    print(f"  fix: {issue.fix}")
```

### JavaScript

```js
const { validate } = require("./validator.js");

const result = validate(csvText, {
  keyColumn: "order_id",
  requiredColumns: ["email"],
});
```

## Products built on this

| Product | Channel | Link |
|---|---|---|
| n8n node | npm / GitHub | [n8n-nodes-datacheck](https://github.com/contentforge-press/n8n-nodes-datacheck) |
| Python CLI | PyPI / GitHub | [dvq](https://github.com/contentforge-press/dvq) |
| MCP server | MCP registry | [datacheck-mcp](https://github.com/contentforge-press/datacheck-mcp) |
| Browser extension | Chrome Web Store | [Data Health Check](https://contentforge-press.github.io/data-health-check/) |

## Tests

```bash
python test_validator.py     # 36 checks
node ../n8n-node/test/run.js # 25 checks
```

## License

MIT

---

## All DataCheck tools

| Tool | Install | Docs |
|---|---|---|
| **n8n node** | `npm install n8n-nodes-datacheck` | [docs](https://contentforge-press.github.io/n8n-nodes-datacheck/) |
| **MCP server** | `npm install -g datacheck-mcp` | [docs](https://contentforge-press.github.io/datacheck-mcp/) |
| **Python CLI** | [git clone](https://github.com/contentforge-press/dvq) | [docs](https://contentforge-press.github.io/dvq/) |
| **Core library** | [git clone](https://github.com/contentforge-press/datacheck-core) | [docs](https://contentforge-press.github.io/datacheck-core/) |
| **Browser check** | no install | [try it](https://contentforge-press.github.io/data-health-check/) |

Product home: [datacheck.pixharvest.com](https://datacheck.pixharvest.com)
