import path from "path";

const LEVEL_TO_CMD = {
  error: "error",
  warning: "warning",
  info: "notice",
};

const LEVEL_SYMBOL = {
  error: "✗",
  warning: "⚠",
  info: "ℹ",
};

function escapeMessage(msg) {
  return String(msg).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * GitHub Actions workflow-command output, one line per finding.
 * GitHub parses `::level file=...::message` from step stdout and attaches
 * it to the commit. Without `file`, the annotation shows at the top of the
 * job log (still visible). `line=` pins inline in Files Changed.
 */
export function formatGitHub(findings, { cwd = process.cwd() } = {}) {
  const out = [];
  for (const f of findings) {
    const cmd = LEVEL_TO_CMD[f.level] || "notice";
    const props = [`title=claude-code-vault/${f.code}`];
    if (f.file) {
      const parts = [`file=${path.relative(cwd, f.file)}`];
      if (Number.isInteger(f.line) && f.line > 0) parts.push(`line=${f.line}`);
      props.unshift(...parts);
    }
    out.push(`::${cmd} ${props.join(",")}::${escapeMessage(f.message)}`);
  }
  return out;
}

export function formatJson(findings) {
  return JSON.stringify(findings, null, 2);
}

export function formatText(findings, { cwd = process.cwd() } = {}) {
  if (findings.length === 0) return "✓ No issues found.";
  const byLevel = { error: 0, warning: 0, info: 0 };
  for (const f of findings) byLevel[f.level] = (byLevel[f.level] ?? 0) + 1;

  const lines = [];
  for (const f of findings) {
    const sym = LEVEL_SYMBOL[f.level] ?? "·";
    const loc = f.file
      ? `${path.relative(cwd, f.file)}${f.line ? `:${f.line}` : ""}`
      : f.noteId;
    lines.push(`${sym} [${f.code}] ${loc}`);
    lines.push(`    ${f.message}`);
  }
  lines.push("");
  lines.push(
    `${byLevel.error} error(s), ${byLevel.warning} warning(s), ${byLevel.info} info`
  );
  return lines.join("\n");
}
