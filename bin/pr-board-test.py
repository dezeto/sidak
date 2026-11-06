# Self-check for pr-board auto's flaky-CI classifier (checks), change requests (asks) and model Auto (pick): python3 bin/pr-board-test.py prints ok.
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
# asks: a thread left open is a change request until a fix has run after its last comment.
import datetime
iso = lambda text: datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
key = lambda pr: "x/y#1"
exec(src[src.index('def asks'):src.index('# Failing checks')])
now = iso("2026-11-06T12:00:00Z")
thread = {"isResolved": False, "comments": {"nodes": [{"author": {"login": "alf"}, "createdAt": "2026-11-06T10:00:00Z"}]}}
mine = {"author": {"login": "me"}, "commits": {"nodes": [{"commit": {"committedDate": "2026-11-06T09:00:00Z"}}]},
        "reviewThreads": {"nodes": [thread]}, "latestReviews": {"nodes": []}}
log = []
assert asks(mine)
log = [{"pr": "x/y#1", "kind": "fix", "at": iso("2026-11-06T11:00:00Z") * 1000}]
assert not asks(mine)
log = [{"pr": "x/y#1", "kind": "fix", "at": iso("2026-11-06T09:30:00Z") * 1000}]
assert asks(mine)
# pick: Opus only for a risky Deep and a fix; a second look and a Skim on Sonnet medium; a fixed model passes through.
exec(src[src.index('RISKY = ['):src.index('def depth_of')])
exec(src[src.index('def pick'):src.index('# One fix a tick')])
settings = {"model": "auto"}
assert pick("fix") == ("opus", "high")
assert pick("full", "auth or security code, 4114 lines") == ("opus", "high")
assert pick("full", "auth or security code, 4114 lines", again=True) == ("sonnet", "medium")
assert pick("full", "967 lines") == ("sonnet", "high")
assert pick("quick") == ("sonnet", "medium")
settings = {"model": "opus", "effort": "medium"}
assert pick("quick") == ("opus", "medium")
print("ok")
