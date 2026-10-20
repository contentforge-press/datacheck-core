/**
 * 共享校验内核 · TypeScript 实现
 *
 * 这是所有产品线共用的核心逻辑：
 *   · n8n 节点
 *   · MCP Server
 *   · 浏览器扩展
 *
 * 设计原则：
 *   1. 零依赖（除标准库），保证能在任何环境跑
 *   2. 纯函数，无副作用，可测试
 *   3. 返回结构化结果，不返回字符串
 *   4. 每个问题都有：行号、列名、原因、修复建议
 */

export type Severity = "high" | "mid" | "low";

export interface Issue {
  /** 问题类型 */
  type: IssueType;
  /** 严重程度 */
  severity: Severity;
  /** 列名 */
  column: string;
  /** 行号（1-based，含表头则从 2 开始） */
  row: number;
  /** 原始值 */
  value: string;
  /** 为什么这是问题 */
  reason: string;
  /** 怎么修 */
  fix: string;
}

export type IssueType =
  | "duplicate_row"
  | "duplicate_key"
  | "empty_required"
  | "placeholder_value"
  | "invalid_number"
  | "invalid_date"
  | "impossible_date"
  | "money_parse"
  | "inconsistent_type"
  | "whitespace"
  | "case_inconsistent";

export interface ColumnProfile {
  name: string;
  index: number;
  /** 推断出的类型 */
  inferredType: "string" | "number" | "date" | "money" | "mixed" | "empty";
  totalRows: number;
  emptyCount: number;
  uniqueCount: number;
  /** 类型不一致的比例 */
  typeMismatchRate: number;
  samples: string[];
}

export interface ValidationResult {
  /** 健康分 0-100 */
  score: number;
  totalRows: number;
  totalColumns: number;
  /** 每个问题按列聚合 */
  issues: Issue[];
  /** 按严重度统计 */
  counts: { high: number; mid: number; low: number };
  /** 列画像 */
  columns: ColumnProfile[];
  /** 会被静默丢弃的行 */
  lossyRows: number[];
  /** 一句话总结 */
  summary: string;
}

/** 解析 CSV（支持引号、转义、换行） */
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        field = "";
        if (cur.some((x) => x !== "")) lines.push(cur);
        cur = [];
      } else if (c === "\r") {
        // 忽略
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || cur.length) {
    cur.push(field);
    if (cur.some((x) => x !== "")) lines.push(cur);
  }

  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim());
  const rows = lines.slice(1);
  // 补齐列数
  for (const r of rows) {
    while (r.length < headers.length) r.push("");
  }
  return { headers, rows };
}

/** 判断日期是否真实存在（能解析但不存在的日期是隐形杀手） */
export function checkDate(raw: string): { valid: boolean; reason?: string } {
  const s = raw.trim();
  if (!s) return { valid: true };

  let y = 0, mo = 0, d = 0, m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    y = +m[3]; mo = +m[1]; d = +m[2];
  } else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else {
    return { valid: false, reason: "unparseable date format" };
  }

  if (mo < 1 || mo > 12) {
    return { valid: false, reason: `month ${mo} is invalid` };
  }
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d < 1 || d > daysInMonth) {
    return { valid: false, reason: `day ${d} does not exist in ${y}-${mo}` };
  }
  return { valid: true };
}

/** 解析金额（处理 $1,250.00 / (1,300) / 1.2k / 百分比） */
export function parseMoney(raw: string): { ok: boolean; value?: number } {
  const s = raw.trim();
  if (!s) return { ok: true };

  // 括号表示负数
  const negative = /^\(.*\)$/.test(s);
  // 去掉货币符号、逗号、空格
  let t = s.replace(/^\(/, "").replace(/\)$/, "").replace(/[$€£¥,\s]/g, "");

  // k/m 后缀
  let multiplier = 1;
  if (/k$/i.test(t)) { multiplier = 1000; t = t.slice(0, -1); }
  if (/m$/i.test(t)) { multiplier = 1e6; t = t.slice(0, -1); }

  if (!/^-?\d*\.?\d+$/.test(t)) return { ok: false };
  const v = parseFloat(t) * multiplier;
  return { ok: true, value: negative ? -v : v };
}

/** 常见占位符（看起来有值，其实没有） */
const PLACEHOLDERS = new Set([
  "n/a", "na", "n.a.", "null", "nil", "none", "-", "--", "—",
  "unknown", "tbd", "tba", "#n/a", "#value!", "nan", "undefined",
]);

function isPlaceholder(v: string): boolean {
  return PLACEHOLDERS.has(v.trim().toLowerCase());
}

/** 推断列类型 */
function inferColumnType(values: string[]): ColumnProfile["inferredType"] {
  const nonEmpty = values.filter((v) => v.trim() !== "" && !isPlaceholder(v));
  if (!nonEmpty.length) return "empty";

  let num = 0, date = 0, money = 0;
  for (const v of nonEmpty) {
    if (checkDate(v).valid) date++;
    if (parseMoney(v).ok && /[\d$€£¥]/.test(v)) {
      money++;
      num++;
    } else if (/^-?\d*\.?\d+$/.test(v.trim())) {
      num++;
    }
  }
  const n = nonEmpty.length;
  if (date / n > 0.8) return "date";
  if (/[$€£¥,]/.test(nonEmpty.join("")) && money / n > 0.8) return "money";
  if (num / n > 0.8) return "number";
  if (num / n > 0.2 && num / n < 0.8) return "mixed";
  return "string";
}

/**
 * 主校验函数
 */
export function validate(
  csvText: string,
  options: {
    /** 必填列名 */
    requiredColumns?: string[];
    /** 主键列名（用于查重复） */
    keyColumn?: string;
  } = {}
): ValidationResult {
  const { headers, rows } = parseCSV(csvText);
  const issues: Issue[] = [];

  if (!headers.length) {
    return {
      score: 100, totalRows: 0, totalColumns: 0, issues: [],
      counts: { high: 0, mid: 0, low: 0 }, columns: [],
      lossyRows: [], summary: "No data",
    };
  }

  // ---------- 列画像 ----------
  const columns: ColumnProfile[] = headers.map((name, idx) => {
    const values = rows.map((r) => r[idx] ?? "");
    const nonEmpty = values.filter((v) => v.trim() !== "" && !isPlaceholder(v));
    const uniq = new Set(nonEmpty.map((v) => v.trim()));
    const inferred = inferColumnType(values);

    // 类型不一致检测
    let mismatch = 0;
    if (inferred === "number") {
      for (const v of nonEmpty) {
        if (!/^-?\d*\.?\d+$/.test(v.trim()) && !parseMoney(v).ok) mismatch++;
      }
    } else if (inferred === "date") {
      for (const v of nonEmpty) if (!checkDate(v).valid) mismatch++;
    }

    return {
      name, index: idx, inferredType: inferred,
      totalRows: rows.length,
      emptyCount: values.length - nonEmpty.length,
      uniqueCount: uniq.size,
      typeMismatchRate: nonEmpty.length ? mismatch / nonEmpty.length : 0,
      samples: nonEmpty.slice(0, 3),
    };
  });

  // ---------- 1. 完全重复的行 ----------
  const seenRows = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = r.join("\u0001");
    if (seenRows.has(key)) {
      issues.push({
        type: "duplicate_row", severity: "high",
        column: "(whole row)", row: i + 2, value: r.slice(0, 3).join(","),
        reason: `identical to row ${seenRows.get(key)! + 2}`,
        fix: "remove the duplicate row, or add a unique identifier",
      });
    } else {
      seenRows.set(key, i);
    }
  });

  // ---------- 2. 主键重复 ----------
  if (options.keyColumn) {
    const ki = headers.findIndex(
      (h) => h.toLowerCase() === options.keyColumn!.toLowerCase()
    );
    if (ki >= 0) {
      const seenKey = new Map<string, number>();
      rows.forEach((r, i) => {
        let v = (r[ki] ?? "").trim().toLowerCase();
        // 归一化：去字母前缀的前导零（A-001 == A-1）
        const km = v.match(/^([a-z]+)-?(\\d+)\$/);
        if (km) {
          v = km[1] + "-" + parseInt(km[2], 10);
        } else {
          v = v.replace(/^0+(?=\\d)/, "");
        }
        if (!v) return;
        if (seenKey.has(v)) {
          issues.push({
            type: "duplicate_key", severity: "high",
            column: headers[ki], row: i + 2, value: r[ki],
            reason: `key repeats (first seen at row ${seenKey.get(v)! + 2})`,
            fix: "a join on this column will produce duplicate output rows",
          });
        } else {
          seenKey.set(v, i);
        }
      });
    }
  }

  // ---------- 3. 占位符 ----------
  rows.forEach((r, i) => {
    r.forEach((v, ci) => {
      if (isPlaceholder(v)) {
        issues.push({
          type: "placeholder_value", severity: "mid",
          column: headers[ci], row: i + 2, value: v,
          reason: `"${v.trim()}" looks like a value but is a placeholder`,
          fix: "replace with empty string, or fill the real value",
        });
      }
    });
  });

  // ---------- 4. 必填列为空 ----------
  for (const rc of options.requiredColumns ?? []) {
    const ci = headers.findIndex((h) => h.toLowerCase() === rc.toLowerCase());
    if (ci < 0) continue;
    rows.forEach((r, i) => {
      const v = (r[ci] ?? "").trim();
      if (!v || isPlaceholder(v)) {
        issues.push({
          type: "empty_required", severity: "high",
          column: headers[ci], row: i + 2, value: v,
          reason: "required column is empty",
          fix: "fill it, or the row may be silently dropped downstream",
        });
      }
    });
  }

  // ---------- 5. 按列类型检查 ----------
  for (const col of columns) {
    if (col.inferredType === "empty" || col.inferredType === "string") continue;

    rows.forEach((r, i) => {
      const v = (r[col.index] ?? "").trim();
      if (!v || isPlaceholder(v)) return;

      if (col.inferredType === "date") {
        const d = checkDate(v);
        if (!d.valid) {
          issues.push({
            type: d.reason?.includes("does not exist") ? "impossible_date" : "invalid_date",
            severity: "high",
            column: col.name, row: i + 2, value: v,
            reason: d.reason ?? "unparseable date",
            fix: "normalize to YYYY-MM-DD, then re-validate",
          });
        }
      } else if (col.inferredType === "number" || col.inferredType === "money") {
        const ok = /^-?\d*\.?\d+$/.test(v) || parseMoney(v).ok;
        if (!ok) {
          issues.push({
            type: "invalid_number", severity: "high",
            column: col.name, row: i + 2, value: v,
            reason: `column is ${col.inferredType} but this value is not`,
            fix: "this row will fail a numeric cast and may vanish",
          });
        }
      }
    });
  }

  // ---------- 6. 空白与大小写 ----------
  rows.forEach((r, i) => {
    r.forEach((v, ci) => {
      if (v !== v.trim() && v.trim() !== "") {
        issues.push({
          type: "whitespace", severity: "low",
          column: headers[ci], row: i + 2, value: v,
          reason: "leading or trailing whitespace",
          fix: "breaks string joins and unique constraints",
        });
      }
    });
  });

  // ---------- 统计 ----------
  const counts = { high: 0, mid: 0, low: 0 };
  for (const it of issues) counts[it.severity]++;

  // 会被静默丢弃的行：有 high 问题的行
  const lossySet = new Set<number>();
  for (const it of issues) {
    if (it.severity === "high") lossySet.add(it.row);
  }
  const lossyRows = Array.from(lossySet).sort((a, b) => a - b);

  // 健康分
  const rowCount = Math.max(rows.length, 1);
  const penalty =
    (counts.high * 100) / rowCount * 0.8 +
    (counts.mid * 100) / rowCount * 0.35 +
    (counts.low * 100) / rowCount * 0.1;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  let summary = "";
  if (score >= 95) summary = "Clean. Nothing would break downstream.";
  else if (score >= 80) summary = "Minor issues. Safe to process with care.";
  else if (score >= 60) summary = "Real problems. Some rows would be silently lost.";
  else summary = "Serious problems. Do not load this as-is.";

  return {
    score, totalRows: rows.length, totalColumns: headers.length,
    issues, counts, columns, lossyRows, summary,
  };
}

/** 导出可读报告 */
export function toMarkdown(r: ValidationResult): string {
  const lines: string[] = [];
  lines.push(`# Data Health Report`);
  lines.push("");
  lines.push(`**Score: ${r.score}/100** — ${r.summary}`);
  lines.push("");
  lines.push(`- Rows: ${r.totalRows}`);
  lines.push(`- Columns: ${r.totalColumns}`);
  lines.push(`- High severity: ${r.counts.high}`);
  lines.push(`- Rows that would be lost: ${r.lossyRows.length}`);
  lines.push("");
  if (r.issues.length) {
    lines.push(`## Issues`);
    lines.push("");
    lines.push(`| Row | Column | Value | Problem | Fix |`);
    lines.push(`|---|---|---|---|---|`);
    for (const it of r.issues.slice(0, 100)) {
      lines.push(
        `| ${it.row} | ${it.column} | \`${it.value.slice(0, 20)}\` | ${it.reason} | ${it.fix} |`
      );
    }
    if (r.issues.length > 100) {
      lines.push(`| … | | | ${r.issues.length - 100} more | |`);
    }
  }
  return lines.join("\n");
}
