-- Test the real composition/controller with engine-dependent presentation replaced.
local function connection() return {Disconnect=function() end} end
local player={CharacterRemoving={Connect=function(_,fn) onRespawn=fn; return connection() end}}
local guid=0
local http={GenerateGUID=function() guid=guid+1; return "request-"..guid end}
game={GetService=function(_,name)
    if name=="Players" then return {LocalPlayer=player,GetPlayerByUserId=function() end} end
    if name=="HttpService" then return http end
end}
workspace={WaitForChild=function(_,name) return {Name=name} end}
local timers={}
task={delay=function(seconds,fn) table.insert(timers,{seconds=seconds,fn=fn}) end}
function shortTimers()
    local old=timers; timers={}
    for _,t in ipairs(old) do if t.seconds<2 then t.fn() else table.insert(timers,t) end end
end
function timeoutTimers()
    local old=timers; timers={}
    for _,t in ipairs(old) do t.fn() end
end
local presenter={render=function(_,snapshot) rendered=snapshot end,setAudioState=function() end,destroy=function() end}
local interaction={setEnabled=function() end,setLanguage=function() end,
    reach=function(_,fn) fn() end,destroy=function() end,isWithinReach=function() return true end}
local starts=0
local speech={start=function()
    starts=starts+1
    return {pause=function() end,resume=function() end,stop=function() end}
end}
function speechStarts() return starts end
local modules={ReadingSession=ReadingSession,Narration=Narration,
    BiblePresentation={new=function() return presenter end},
    BibleInteraction={new=function(_,fn) interactionAction=fn; return interaction end},SpeechDriver=speech}
script={Parent=modules}
require=function(module) return assert(module) end
calls=0
remotes={
    LectioExplore={FireServer=function(_,topic,mode,lang,id) calls=calls+1; requestId=id end},
    LectioToday={FireServer=function(_,lang,id) calls=calls+1; requestId=id end},
    LectioActivity={FireServer=function() end,OnClientEvent={Connect=function() return connection() end}},
}
options={language=function() return "en" end,topic=function() return "peace" end,
    setMode=function() end,labels=function() return {"Reading"} end,title=function() return "Daily Word" end,
    toast=function(key) lastToast=key end,accept=function(value) accepted=value end}
