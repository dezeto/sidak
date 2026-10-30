#!/bin/zsh
# Sidak setup, safe to re-run: config.json, ~/bin links, the native-messaging host, token.txt and Sidak.app.
set -e
cd ${0:A:h}
missing=()
for tool in gh jq claude swiftc; do (( $+commands[$tool] )) || missing+=$tool; done
[[ -x /Applications/cmux.app/Contents/Resources/bin/cmux ]] || missing+=cmux
(( $#missing )) && { print "missing: $missing"; exit 1; }

# 1. config.json holds everything personal; the login comes from gh.
[[ -f config.json ]] || cp config.example.json config.json
if [[ $(jq -r .login config.json) == your-github-login ]]; then
  jq --arg login "$(gh api user --jq .login)" '.login = $login' config.json > config.json.tmp && mv config.json.tmp config.json
fi
[[ $(jq -r .org config.json) == your-github-org ]] && print "Edit config.json: org, repos (the folder holding your checkouts) and reviewable (repo names)."

# 2. The scripts, on PATH.
mkdir -p ~/bin
for f in $PWD/bin/*; do ln -sf $f ~/bin/${f:t}; done
[[ :$PATH: == *:$HOME/bin:* ]] || print "~/bin is not on PATH: add it in ~/.zshrc."

# 3. The native-messaging host the extension talks to, for every browser that is installed.
id=$(jq -r .extensionId config.json)
for browser in ~/Library/Application\ Support/{Arc/User\ Data,Google/Chrome,Chromium,Dia/User\ Data}(N/); do
  mkdir -p $browser/NativeMessagingHosts
  jq -n --arg path $PWD/bin/ccreview-host --arg origin chrome-extension://$id/ \
    '{name: "com.sidak.host", description: "Sidak: opens PR reviews in cmux", path: $path, type: "stdio", allowed_origins: [$origin]}' \
    > $browser/NativeMessagingHosts/com.sidak.host.json
  rm -f $browser/NativeMessagingHosts/com.adrian.ccreview.json
done

# 4. The panel's GitHub token.
[[ -f token.txt ]] || (umask 077; gh auth token > token.txt)

# 5. The menu-bar app.
app/build.sh

# 6. Phone access, only with a "remote" block in config.json: the tunnel, then its DNS record once the Cloudflare Access app
#    exists (remote.team, remote.aud), so the address never answers without that login. Sidak.app runs cloudflared itself.
host=$(jq -r '.remote.hostname // empty' config.json)
if [[ -n $host ]] && (( $+commands[cloudflared] )); then
  name=$(jq -r '.remote.tunnel // "sidak"' config.json)
  cloudflared tunnel info $name >/dev/null 2>&1 || cloudflared tunnel create $name
  if [[ -n $(jq -r '.remote.aud // empty' config.json) && -n $(jq -r '.remote.team // empty' config.json) ]]; then
    cloudflared tunnel route dns $name $host || print "DNS for $host not changed: delete its old record in Cloudflare, then run ./install.sh again."
  else
    print "Phone: create the Access app for $host, put remote.team and remote.aud in config.json, run ./install.sh again."
  fi
fi

print "
Next:
  1. Load this folder as an unpacked extension (chrome://extensions, Developer mode, Load unpacked),
     put its id in config.json extensionId and run ./install.sh again.
  2. cmux: put a socket password in ~/.config/cmux/socket-password and the same one in cmux Settings > Automation.
  3. node check.js prints ok."
