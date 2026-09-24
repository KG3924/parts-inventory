#!/bin/sh
# Fail if the Pages output contains a real secret.
# Comments and the runtime guard that rejects those keys are not secrets.
set -eu
root="${1:-dist}"
if [ ! -d "$root" ]; then
  echo "No $root directory to scan."
  exit 1
fi

# sb_secret_ plus a token (not the bare name in a comment or regex).
# An assigned service-role value.
# A JWT (legacy service-role keys are JWTs).
pattern='sb_secret_[A-Za-z0-9_-]{8,}|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*[:=][[:space:]]*['"'"'"][^'"'"'"]{8,}['"'"'"]|["'"'"']role["'"'"'][[:space:]]*:[[:space:]]*["'"'"']service_role["'"'"']|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}'

if grep -RInE "$pattern" "$root"; then
  echo "A secret key is in a file GitHub Pages would serve."
  exit 1
fi
echo "No shipped secret keys in $root."
