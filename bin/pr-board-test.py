# Self-check for pr-board auto's flaky-CI classifier (checks): python3 bin/pr-board-test.py prints ok.
import re, subprocess
src = open(__import__("os").path.join(__import__("os").path.dirname(__file__), "pr-board")).read()
def last_commit(pr): return pr["commits"]["nodes"][0]["commit"]
exec(src[src.index('import re\nINFRA'):src.index('def why_fix')])
def pr(*nodes, state="FAILURE"): return {"repository": {"nameWithOwner": "x/y"}, "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": state, "contexts": {"nodes": list(nodes)}}}}]}}
url = lambda r: f"https://github.com/x/y/actions/runs/{r}/job/9"
timeout = {"name": "test", "databaseId": 1, "status": "COMPLETED", "conclusion": "TIMED_OUT", "detailsUrl": url(11)}
gate = {"name": "merge-gatekeeper", "databaseId": 2, "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": url(22)}
assert checks(pr(timeout, gate)) == ("flaky", {"11", "22"})
assert checks(pr(dict(timeout, status="IN_PROGRESS"), gate)) == (None, set())
assert checks(pr({"state": "FAILURE"}, timeout)) == ("failing", set())
assert checks(pr(timeout, state="SUCCESS")) == (None, set())
assert checks(pr(dict(timeout, conclusion="STARTUP_FAILURE", detailsUrl="https://ci.example/x"))) == ("failing", set())
print("ok")
