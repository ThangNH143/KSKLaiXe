---
name: gksk-step-runner
description: >-
  Standardized execution and verification workflow for completing any step (S0-S19)
  in the GKSKLaiXe project. Activate this skill whenever starting, verifying, or
  reporting completion of a step from docs/IMPLEMENTATION-PLAN.md.
---

# GKSKLaiXe Step Runner & Evidence Generator (`S0`–`S19`)

Use this skill whenever executing a step `S<n>` in `docs/IMPLEMENTATION-PLAN.md` to ensure strict compliance with the single-step rule, mandatory evidence generation (`docs/evidence/S<n>/`), and the 5-part completion report.

## Step-by-Step Procedure

### 1. Pre-Flight Check
1. Read `CHANGELOG.md` to confirm which step was last completed and identify the exact single next step `S<n>`.
2. Read the section for `S<n>` in `docs/IMPLEMENTATION-PLAN.md` (including `📦`, `🧪`, `📸`, and `🚦`).
3. If `S<n>` involves XML, `msg_id`, envelope signing, validation rules, or Excel parsing, also read `.agents/skills/gksk-protocol-guard/SKILL.md`.

### 2. Implementation & Automated Quality Gate
1. Implement only the files and features scoped to `S<n>`.
2. Write unit/integration/component tests covering all test cases listed in `🧪` of `S<n>` and `docs/TEST-PLAN.md`.
3. Run the standard quality gate:
   ```bash
   npm run lint && npm run typecheck && npm test
   ```
   - Ensure `npm test` uses `InMemoryRepositories` by default and never touches the live MSSQL server.
   - Fix all warnings/errors without using `.skip` or `.only`.

### 3. Mandatory Verification Script & Evidence Generation (`docs/evidence/S<n>/`)
1. Create or update the standalone verification script `scripts/verify-S<n>.ts` (or `.mjs`).
2. Run the script so that it writes real verifiable outputs into `docs/evidence/S<n>/`:
   - Always generate `docs/evidence/S<n>/verify-output.txt` (or `.md` report).
   - For data/file steps (`S2`–`S11`), save real sample outputs into `docs/evidence/S<n>/` (e.g., `.xml`, `.json`, `.xlsx`, `.zip`) so the user can open and inspect them directly.
3. For steps with UI or web servers (`S0`, `S13`, `S14`, `S15`, `S16`, `S17`, `S18`, `S19`):
   - Start the development or mock server (`npm run dev` or `npm run dev:mock`).
   - Delegate to the `browser` subagent (or run Playwright) to navigate through every required UI state for `S<n>`, verify there are 0 console errors and no leaked CSYT tokens in network responses, and save screenshots to `docs/evidence/S<n>/*.png` as specified in `docs/IMPLEMENTATION-PLAN.md`.

### 4. Update `CHANGELOG.md`
1. Prepend a new section at the top of `## Nhật ký bước` in `CHANGELOG.md` following the project template (`Đã làm`, `Đầu ra`, `Bằng chứng bàn giao (docs/evidence/S<n>/)`, `Kiểm thử`, `Cổng qua bước`, `Ghi chú cho Agent sau`).
2. Update `## Trạng thái hiện tại` in `CHANGELOG.md` to mark `S<n>` completed and set `S<n+1>` as the next step.

### 5. Mandatory 5-Part Completion Report to User
Never reply with a bare "Đã hoàn thành bước S<n>". Always format the final response to the user with these 5 sections:
1. **📦 Đầu ra mã nguồn & file đã tạo/sửa**: Clickable `[filename](file:///g:/KSKLaiXe/...)` links for all created/modified source and test files.
2. **🛠️ Script kiểm chứng & Kết quả chạy thực tế**: The command used to run `scripts/verify-S<n>` + key output excerpt + link to `docs/evidence/S<n>/...`.
3. **📸 Bằng chứng trực quan (Ảnh chụp màn hình / File mẫu thực tế)**:
   - Links (and/or embedded previews) to every required screenshot `docs/evidence/S<n>/*.png` for UI steps.
   - Clickable links to generated sample files (`.xml`, `.xlsx`, `.zip`, `.json`) in `docs/evidence/S<n>/` for backend steps.
4. **🧪 Kết quả bộ Test tự động**: Summary of `npm run lint`, `npm run typecheck`, and `npm test` (test file count, passed test count, coverage if applicable).
5. **🚦 Bảng đối chiếu Điều kiện qua cổng**: Markdown table or checklist ticking off every `☑` gate condition from `docs/IMPLEMENTATION-PLAN.md` with its concrete proof.
