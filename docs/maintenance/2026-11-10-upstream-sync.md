# Fork maintenance: 1.1.93

Baseline: MoLi-MoChou/Netcatty main `7538338710752bd2730ae582f2c498fdeda77ead` (1.1.92).
Upstream reviewed: binaricat/Netcatty main `ad0586702632a301e8c4d0c05b81aa35b584cb67`.
This is a deliberately small selective sync, not a full merge of the 1218 missing upstream commits.

## Ported upstream fixes

- [#3962](https://github.com/binaricat/Netcatty/pull/3962): stop leftover Netcatty.exe processes before NSIS file replacement, without `/T` (which would kill the installer).
- [#4184](https://github.com/binaricat/Netcatty/pull/4184): render all reported CPU cores with a scrollable overview instead of truncating to 12.
- [#4165](https://github.com/binaricat/Netcatty/pull/4165): keep Quick Connect open on background / portaled menu clicks; add explicit close controls on subsequent steps.

All three were cherry-picked with upstream provenance (`git cherry-pick -x`).

## Skipped / deferred

- #3843: cherry-pick conflicts in GroupDetailsPanel.tsx; upstream also assumes newer notes/test infrastructure. Aborted without changing fork behavior.
- #4088: inspected; spans Catty history, providers and many context modules. Deferred to avoid the known protected Catty divergence.
- #3750: inspected scope; port-forwarding UI/tests plus new upstream dependencies were left for a separate focused sync.
- #4137 / #4140 and #3887 / #3888: inspected scope only; worker/main-process and tab interaction changes deferred to keep this release small.
- Linux-only #4190, Nix #4192, macOS-only #4028, chore #4112, feature #4113 and all remaining title candidates are not part of this batch. They are not claimed to have been fully reviewed.
- Prior skips (#3298, #3292, #3290, #3306, #3315, #3316, #3307, #3313, #3342, #3325, #3328, #3345, #3350, #3395) are not reintroduced.

## Fork behavior preserved

SSH, Xshell .xsh URL launch, legacy loopback/bastion algorithms, ephemeral empty-password connections, one-shot picker/SFTP/tunnel handling and PR #16 post-connect probing fixes are unchanged.
Updater feed, electron-builder publish owner/repo and build workflow remain unchanged: MoLi-MoChou/Netcatty, Windows x64, NSIS only.

Only package.json is bumped to 1.1.93, following previous fork marketing patch releases. Upstream 0.0.0 / v1.1.90 is not used to downgrade this fork.

## Validation / release

See the sync PR and linked CI checks for authoritative results. Release v1.1.93 must not be published unless the Windows package build succeeds. No upstream push is permitted.

Local validation: 50 targeted tests + 33 fork regression tests passed; full npm run lint and npm run build passed. Full-suite CI remains authoritative.
