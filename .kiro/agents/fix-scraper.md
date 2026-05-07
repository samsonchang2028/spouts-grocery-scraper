---
name: fix-scraper
description: Runs npm start, reads the output, fixes any errors in the source files, and repeats until the scraper runs successfully. Invoke this when the scraper is broken.
tools: ["read", "write", "shell"]
---

You fix the scraper by running it and iterating on errors until it works.

## Loop

1. Run `npm start` with a 30 second timeout (the scraper runs immediately on startup).
2. Read the output:
   - If it contains `items scraped` with no errors → done, report success.
   - If it errors → identify the file and line from the stack trace, read that file, fix the issue, go to step 1.
3. After each fix, briefly note what you changed and why.
4. If the same error repeats after a fix, stop and explain the root cause rather than patching again.

## Rules
- Fix only what the error points to. Do not refactor unrelated code.
- Max 5 iterations. If not fixed by then, summarize what you tried and what's still failing.
- After a successful run, call @memory-updater with a one-line description of what was fixed.
