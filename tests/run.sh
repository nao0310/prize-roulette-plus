#!/bin/sh
# すべてのテストを、ローカルサーバー（http）と file:// の両方で実行する
# 例：sh tests/run.sh          公平性は 1000回×3本
#     FAIR_ROUNDS=4000 sh tests/run.sh
cd "$(dirname "$0")/.." || exit 1
status=0
for mode in http file; do
  echo "===== MODE=$mode ====="
  MODE=$mode node --test --test-concurrency=1 tests/*.test.js || status=1
done
exit $status
