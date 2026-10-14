#!/usr/bin/env bash
# Status line: saves Claude Code's status JSON (incl. rate_limits) for usage checks and prints the limits.
in=$(cat)
printf '%s' "$in" > "${XDG_RUNTIME_DIR:-/tmp}/claude-usage-anytalk.json"
printf '%s' "$in" | jq -r '
  def pct(x): if x == null then "?" else "\(x | floor)%" end;
  "5h: \(pct(.rate_limits.five_hour.used_percentage)) · week: \(pct(.rate_limits.seven_day.used_percentage))"' 2>/dev/null || echo "usage: n/a"
