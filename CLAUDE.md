# Morpheus WebHub — Claude Instructions

## Model Selection

| Model | Use For |
|-------|---------|
| **Haiku** | File sorting, formatting, simple edits, quick searches |
| **Sonnet** | Content creation, analysis, coding, research, standard workflows (default) |
| **Opus** | Architecture decisions, complex research synthesis, critical business decisions, multi-step strategic planning |

Use Sonnet by default. Escalate to Opus when the task has significant impact, requires synthesising 5+ sources, or involves architecture decisions. Use Haiku for mechanical subtasks.

---

## Context Checkpointing

Every 20 tool calls (approximate), silently write a checkpoint to disk. Do not announce this to the user.

**Checkpoint file location:** `~/Documents/checkpoints/YYYY-MM-DD-HHMM-session-checkpoint.md`

Create the directory if it does not exist.

Each checkpoint should include:
- Summary of progress since last checkpoint (2-3 sentences)
- Key decisions made and why
- Files modified since last checkpoint
- Unfinished work with enough context to resume
- The single most important next action

Append new checkpoints to the same file throughout the session. This is background housekeeping — never pause or interrupt the user for it.

---

## Document Extraction

When reading any file over 50KB or 100 lines for analysis or review:

1. Write the extracted content and findings to a working notes file at `/tmp/extract-[description].md`
2. Report a brief summary (5-15 lines) to the user
3. Reference the disk file for detail — do not paste full document content into the conversation

For files under 50KB / 100 lines, read directly into context as normal.

When a task requires reading 2+ documents, extract each to its own file, then read only the specific sections needed for synthesis.

---

## Summary-First Reading

When a summary file exists for any document, always read the summary first.

| If available | Read this | Not this |
|-------------|-----------|----------|
| `-SUMMARY.md` file | Summary | Full transcript |
| `state.json` or index file | Index | Multiple source files |
| `CLAUDE.md` in a project folder | CLAUDE.md | All project files |
| Table of contents | TOC | Entire document set |

Only read the full source document when the summary does not contain the specific detail needed. When you do read the source, read only the relevant section — not the entire file.

---

## Parallel Agent Output

When spawning 3 or more parallel agents, every agent must write its output to disk and return only a short confirmation.

**Agent prompt must include:**
1. Output path — where to write the result file
2. Return constraint — "Return only the file path and a 1-line summary. Do NOT return the full content."

**Acceptable agent returns:**
- `Written to /path/to/output.md — 3-section summary on [topic]`
- `Grade: B+ | Written to /path/to/feedback.docx`

**Never acceptable:**
- Full document content returned in the agent response
- Verbose analysis or reasoning returned to the orchestrator
- Large tables or complete file contents in the return message

For single agents (1-2), returning content directly is acceptable when the output is short.

---

## Pre-Commit Checklist

Before every commit, always update these three things as part of the same commit:

1. **Version number** — bump the patch version (`x.y.Z`) in:
   - `source/app.js` — `APP_VERSION` constant
   - `index.html` — sidebar version button and About dialog version line
2. **CHANGELOG.md** — add a new `## [x.y.z] — YYYY-MM-DD` entry at the top with Added / Changed / Fixed sections describing what changed
3. **TODO.md** — mark any completed phases as `✓ *Completed YYYY-MM-DD*` and replace their detail with `See [x.y.z] in CHANGELOG.`

Do this automatically — do not ask the user whether to do it.
