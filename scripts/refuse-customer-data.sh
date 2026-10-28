#!/bin/sh
# Fail if the Pages output looks like it shipped customer data.
# Allowed: the shop's own contact block and the five staff logins already in the app.
# The build log is public, so this prints file names and counts only, never an email or phone number.
set -eu
root="${1:-dist}"
[ -d "$root" ] || { echo "No $root directory to scan."; exit 1; }
email_re='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
email_ok='^((info|glynn|grant|ricky|toby)@inmarsystems\.com|kyle\.grantham\.kg@gmail\.com)$'
# US phones not inside a part number; the five shop numbers are allowed.
phone_re='(^|[^0-9A-Za-z-])\(?[0-9]{3}\)?[-. ][0-9]{3}[-. ][0-9]{4}([^0-9A-Za-z-]|$)'
phone_ok='^(2254309111|2256445555|5046174625|8565056251|8567225535)$'
# The case pattern's ")" cannot sit inside $(...) : this Mac's sh, and dash on
# GitHub Actions, treat that ")" as the end of the substitution. A function keeps
# the same checks and the same printed lines.
scan_tree() {
  find "$root" -type f | sort | while IFS= read -r f; do
    case "$f" in
      *.csv|*.tsv|*.xls|*.xlsx|*.ods|*.vcf|*.iif|*.qbo) echo "  $f: spreadsheet or contact file"; continue ;;
    esac
    e=$(grep -hoE "$email_re" "$f" 2>/dev/null | tr 'A-Z' 'a-z' | sort -u | grep -vcE "$email_ok" || true)
    p=$(grep -hoE "$phone_re" "$f" 2>/dev/null | tr -cd '0-9\n' | sort -u | grep -vcE "$phone_ok" || true)
    if [ "${e:-0}" -gt 0 ] || [ "${p:-0}" -gt 0 ]; then
      echo "  $f: ${e:-0} email address(es), ${p:-0} phone number(s)"
    fi
  done
}
report=$(scan_tree)
if [ -n "$report" ]; then
  echo "Customer-looking data is in a place GitHub Pages would serve (values not shown):"
  printf '%s\n' "$report"
  exit 1
fi
echo "No customer-looking data in $root."
