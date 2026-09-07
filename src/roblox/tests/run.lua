-- Runs in Studio test builds and via Python/lupa for pure behavior verification.
if game then
    local modules = game:GetService("ReplicatedStorage"):WaitForChild("LectioModules")
    ReadingSession = require(modules.ReadingSession)
    TextSegments = require(modules.TextSegments)
    Narration = require(modules.Narration)
    DrawRequests = require(game:GetService("ServerScriptService").DrawRequests)
end
local s = ReadingSession.new()
s:dispatch({type="near",value=true})
s:dispatch({type="begin",id="a"})
s:dispatch({type="contact"})
s:dispatch({type="near",value=false})
s:dispatch({type="received",id="a",reading={verses={{textEn="one"},{textEn="two"}}}})
assert(s:snapshot().phase == "paused")
s:dispatch({type="received",id="old",reading={verses={}}})
assert(#s:snapshot().reading.verses == 2)
s:dispatch({type="select",page=2})
s:dispatch({type="respawn"})
assert(s:snapshot().page == 2 and s:snapshot().phase == "paused")
s:dispatch({type="resume"})
assert(s:snapshot().phase == "paused")
s:dispatch({type="near",value=true})
assert(s:snapshot().phase == "paused")
s:dispatch({type="resume"})
assert(s:snapshot().phase == "reading")
s:dispatch({type="select",page=90})
assert(s:snapshot().page == 2)
s:dispatch({type="language",lang="zh"})
assert(s:snapshot().lang == "zh")
s:dispatch({type="finish"}); s:dispatch({type="closed"})
assert(s:snapshot().phase == "idle" and s:snapshot().reading == nil)

local q = DrawRequests.new()
assert(q:begin(1,"a") == "start")
assert(q:begin(1,"a") == "pending")
assert(q:begin(1,"b") == "blocked")
q:uncertain(1,"a")
assert(q:begin(1,"a") == "blocked")
assert(q:begin(1,"b") == "blocked")
assert(q:begin(2,"a") == "start")
local result = {status="complete",response={ok=true}}
q:complete(2,"a",result)
local status, cached = q:begin(2,"a")
assert(status == "cached" and cached == result)
local offline = 0
result = DrawRequests.executeDraw("live",function() return {kind="uncertain"} end,
    function() offline=offline+1 end)
assert(result.kind == "uncertain" and offline == 0)
result = DrawRequests.executeDraw("offline",function() error("unexpected live call") end,
    function() offline=offline+1; return {ok=true} end)
assert(result.kind == "complete" and offline == 1)

local text = string.rep("爱与平安。",100)
local chunks = TextSegments.split(text,180)
assert(table.concat(chunks) == text)
for _, chunk in ipairs(chunks) do assert(utf8.len(chunk) <= 180) end
assert(#TextSegments.split("",180) == 0)
local stopped, callbacks = 0, {}
local driver = {start=function(_,_,cb)
    table.insert(callbacks,cb)
    return {pause=function() end,resume=function() end,stop=function() stopped=stopped+1 end}
end}
local state = ""
local n = Narration.new(driver,function(v) state=v end)
n:play({textEn="first"},"en")
n:play({textZh="第二"},"zh")
assert(stopped == 1)
callbacks[1]("ended")
assert(state ~= "ended")
n:destroy()
assert(stopped == 2)
print("Native reading behavior assertions passed")
