/**
 * Per-type note schemas — rules the linter enforces and templates the CLI
 * scaffolds. The schema for each type is intentionally minimal: just the
 * structure that materially improves retrieval (so chunks have predictable
 * breadcrumbs and bold labels are findable by keyword search).
 *
 * Types not listed here (overview, architecture, research) have no body
 * schema — only the universal frontmatter rules apply.
 */

export const SCHEMAS = {
  adr: {
    requiredHeadings: ["Context", "Decision", "Alternatives", "Consequences"],
  },
  feature: {
    requiredHeadings: ["What", "Why", "How"],
  },
  runbook: {
    requiredHeadings: ["Steps"],
    requiredSubsection: "Verify",
  },
  gotcha: {
    requiredBoldLabels: ["Symptom", "Cause", "Fix"],
  },
  glossary: {
    requiresFrontmatterTerms: true,
  },
};

const today = () => new Date().toISOString().split("T")[0];

export function templateFor(type, title) {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
  const fm = (extra = "") =>
    `---
title: ${title}
type: ${type}
status: current
date: ${today()}
lastVerified: ${today()}
description: ""
summary: ""
tags: [${slug}]${extra}
---

# ${title}
`;

  switch (type) {
    case "adr":
      return (
        fm() +
        `\n## Context\n\nWhat was the situation that forced a decision?\n\n## Decision\n\nWhat did we decide?\n\n## Alternatives\n\nWhat else did we consider, and why did we reject it?\n\n## Consequences\n\nWhat are the trade-offs we accept?\n`
      );
    case "feature":
      return (
        fm() +
        `\n## What\n\nWhat does this feature do, in one paragraph?\n\n## Why\n\nWhy did we build it? What problem does it solve?\n\n## How\n\nHow does it work? Cover the user-visible flow and any non-obvious internals.\n`
      );
    case "runbook":
      return (
        fm() +
        `\n## Steps\n\n### 1. First step\n\nWhat to do.\n\n### Verify\n\nHow to confirm the step succeeded.\n\n### 2. Second step\n\nWhat to do.\n\n### Verify\n\nHow to confirm the step succeeded.\n`
      );
    case "gotcha":
      return (
        fm() +
        `\n## First gotcha\n\n**Symptom**: What the user sees.\n\n**Cause**: Why it happens.\n\n**Fix**: What to do about it.\n`
      );
    case "glossary":
      return (
        `---
title: ${title}
type: glossary
status: current
date: ${today()}
lastVerified: ${today()}
description: ""
summary: ""
tags: [${slug}, glossary]
terms: [TermOne, TermTwo]
---

# ${title}

## TermOne

Definition for TermOne.

## TermTwo

Definition for TermTwo.
`
      );
    default:
      return fm();
  }
}
