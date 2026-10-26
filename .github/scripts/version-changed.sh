#!/usr/bin/env bash
# Writes `<name>=true` to $GITHUB_OUTPUT (stdout when unset) when the version in <manifest>
# differs from its version at <before>, and `<name>=false` otherwise. <before> is the commit
# before the whole push, not HEAD^, so a bump that isn't the push's last commit still counts.
#
# Anything that can't be compared counts as unchanged, with a warning: a deploy that didn't
# happen can be started by hand, an unexpected one can't be taken back. A manifest missing at
# <before> is a new app, whose first deploy is started by hand.
#
#   .github/scripts/version-changed.sh web apps/web/package.json "$BEFORE"
set -euo pipefail

name="$1"
manifest="$2"
before="${3:-}"
output="${GITHUB_OUTPUT:-/dev/stdout}"

result() {
  echo "$name=$1" >>"$output"
}

new_version="$(jq -r .version "$manifest")"

if [[ ! "$before" =~ ^[0-9a-f]{40}$ ]] || [[ "$before" =~ ^0+$ ]]; then
  echo "::warning title=$name not deployed::No previous commit for this push; run the workflow by hand to deploy $new_version."
  result false
  exit 0
fi

if ! git cat-file -e "$before^{commit}" 2>/dev/null &&
  ! git fetch --no-tags --depth=1 origin "$before" >/dev/null 2>&1; then
  echo "::warning title=$name not deployed::Can't fetch $before (force push?); run the workflow by hand to deploy $new_version."
  result false
  exit 0
fi

if ! old_manifest="$(git show "$before:$manifest" 2>/dev/null)"; then
  echo "$name: $manifest is new in this push, so it isn't deployed; run the workflow by hand for its first deploy."
  result false
  exit 0
fi

old_version="$(jq -r .version <<<"$old_manifest")"
if [ "$old_version" != "$new_version" ]; then
  echo "$name: version changed $old_version -> $new_version"
  result true
else
  echo "$name: version unchanged ($new_version)"
  result false
fi
