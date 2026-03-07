---
name: WaveComputation
category: planning
description: Compute execution waves for parallel plan processing
params:
  - name: plans
    type: array
    required: true
  - name: output
    type: string
    default: inline
    description: Output format (inline|json)
---

# Wave Computation

Analyses plan dependencies and groups plans into execution waves for parallel processing.

## Algorithm

```
1. Build dependency graph:
   For each plan P, for each requirement R in P.requires:
     Find plan Q where Q.provides contains R → edge Q → P

2. Topological sort with wave assignment:
   Wave 1: Plans with no dependencies
   Wave N: Plans whose dependencies are all in waves < N

3. Output wave assignments
```

## Execution

### Step 1: Extract Frontmatter

For each plan file, parse `requires`, `provides`, and current `wave` from YAML frontmatter.

### Step 2: Build Dependency Graph

Map which plans depend on which based on requires/provides matching.

### Step 3: Compute Waves

Assign waves based on dependency resolution. Plans in the same wave can execute in parallel.

### Step 4: Output

**Inline**: Update each plan's frontmatter `wave` field.
**JSON**: Return wave structure for executor with wave number, plan IDs, and parallelism flag.

## Cross-Phase Dependencies

Dependencies from previous phases (`requires.phase < current`) are assumed satisfied if that phase is complete. Verify via `.jdi/phases/{required-phase}/VERIFICATION.md`.

## Error Handling

- **Circular dependencies**: Report error with cycle path, suggest splitting a plan
- **Missing provides**: Check if cross-phase; if not, report and suggest adding plan
