# Source from an interactive zsh.
[[ -o interactive ]] || return 0
autoload -Uz add-zsh-hook
typeset -g _murmur_scout_dir="${${(%):-%x}:A:h}"
typeset -g _murmur_command='' _murmur_cwd=''
typeset -g _murmur_env_watch_repos=''
if (( ! ${+WATCH_REPOS} )); then
  _murmur_env_watch_repos=$(command node "$_murmur_scout_dir/send-command.mjs" --watch-repos 2>/dev/null)
fi

_murmur_in_repo() {
  emulate -L zsh
  local entry root cwd="${PWD:A}"
  local watched="${WATCH_REPOS-$_murmur_env_watch_repos}"
  for entry in "${(@s/:/)watched}"; do
    [[ -n "$entry" ]] || continue
    root=$(command git -C "$entry" rev-parse --show-toplevel 2>/dev/null) || continue
    root="${root:A}"
    [[ "$cwd" == "$root" || "$cwd" == "$root/"* ]] && return 0
  done
  return 1
}

_murmur_preexec() {
  emulate -L zsh
  _murmur_command='' _murmur_cwd=''
  if [[ -S "$HOME/.murmur/scout.sock" ]] && _murmur_in_repo; then
    _murmur_cwd="${PWD:A}"
    local secret_pattern='sk-|(^|[^[:alnum:]_])sk_[[:alnum:]]{16,}|ghp_|akia|password='
    if [[ "${1:l}" =~ $secret_pattern ]]; then
      _murmur_command='[REDACTED]'
    else
      _murmur_command="$1"
    fi
  fi
  return 0
}

_murmur_precmd() {
  local exit_code=$?
  emulate -L zsh
  if [[ -n "$_murmur_command" ]]; then
    builtin printf '%s\0%s\0%s' "$_murmur_cwd" "$exit_code" "$_murmur_command" |
      command node "$_murmur_scout_dir/send-command.mjs" 2>/dev/null
    _murmur_command='' _murmur_cwd=''
  fi
  return 0
}

add-zsh-hook preexec _murmur_preexec
# Read the command status before the other functions in the precmd hook array.
add-zsh-hook precmd _murmur_precmd
precmd_functions=(_murmur_precmd "${(@)precmd_functions:#_murmur_precmd}")
