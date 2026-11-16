#!/usr/bin/env python3
"""
Unreleased Music Player — Beta Publish

Same flow and same build as release.py's "publish as beta" option, minus the
question and without git: the next beta version is chosen automatically, the
Windows installer is built locally, then uploaded to the gated beta backend.
No commit, push or GitHub release. See release.py for the details of each step.
"""
import release

# Cut from whatever branch this checkout is on (the beta worktree is not on
# "app"), so don't let release.py switch branches.
release.APP_BRANCH = release.git_branch()

if __name__ == "__main__":
    release.main(force_beta=True)
