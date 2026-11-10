#!/usr/bin/env bash
# Online checks for the ME ID gate (day 3). Read-only except ONE real submit with the verified employer.
# Usage: bash scripts/check-online-meid.sh > docs/evidence/online-meid-online.txt
BASE="${BASE:-https://wage-proof.vercel.app}"
H="0x$(printf 'wage-proof day3 meid check %s' "$(date -u +%s)" | sha256sum | cut -c1-64)"
count() {
  curl -s "$BASE/api/rpc" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x07C06de8D0D593E45Fa4f16bF4B7D82d96D723E0","data":"0x900407bc"},"latest"]}' \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Number(BigInt(JSON.parse(s).result))))'
}
post() { curl -s -w '\nHTTP %{http_code}\n' "$BASE/api/demo" -H 'content-type: application/json' -d "$1"; }

echo "run at $(date -u +%Y-%m-%dT%H:%M:%SZ)  base=$BASE"
echo
echo "=== 0. GET /api/demo: employer list + rule"
curl -s "$BASE/api/demo" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({employers:j.employers,minEmployerLevel:j.minEmployerLevel,worker:j.worker}))})'
echo
echo "=== 1. unverified employer -> must be blocked, no transaction"
B=$(count); echo "recordCount before: $B"
post "{\"action\":\"submit\",\"reportHash\":\"$H\",\"deadlineSeconds\":3600,\"employer\":\"unverified\"}"
A=$(count); echo "recordCount after:  $A"
[ "$A" = "$B" ] && echo "RESULT: recordCount unchanged ($B) -> no record created" || echo "RESULT: recordCount CHANGED $B -> $A"
echo
echo "=== 2. bad employer values -> HTTP 400, nothing sent"
post "{\"action\":\"submit\",\"reportHash\":\"$H\",\"deadlineSeconds\":3600,\"employer\":\"boss\"}"
post "{\"action\":\"submit\",\"reportHash\":\"$H\",\"deadlineSeconds\":3600,\"employer\":\"0xDdC934222D73b4Fdc1dA6e655dd857Ce5d2C58fa\"}"
post "{\"action\":\"submit\",\"reportHash\":\"$H\",\"deadlineSeconds\":3600,\"employer\":1}"
echo "recordCount after bad values: $(count)"
echo
echo "=== 3. verified employer -> submit goes through, response carries both levels"
B=$(count); echo "recordCount before: $B"
post "{\"action\":\"submit\",\"reportHash\":\"$H\",\"deadlineSeconds\":3600,\"employer\":\"verified\"}"
A=$(count); echo "recordCount after:  $A"
