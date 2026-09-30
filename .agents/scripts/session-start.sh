#!/usr/bin/env bash
# SessionStart hook: checks the required tools and their versions.
# Never blocks the session: it always exits 0 and only warns the user.
#
# Requirements are "tool:command:minimum version". Add new tools here.
REQUIREMENTS=(
  "git:git --version:2.0.0"
  "bun:bun --version:1.3.11"
)

warnings=()

# True when $1 >= $2 (dotted numeric versions).
version_gte() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

for requirement in "${REQUIREMENTS[@]}"; do
  IFS=: read -r tool command minimum <<<"$requirement"

  if ! command -v "$tool" >/dev/null 2>&1; then
    warnings+=("$tool is not installed (need >= $minimum)")
    continue
  fi

  output="$($command 2>&1)"
  version="$(printf '%s' "$output" | grep -oE '[0-9]+(\.[0-9]+)+' | head -n1)"
  if [ -z "$version" ]; then
    warnings+=("could not read the version of $tool (need >= $minimum)")
  elif ! version_gte "$version" "$minimum"; then
    warnings+=("$tool $version is older than the required $minimum")
  fi
done

[ "${#warnings[@]}" -eq 0 ] && exit 0

message="Environment warnings:"
for warning in "${warnings[@]}"; do
  message+=$'\n'"- $warning"
done

# systemMessage is shown to the user; additionalContext reaches the agent.
escaped="$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s\\n", $0}')"
escaped="${escaped%\\n}"
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$escaped" "$escaped"
exit 0
