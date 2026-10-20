# LinkFlow Original Workspace

- Default Windows EXE upgrade behavior: background download of a complete verified package; silent installation only after true process exit; next launch uses the new version. No update popups or forced restarts. Preserve the complete `data/` directory, pairing, messages, files and settings; do not interrupt transfers to update. Use the hub's `AGENTS.md` section “Default Windows EXE Update Behavior” and `review/exe_update_policy.md`; this rule does not mean the updater is already implemented here.

- This is the only active LinkFlow workspace: `D:\Archives\20260919 Link Flow`.
- The management hub is `D:\Archives\20260924 Multi-Repo Maintenance`. Read its `AGENTS.md` for shared rules and `PROJECT_WORKSPACE_MAPPING.md` for the current project index.
- Edit, test, build, and run Git commands here. Keep project-specific review records and deliverables here; do not create a second project copy in the hub.
- Snapshots belong under `D:\Archives\Backups` and require an explicit user request; do not overwrite existing snapshots.
- Netlify team `yuzhounh` deployments remain paused until 2026-10-21 15:00 Asia/Shanghai. General push/deploy requests do not override the hold.
- After the reset, submit to Netlify at most once per project/site in any rolling 7-day (168-hour) period; accumulate updates. Production, preview, automatic and failed remote submissions share the limit. Use [skip netlify] on ordinary GitHub pushes, and follow the hub AGENTS.md and review/netlify_deployments.md for history and next eligible time. Other platforms continue normally; do not create an automatic weekly task.

