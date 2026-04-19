#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "module";
import { Vault } from "./lib/vault.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name("claude-code-vault")
  .description("Markdown knowledge vault for Claude")
  .version(pkg.version)
  .option("--vault <dir>", "Vault directory", "./vault");

// ===== INIT =====
program
  .command("init [project]")
  .description("Initialize a new vault project")
  .action(async (projectName) => {
    const vaultDir = program.opts().vault;
    const project = projectName || path.basename(process.cwd());
    const projectPath = path.join(vaultDir, project);

    try {
      await fs.stat(projectPath);
      console.warn(`⚠ Vault already exists at ${projectPath}`);
      return;
    } catch {
      // Doesn't exist, proceed
    }

    // Create type-first folder structure
    for (const folder of ["adrs", "designs", "features", "gotchas", "research", "go-to-market"]) {
      await fs.mkdir(path.join(projectPath, folder), { recursive: true });
    }

    // Create VAULT_SUMMARY.md
    const summaryPath = path.join(projectPath, "VAULT_SUMMARY.md");
    await fs.writeFile(
      summaryPath,
      `---
title: Vault Index
tags: [${project}, vault, index]
date: ${new Date().toISOString().split("T")[0]}
description: Knowledge vault for ${project}
---

# ${project} Vault

Navigation guide for this project's knowledge base.

## 📚 Structure

- **\`adrs/\`** — Architecture Decision Records
- **\`designs/\`** — system/architecture designs
- **\`features/\`** — user-facing feature specs
- **\`gotchas/\`** — non-obvious traps, read before shipping
- **\`research/\`** — market, user, prior-art research
- **\`go-to-market/\`** — pricing, positioning, rollout

## 🚀 Getting Started

1. Read \`overview.md\` for a quick intro
2. Add notes to the folder matching their type
3. Use \`[[wikilinks]]\` to connect related notes
4. Run \`claude-code-vault check\` to validate

## 🔗 See Also

- \`overview.md\` — project overview
`
    );

    // Create overview.md
    const overviewPath = path.join(projectPath, "overview.md");
    await fs.writeFile(
      overviewPath,
      `---
title: Overview
tags: [${project}, overview]
date: ${new Date().toISOString().split("T")[0]}
description: Project overview for ${project}
---

# ${project} Overview

## What is this?

Start here. Briefly describe the project.

## Key facts

- **Tech stack**: ...
- **Team**: ...
- **Status**: ...

## Next steps

1. Add design docs to \`designs/\`, decisions to \`adrs/\`
2. Add research to \`research/\`
3. Add pricing/positioning/rollout info to \`go-to-market/\`
`
    );

    console.log(`✓ Created vault at ${projectPath}`);
    console.log(`  - ${path.join(project, "VAULT_SUMMARY.md")}`);
    console.log(`  - ${path.join(project, "overview.md")}`);
    for (const folder of ["adrs", "designs", "features", "gotchas", "research", "go-to-market"]) {
      console.log(`  - ${path.join(project, folder + "/")}`);
    }

    const mcpPath = path.resolve(".mcp.json");
    try {
      await fs.access(mcpPath);
      console.log(`ℹ .mcp.json already exists — leaving it alone`);
    } catch {
      const relVault = path.relative(process.cwd(), path.resolve(vaultDir)) || ".";
      const mcpConfig = {
        mcpServers: {
          "claude-code-vault": {
            command: "npx",
            args: ["claude-code-vault", "mcp"],
            env: { VAULT_DIR: `./${relVault}` },
          },
        },
      };
      await fs.writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
      console.log(`✓ Wrote .mcp.json`);
    }

    const gitignorePath = path.resolve(".gitignore");
    const IGNORE_LINE = ".vault-cache/";
    let gitignore = "";
    try {
      gitignore = await fs.readFile(gitignorePath, "utf-8");
    } catch {
      // file missing — we'll create it
    }
    const hasLine = gitignore
      .split("\n")
      .some((l) => l.trim() === IGNORE_LINE);
    if (!hasLine) {
      const sep = gitignore && !gitignore.endsWith("\n") ? "\n" : "";
      await fs.writeFile(gitignorePath, gitignore + sep + IGNORE_LINE + "\n");
      console.log(`✓ Added ${IGNORE_LINE} to .gitignore`);
    } else {
      console.log(`ℹ .gitignore already excludes ${IGNORE_LINE}`);
    }

    console.log();
    console.log(`Next steps:`);
    console.log(`  1. Restart Claude Code in this directory to pick up .mcp.json`);
    console.log(`  2. Verify vault tools are live: ask Claude "list available tools"`);
    console.log(`  3. Add notes under ${vaultDir}/${project}/ and link them with [[wikilinks]]`);
  });

// ===== INDEX =====
program
  .command("index")
  .description("Reindex vault and list notes")
  .action(async () => {
    const vaultDir = program.opts().vault;
    const vault = new Vault(vaultDir);
    await vault.reindex();
    console.log(`✓ Indexed ${vault.index.length} notes\n`);
    for (const note of vault.index.slice(0, 10)) {
      console.log(`  ${note.id} (${note.wordCount} words)`);
    }
    if (vault.index.length > 10) {
      console.log(`  ... and ${vault.index.length - 10} more`);
    }
  });

// ===== SEARCH =====
program
  .command("search <query>")
  .option("--limit <n>", "Max results", "10")
  .option("--json", "Output as JSON")
  .description("Search vault")
  .action(async (query, options) => {
    const vaultDir = program.opts().vault;
    const vault = new Vault(vaultDir);
    await vault.reindex();

    const limit = parseInt(options.limit);
    const results = vault.search(query).slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`Found ${results.length} results:\n`);
      for (const note of results) {
        console.log(
          `  ${note.title} (${note.wordCount} words, relevance: ${note.relevance})`
        );
      }
    }
  });

// ===== LIST =====
program
  .command("list [tag]")
  .description("List notes, optionally filtered by tag")
  .action(async (tag) => {
    const vaultDir = program.opts().vault;
    const vault = new Vault(vaultDir);
    await vault.reindex();

    const notes = vault.list(tag);
    console.log(`Found ${notes.length} notes:\n`);
    for (const note of notes) {
      console.log(`  ${note.title} (${note.wordCount} words)`);
    }
  });

// ===== EXPORT =====
program
  .command("export [format]")
  .description("Export vault as JSON or markdown")
  .action(async (format = "json") => {
    const vaultDir = program.opts().vault;
    const vault = new Vault(vaultDir);
    await vault.reindex();

    if (format === "json") {
      console.log(JSON.stringify(vault.exportAsJson(), null, 2));
    } else if (format === "markdown") {
      console.log(await vault.exportAsMarkdown());
    } else {
      console.error(`Unknown format: ${format}`);
      process.exit(1);
    }
  });

// ===== CHECK =====
program
  .command("check")
  .description("Validate vault: broken links, missing frontmatter")
  .action(async () => {
    const vaultDir = program.opts().vault;
    const vault = new Vault(vaultDir);
    await vault.reindex();

    const noteIds = new Set(vault.index.map((n) => n.id));
    const issues = [];

    for (const note of vault.index) {
      if (!note.frontmatter.title) issues.push(`${note.id}: missing title`);
      if (!note.frontmatter.description)
        issues.push(`${note.id}: missing description`);

      if (note.links) {
        for (const link of note.links) {
          if (!noteIds.has(link)) {
            issues.push(`${note.id}: broken link to ${link}`);
          }
        }
      }
    }

    if (issues.length === 0) {
      console.log("✓ No issues found");
    } else {
      console.warn(`⚠ Found ${issues.length} issues:\n`);
      for (const issue of issues) {
        console.warn(`  ${issue}`);
      }
      process.exit(1);
    }
  });

// ===== STATS =====
program
  .command("stats")
  .description("Show vault statistics")
  .action(async () => {
    const vaultDir = program.opts().vault;
    const vault = new Vault(vaultDir);
    await vault.reindex();

    const graph = vault.getGraph();
    const linkCounts = new Map();
    for (const edge of graph.edges) {
      linkCounts.set(edge.target, (linkCounts.get(edge.target) || 0) + 1);
    }

    const projects = new Map();
    for (const note of vault.index) {
      const project = note.id.split("/")[0];
      if (!projects.has(project)) {
        projects.set(project, { count: 0, words: 0 });
      }
      const stats = projects.get(project);
      stats.count += 1;
      stats.words += note.wordCount;
    }

    console.log("📊 Vault Statistics\n");
    for (const [project, stats] of projects) {
      console.log(
        `${project}: ${stats.count} notes, ${stats.words.toLocaleString()} words`
      );
    }

    const topLinked = Array.from(linkCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topLinked.length > 0) {
      console.log("\n🔗 Most Linked:");
      for (const [noteId, count] of topLinked) {
        const note = vault.index.find((n) => n.id === noteId);
        console.log(`  ${note?.title || noteId} (${count} backlinks)`);
      }
    }
  });

// ===== ADD =====
program
  .command("add <path> <title>")
  .description("Create a new note")
  .action(async (pathStr, title) => {
    const vaultDir = program.opts().vault;
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    const filePath = path.join(vaultDir, pathStr, `${slug}.md`);

    try {
      await fs.stat(filePath);
      console.error(`✗ File already exists: ${filePath}`);
      process.exit(1);
    } catch {
      // Good, doesn't exist
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const pathParts = pathStr.split("/");
    const tags = pathParts.slice(0, 2);

    const content = `---
title: ${title}
tags: [${tags.join(", ")}]
date: ${new Date().toISOString().split("T")[0]}
description: ""
---

# ${title}
`;

    await fs.writeFile(filePath, content);
    console.log(`✓ Created ${filePath}`);

    const editor = process.env.EDITOR || "vi";
    spawnSync(editor, [filePath], { stdio: "inherit" });
  });

// ===== LINT =====
program
  .command("lint")
  .option("--dry-run", "Don't modify files")
  .description("Auto-fix frontmatter in all notes")
  .action(async (options) => {
    const vaultDir = program.opts().vault;
    const vault = new Vault(vaultDir);
    await vault.reindex();

    let fixed = 0;

    for (const note of vault.index) {
      const filePath = path.join(vaultDir, note.path);
      let content = await fs.readFile(filePath, "utf-8");
      let modified = false;

      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (!fmMatch) continue;

      let frontmatter = fmMatch[1];
      const bodyStart = fmMatch[0].length;
      const body = content.slice(bodyStart);

      if (frontmatter.includes("date:")) {
        const dateMatch = frontmatter.match(
          /date:\s*(\d{4})-(\d{1,2})-(\d{1,2})/
        );
        if (dateMatch) {
          const normalized = `${dateMatch[1]}-${String(dateMatch[2]).padStart(
            2,
            "0"
          )}-${String(dateMatch[3]).padStart(2, "0")}`;
          const newDate = `date: ${normalized}`;
          frontmatter = frontmatter.replace(
            /date:\s*\d{4}-\d{1,2}-\d{1,2}/,
            newDate
          );
          if (newDate !== dateMatch[0]) modified = true;
        }
      }

      if (!frontmatter.includes("description:")) {
        frontmatter += '\ndescription: ""';
        modified = true;
      }

      const lines = body.split("\n");
      const trimmedLines = lines.map((l) => l.trimRight());
      const trimmedBody = trimmedLines.join("\n").replace(/\n+$/, "\n");
      if (trimmedBody !== body) modified = true;

      if (modified) {
        fixed++;
        if (!options.dryRun) {
          const newContent = `---\n${frontmatter}\n---\n${trimmedBody}`;
          await fs.writeFile(filePath, newContent);
        }
      }
    }

    if (options.dryRun) {
      console.log(`Would fix ${fixed} notes`);
    } else if (fixed === 0) {
      console.log("✓ All notes clean");
    } else {
      console.log(`✓ Fixed ${fixed} notes`);
    }
  });

// ===== SYNC =====
program
  .command("sync")
  .option("--dry-run", "Don't push to remote")
  .description("Git add, commit, and push vault changes")
  .action(async (options) => {
    const vaultDir = program.opts().vault;

    const statusResult = spawnSync("git", ["status", "--porcelain", vaultDir], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    const hasChanges = statusResult.stdout.trim().length > 0;

    if (!hasChanges) {
      console.log("✓ Nothing to sync");
      return;
    }

    if (options.dryRun) {
      console.log("Would commit:");
      console.log(statusResult.stdout);
      return;
    }

    spawnSync("git", ["add", vaultDir], { stdio: "inherit" });

    const timestamp = new Date().toISOString().split("T")[0];
    const timeString = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    spawnSync("git", ["commit", "-m", `vault: sync ${timestamp} ${timeString}`], {
      stdio: "inherit",
    });

    spawnSync("git", ["push"], { stdio: "inherit" });
    console.log("✓ Synced");
  });

// ===== SERVE =====
program
  .command("serve")
  .option("--port <n>", "Port to listen on", "4001")
  .description("Start the web server")
  .action(async (options) => {
    process.env.PORT = options.port;
    process.env.VAULT_DIR = program.opts().vault;
    await import("./lib/server.js");
  });

// ===== MCP =====
program
  .command("mcp")
  .description("Start the MCP server (stdio transport, for Claude Code)")
  .action(async () => {
    process.env.VAULT_DIR = program.opts().vault;
    await import("./lib/mcp.js");
  });

// ===== SEMANTIC SEARCH =====
async function openSyncedDb() {
  const { openEmbeddingsDb, syncEmbeddings } = await import(
    "./lib/embeddings.js"
  );
  const vaultDir = program.opts().vault;
  const vault = new Vault(vaultDir);
  await vault.reindex();

  const cacheDir = path.resolve(vaultDir, "..", ".vault-cache");
  await fs.mkdir(cacheDir, { recursive: true });
  const db = openEmbeddingsDb(path.join(cacheDir, "embeddings-v2.db"));

  console.error("Syncing embeddings...");
  const stats = await syncEmbeddings(db, vault);
  if (stats.reembedded || stats.deleted) {
    console.error(
      `  re-embedded ${stats.reembedded} note(s), deleted ${stats.deleted}, total chunks ${stats.totalChunks} across ${stats.totalNotes} notes`
    );
  }
  return { db, vault };
}

program
  .command("semantic-search <query>")
  .option("--limit <n>", "Max results", "10")
  .option("--folder <path>", "Restrict to note ids under this folder prefix")
  .option("--tag <tag...>", "Restrict to notes with any of these tags")
  .option("--after <date>", "Restrict to notes with frontmatter date >= YYYY-MM-DD")
  .option("--before <date>", "Restrict to notes with frontmatter date <= YYYY-MM-DD")
  .option("--json", "Output as JSON")
  .description("Search vault by meaning (note-level, local embeddings)")
  .action(async (query, options) => {
    const { semanticSearch } = await import("./lib/embeddings.js");
    const { db, vault } = await openSyncedDb();
    const results = await semanticSearch(db, vault, query, {
      limit: parseInt(options.limit),
      folder: options.folder,
      tag: options.tag,
      after: options.after,
      before: options.before,
    });
    db.close();

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`Found ${results.length} semantically similar notes:\n`);
      for (const r of results) {
        console.log(`  ${r.similarity} — ${r.title} (${r.id})`);
        if (r.bestChunkHeading) console.log(`      best chunk: ${r.bestChunkHeading}`);
      }
    }
  });

program
  .command("search-chunks <query>")
  .option("--limit <n>", "Max results", "5")
  .option("--folder <path>", "Restrict to note ids under this folder prefix")
  .option("--tag <tag...>", "Restrict to notes with any of these tags")
  .option("--after <date>", "Restrict to notes with frontmatter date >= YYYY-MM-DD")
  .option("--before <date>", "Restrict to notes with frontmatter date <= YYYY-MM-DD")
  .option("--json", "Output as JSON")
  .description("Search vault at paragraph/section level (chunk retrieval)")
  .action(async (query, options) => {
    const { searchChunks } = await import("./lib/embeddings.js");
    const { db, vault } = await openSyncedDb();
    const results = await searchChunks(db, vault, query, {
      limit: parseInt(options.limit),
      folder: options.folder,
      tag: options.tag,
      after: options.after,
      before: options.before,
    });
    db.close();

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`Found ${results.length} matching chunks:\n`);
      for (const r of results) {
        const breadcrumb = r.headingPath.join(" > ");
        console.log(`  [${r.similarity}] ${breadcrumb}`);
        console.log(`    note: ${r.noteId}`);
        const preview = r.text.replace(/\s+/g, " ").slice(0, 120);
        console.log(`    text: ${preview}${r.text.length > 120 ? "…" : ""}`);
        if (r.links.length) console.log(`    links: ${r.links.join(", ")}`);
        console.log();
      }
    }
  });

function formatNeighbor(n) {
  const weight =
    n.relation === "bidirectional"
      ? `bidirectional ⇄ (fwd=${n.forwardWeight}, back=${n.backlinkWeight})`
      : `${n.relation} (weight=${n.totalWeight})`;
  const d = n.distance > 1 ? `d=${n.distance} ` : "";
  console.log(`  ${d}${n.title} (${n.id})`);
  console.log(`    ${weight}`);
  if (n.snippet) {
    const head = n.snippet.heading ? `${n.snippet.heading} — ` : "";
    const preview = n.snippet.text.replace(/\s+/g, " ").slice(0, 160);
    console.log(`    ${head}${preview}${n.snippet.text.length > 160 ? "…" : ""}`);
  }
  console.log();
}

program
  .command("read-with-context <id>")
  .option("--depth <n>", "Neighbor hop depth (1 or 2)", "1")
  .option("--max-chars <n>", "Budget for neighbor snippets", "8000")
  .option("--json", "Output as JSON")
  .description("Read a note plus ranked graph neighbors with snippets")
  .action(async (id, options) => {
    const { expandNeighbors } = await import("./lib/graph.js");
    const { db, vault } = await openSyncedDb();
    const note = await vault.getNote(id);
    if (!note) {
      console.error(`Note not found: ${id}`);
      db.close();
      process.exit(1);
    }
    const { neighbors, truncated } = await expandNeighbors(db, vault, [id], {
      depth: parseInt(options.depth),
      maxChars: parseInt(options.maxChars),
    });
    db.close();

    const payload = {
      note: {
        id: note.id,
        title: note.title,
        tags: note.tags,
        links: note.links,
        backlinks: vault.getBacklinksFor(id),
      },
      neighbors,
      truncated,
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${note.title} (${note.id})`);
      console.log(`  tags: ${note.tags.join(", ") || "—"}`);
      console.log(`  ${note.links.length} forward, ${payload.note.backlinks.length} backlinks`);
      console.log();
      console.log(`${neighbors.length} neighbors${truncated ? " (truncated)" : ""}:\n`);
      for (const n of neighbors) formatNeighbor(n);
    }
  });

program
  .command("search-with-context <query>")
  .option("--limit <n>", "Max chunk results", "5")
  .option("--depth <n>", "Neighbor hop depth (1 or 2)", "1")
  .option("--max-chars <n>", "Budget for neighbor snippets", "8000")
  .option("--folder <path>", "Restrict to note ids under this folder prefix")
  .option("--tag <tag...>", "Restrict to notes with any of these tags")
  .option("--after <date>", "Restrict to notes with frontmatter date >= YYYY-MM-DD")
  .option("--before <date>", "Restrict to notes with frontmatter date <= YYYY-MM-DD")
  .option("--json", "Output as JSON")
  .description("Search chunks and include graph neighbors of hit notes")
  .action(async (query, options) => {
    const { searchChunks } = await import("./lib/embeddings.js");
    const { expandNeighbors } = await import("./lib/graph.js");
    const { db, vault } = await openSyncedDb();
    const chunks = await searchChunks(db, vault, query, {
      limit: parseInt(options.limit),
      folder: options.folder,
      tag: options.tag,
      after: options.after,
      before: options.before,
    });
    const anchorIds = [...new Set(chunks.map((c) => c.noteId))];
    const { neighbors, truncated } =
      anchorIds.length > 0
        ? await expandNeighbors(db, vault, anchorIds, {
            depth: parseInt(options.depth),
            maxChars: parseInt(options.maxChars),
          })
        : { neighbors: [], truncated: false };
    db.close();

    if (options.json) {
      console.log(JSON.stringify({ chunks, neighbors, truncated }, null, 2));
    } else {
      console.log(`Found ${chunks.length} matching chunks:\n`);
      for (const r of chunks) {
        console.log(`  [${r.similarity}] ${r.headingPath.join(" > ")}`);
        console.log(`    note: ${r.noteId}`);
      }
      console.log();
      console.log(`${neighbors.length} graph neighbors${truncated ? " (truncated)" : ""}:\n`);
      for (const n of neighbors) formatNeighbor(n);
    }
  });

program.parse(process.argv);
