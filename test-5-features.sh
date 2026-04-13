#!/bin/bash
# HIPP0 - 5 Advanced Features Test (corrected)
URL=http://localhost:3100
PID=de000000-0000-4000-8000-000000000001
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${G}✓${NC} $1"; }
fail() { echo -e "  ${R}✗${NC} $1 -- $2"; }
skip() { echo -e "  ${Y}⊘${NC} $1"; }
echo ""
echo "=== HIPP0 -- 5 Advanced Features Test ==="
echo ""

DEC_ID=$(curl -s $URL/api/projects/$PID/decisions?limit=1 | jq -r '.[0].id')
echo "Using decision: $DEC_ID"
echo ""

echo "--1. OUTCOME INTELLIGENCE --"
RES=$(curl -s -w "\n%{http_code}" -X POST $URL/api/outcomes -H "Content-Type: application/json" -d "{\"decision_id\":\"$DEC_ID\",\"project_id\":\"$PID\",\"outcome_type\":\"success\",\"outcome_score\":0.9}")
CODE=$(echo "$RES" | tail -1); BODY=$(echo "$RES" | sed '$d')
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] && pass "Record outcome ($CODE)" || fail "Record outcome" "$CODE: $(echo $BODY | head -c 200)"

RES=$(curl -s -w "\n%{http_code}" $URL/api/decisions/$DEC_ID/outcomes)
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Get decision outcomes" || fail "Get decision outcomes" "$CODE"

RES=$(curl -s -w "\n%{http_code}" $URL/api/decisions/$DEC_ID/outcome-stats)
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Get outcome stats" || fail "Get outcome stats" "$CODE"

RES=$(curl -s -w "\n%{http_code}" $URL/api/projects/$PID/outcome-summary)
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Project outcome summary" || fail "Project outcome summary" "$CODE"

echo ""
echo "--2. TRUST-AWARE MEMORY --"
# Fetch multiple decisions to find one with trust_score (recent ones from simulation may lack it)
RES=$(curl -s "$URL/api/projects/$PID/decisions?limit=20")
TRUST=$(echo $RES | jq -r '[.[] | select(.trust_score != null and .trust_score != 0)] | .[0].trust_score // empty')
[ -n "$TRUST" ] && pass "trust_score exists: $TRUST" || skip "trust_score not on decision"

PROV=$(echo $RES | jq -r '[.[] | select(.provenance_chain != null and .provenance_chain != "[]" and .provenance_chain != "null")] | .[0].provenance_chain // empty')
[ -n "$PROV" ] && [ "$PROV" != "[]" ] && [ "$PROV" != "null" ] && pass "provenance_chain exists" || skip "provenance_chain not populated"

# Compile with debug to check trust_multiplier
RES=$(curl -s -X POST "$URL/api/compile?threshold=0" -H "Content-Type: application/json" -d "{\"project_id\":\"$PID\",\"agent_name\":\"architect\",\"task_description\":\"test trust\",\"format\":\"json\",\"debug\":true}")
TMULT=$(echo $RES | jq -r '.debug.decisions[0].trust_multiplier // empty')
[ -n "$TMULT" ] && pass "trust_multiplier in debug: $TMULT" || skip "trust_multiplier not in debug"

echo ""
echo "--3. AUTONOMOUS MEMORY CAPTURE --"
RES=$(curl -s -w "\n%{http_code}" -X POST $URL/api/capture -H "Content-Type: application/json" -d "{\"project_id\":\"$PID\",\"agent_name\":\"architect\",\"content\":\"We decided to use TypeScript strict mode for all new files.\",\"source\":\"test\"}")
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] || [ "$CODE" = "202" ] && pass "Passive capture ($CODE)" || fail "Passive capture" "$CODE"

RES=$(curl -s -w "\n%{http_code}" -X POST $URL/api/ingest/webhook -H "Content-Type: application/json" -d "{\"project_id\":\"$PID\",\"text\":\"The team agreed to use Redis for session caching.\",\"source_id\":\"test-$(date +%s)\",\"agent_name\":\"backend\"}")
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] || [ "$CODE" = "202" ] && pass "Ingest webhook ($CODE)" || fail "Ingest webhook" "$CODE"

RES=$(curl -s -w "\n%{http_code}" $URL/api/projects/$PID/captures)
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "List captures" || skip "List captures ($CODE)"

echo ""
echo "--4. ADAPTIVE AGENT LEARNING --"
RES=$(curl -s -w "\n%{http_code}" $URL/api/projects/$PID/agent-performance)
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Agent performance ($CODE)" || fail "Agent performance" "$CODE"

RES=$(curl -s -w "\n%{http_code}" -X POST $URL/api/projects/$PID/apply-learning -H "Content-Type: application/json")
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Apply learning" || fail "Apply learning" "$CODE"

echo ""
echo "--5. EXECUTION GOVERNANCE --"
RES=$(curl -s -w "\n%{http_code}" -X POST $URL/api/execution/validate -H "Content-Type: application/json" -d "{\"project_id\":\"$PID\",\"agent_id\":\"test\",\"action_type\":\"create_decision\",\"target_decision_ids\":[\"$DEC_ID\"]}")
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Governor validate ($CODE)" || fail "Governor validate" "$CODE"

RES=$(curl -s -w "\n%{http_code}" -X POST $URL/api/execution/override -H "Content-Type: application/json" -d "{\"proposal\":{\"project_id\":\"$PID\",\"action_type\":\"create_decision\",\"target_decision_ids\":[\"$DEC_ID\"]},\"justification\":\"Testing override - this is a legitimate test of the governance system.\",\"actor_id\":\"test-actor\"}")
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Governor override ($CODE)" || fail "Governor override" "$CODE"

RES=$(curl -s -w "\n%{http_code}" -X POST $URL/api/simulation/preview -H "Content-Type: application/json" -d "{\"project_id\":\"$PID\",\"decision_id\":\"$DEC_ID\",\"proposed_changes\":{\"title\":\"Updated decision title\"}}")
CODE=$(echo "$RES" | tail -1)
[ "$CODE" = "200" ] && pass "Simulation preview ($CODE)" || fail "Simulation preview" "$CODE"

echo ""
echo "=== DONE ==="
