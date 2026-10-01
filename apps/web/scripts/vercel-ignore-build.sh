#!/usr/bin/env bash
# scripts/vercel-ignore-build.sh
#
# Vercel "Ignored Build Step" (vercel.json -> ignoreCommand). Vercel runs it
# from the project root directory (apps/web) before every build:
#   exit 0 -> SKIP the build (shows as "Canceled", no functions are stored)
#   exit 1 -> run the build
#
# Why: on the Hobby plan every retained deployment's function bundles count
# against the 10 GB "Function Storage" allowance. Skipping builds that cannot
# change the deployed web app (Android/Expo-only, docs-only, load-test-only
# commits) and all preview builds keeps the number of stored deployments down.
# See docs/SETUP.md "Vercel Hobby storage".
#
# No branch name is hardcoded: Vercel sets VERCEL_ENV=production only for the
# branch chosen under Project Settings -> Git -> Production Branch, whatever it
# is called, and VERCEL_ENV=preview for every other branch.
#
# Inputs (set by Vercel): VERCEL_ENV, VERCEL_GIT_COMMIT_REF,
# VERCEL_GIT_PREVIOUS_SHA (the commit of the last successful deployment, when
# there is one). When VERCEL_ENV is unset (a manual run), only the diff check
# applies. Override for a one-off build: set FORCE_VERCEL_BUILD=1 in the
# project env.

set -u

ENV_NAME="${VERCEL_ENV:-}"
REF="${VERCEL_GIT_COMMIT_REF:-}"

log() {
  # One structured JSON line so it is searchable in the Vercel build log.
  printf '{"source":"vercel-ignore-build","env":"%s","ref":"%s","decision":"%s","reason":"%s"}\n' "$ENV_NAME" "$REF" "$1" "$2"
}

if [ "${FORCE_VERCEL_BUILD:-}" = "1" ]; then
  log build "FORCE_VERCEL_BUILD=1"
  exit 1
fi

if [ -n "$ENV_NAME" ] && [ "$ENV_NAME" != "production" ]; then
  log skip "preview build (VERCEL_ENV=$ENV_NAME)"
  exit 0
fi

# Paths (relative to the repo root) whose changes can affect the web build.
WATCHED=(apps/web shared package.json package-lock.json patches)

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { log build "not a git checkout"; exit 1; }
cd "$REPO_ROOT" || { log build "cannot enter repo root"; exit 1; }

BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$BASE" ] || ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  # No previous deployment, or it is outside the shallow clone: fall back to
  # the parent commit; if that is unavailable too, build to be safe.
  BASE="$(git rev-parse --verify --quiet HEAD^)" || { log build "no base commit to diff against"; exit 1; }
fi

if git diff --quiet "$BASE" HEAD -- "${WATCHED[@]}"; then
  log skip "no changes under ${WATCHED[*]} since ${BASE:0:7}"
  exit 0
fi

log build "web-relevant changes since ${BASE:0:7}"
exit 1
