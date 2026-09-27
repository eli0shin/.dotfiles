#!/usr/bin/env bash
set -euo pipefail

repo="eli0shin/openwhispr"
install_root="$HOME/.local/opt/openwhispr"
app_dir="$install_root/app"
bin_dir="$HOME/.local/bin"
desktop_dir="$HOME/.local/share/applications"
icon_dir="$HOME/.local/share/icons/hicolor/512x512/apps"
autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/dotfiles"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  printf 'OpenWhispr fork supports Linux x86_64 only.\n' >&2
  exit 1
fi

command -v gh >/dev/null || {
  printf 'GitHub CLI (gh) is required to install OpenWhispr.\n' >&2
  exit 1
}

mkdir -p "$cache_root"
work_dir=$(mktemp -d "$cache_root/openwhispr-install.XXXXXX")
backup_dir=""
cleanup() {
  status=$?
  rm -rf "$work_dir"
  if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
    if [[ $status -eq 0 ]]; then
      rm -rf "$backup_dir"
    else
      rm -rf "$app_dir"
      mv "$backup_dir" "$app_dir"
    fi
  fi
}
trap cleanup EXIT

gh release download \
  --repo "$repo" \
  --pattern 'OpenWhispr-*-linux-x64.tar.gz' \
  --dir "$work_dir"

mapfile -t archives < <(find "$work_dir" -maxdepth 1 -type f -name 'OpenWhispr-*-linux-x64.tar.gz')
if [[ ${#archives[@]} -ne 1 ]]; then
  printf 'Expected one OpenWhispr Linux archive, found %s.\n' "${#archives[@]}" >&2
  exit 1
fi

mkdir -p "$work_dir/extracted"
tar -xzf "${archives[0]}" -C "$work_dir/extracted"
mapfile -t extracted_dirs < <(find "$work_dir/extracted" -mindepth 1 -maxdepth 1 -type d)
if [[ ${#extracted_dirs[@]} -ne 1 || ! -x "${extracted_dirs[0]}/open-whispr" ]]; then
  printf 'The OpenWhispr archive has an unexpected layout.\n' >&2
  exit 1
fi

# Stop only this user-installed fork before replacing files it can load lazily.
pkill -TERM -f "$app_dir/open-whispr-app" 2>/dev/null || true
for _ in {1..50}; do
  pgrep -f "$app_dir/open-whispr-app" >/dev/null || break
  sleep 0.1
done

mkdir -p "$install_root"
if [[ -d "$app_dir" ]]; then
  backup_dir="$install_root/app.previous.$$"
  mv "$app_dir" "$backup_dir"
fi
if ! mv "${extracted_dirs[0]}" "$app_dir"; then
  [[ -n "$backup_dir" ]] && mv "$backup_dir" "$app_dir"
  exit 1
fi

mkdir -p "$bin_dir" "$desktop_dir" "$icon_dir" "$autostart_dir"
cat > "$bin_dir/open-whispr" <<'EOF'
#!/usr/bin/env bash
exec "$HOME/.local/opt/openwhispr/app/open-whispr" "$@"
EOF
chmod 0755 "$bin_dir/open-whispr"
install -m 0644 "$app_dir/resources/src/assets/icon.png" "$icon_dir/openwhispr.png"

cat > "$desktop_dir/openwhispr.desktop" <<EOF
[Desktop Entry]
Name=OpenWhispr
Comment=Voice-to-text dictation from eli0shin/openwhispr
Exec=$bin_dir/open-whispr %U
Icon=openwhispr
Type=Application
Categories=Utility;AudioVideo;
StartupWMClass=open-whispr
MimeType=x-scheme-handler/openwhispr;
Terminal=false
EOF

cat > "$autostart_dir/open-whispr.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=OpenWhispr
Comment=Voice dictation and AI agent
Exec=$bin_dir/open-whispr --hidden
Icon=openwhispr
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
EOF

"$bin_dir/open-whispr" --hidden >"${XDG_CACHE_HOME:-$HOME/.cache}/openwhispr-fork-launch.log" 2>&1 &
printf 'Installed OpenWhispr from %s.\n' "$repo"
