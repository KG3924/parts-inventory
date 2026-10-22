#!/bin/sh
# BUG-041: fail if the old part-count catalog (count-seed.json) or its data
# shape is in a folder GitHub Pages would serve. The count tool loads the
# catalog from Supabase after sign-in instead.
set -eu
root="${1:-dist}"
if [ ! -d "$root" ]; then
  echo "No $root directory to scan."
  exit 1
fi

if find "$root" -iname 'count-seed*' | grep -q .; then
  find "$root" -iname 'count-seed*'
  echo "A count-seed file is in $root. Pages would serve it without sign-in."
  exit 1
fi

# The seed's row shape: quoted JSON keys "app_qty": or "part_number": "...".
pattern='"app_qty"[[:space:]]*:|"part_number"[[:space:]]*:[[:space:]]*"'
if grep -RIlE "$pattern" "$root"; then
  echo "Part-count catalog data is in a file under $root. Pages would serve it without sign-in."
  exit 1
fi
echo "No part-count catalog in $root."
