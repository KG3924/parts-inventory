#!/bin/sh
# Fail if the Pages output looks like it shipped customer data.
# Allowed: the shop's own contact block and the five staff logins already in the app.
set -eu
root="${1:-dist}"
[ -d "$root" ] || { echo "No $root directory to scan."; exit 1; }
bad=$(find "$root" -type f \( -name '*.csv' -o -name '*.tsv' -o -name '*.xls' -o -name '*.xlsx' -o -name '*.ods' -o -name '*.vcf' -o -name '*.iif' -o -name '*.qbo' \))
emails=$(grep -RhoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$root" | tr 'A-Z' 'a-z' | sort -u \
  | grep -vE '^((info|glynn|grant|ricky|toby)@inmarsystems\.com|kyle\.grantham\.kg@gmail\.com)$' || true)
# US phones not inside a part number; the five shop numbers are allowed.
phones=$(grep -RhoE '(^|[^0-9A-Za-z-])\(?[0-9]{3}\)?[-. ][0-9]{3}[-. ][0-9]{4}([^0-9A-Za-z-]|$)' "$root" | tr -cd '0-9\n' | sort -u \
  | grep -vE '^(2254309111|2256445555|5046174625|8565056251|8567225535)$' || true)
if [ -n "$bad$emails$phones" ]; then
  echo "Customer-looking data is in a place GitHub Pages would serve:"
  printf '%s\n' $bad $emails $phones
  exit 1
fi
echo "No customer-looking data in $root."
