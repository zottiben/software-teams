---
name: VerifyAdvanced
category: execution
description: Advanced verification for phase and requirements scope
---

# VerifyAdvanced

Lazy-loaded verification for `scope="phase"` and `scope="requirements"`. See `@ST:Verify` for task and plan verification.

---

<section name="Phase">

## Phase Verification

When `scope="phase"`:

1. **Verify all plans complete** — Check SUMMARY.md exists for each plan, verify success criteria met
2. **Load phase must_haves from ROADMAP.yaml**
3. **Verify against codebase (not claims)** — Actually check the codebase, run the functionality
4. **Create VERIFICATION.md** with must-haves status table, plans completed, gaps found, human verification needed
5. **Route by status:**
   - `PASSED` → Continue to next phase
   - `GAPS_FOUND` → Create gap closure plans
   - `HUMAN_NEEDED` → Present checklist to user

</section>

---

<section name="Requirements">

## Requirements Verification

When `scope="requirements"`:

1. **Load REQUIREMENTS.yaml** — Get all v1 requirements with REQ-IDs
2. **For each requirement** — Find which phase/plan claimed to implement it, verify implementation exists, check acceptance criteria
3. **Cross-reference evidence** — Link to test files, code implementing the requirement, note partial implementations
4. **Generate report** with total/verified/failed/not-implemented counts, verification results table, failed requirements details, recommendations

</section>
