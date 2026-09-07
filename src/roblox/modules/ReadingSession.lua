local Session = {}
Session.__index = Session
function Session.new()
    return setmetatable({phase="idle",page=1,lang="en",near=false},Session)
end
function Session:snapshot()
    return {phase=self.phase,page=self.page,lang=self.lang,near=self.near,
        requestId=self.requestId,reading=self.reading}
end
function Session:dispatch(e)
    local t = e.type
    if t == "near" then
        self.near = e.value
        if not self.near and self.phase ~= "idle" and self.phase ~= "failed" and self.phase ~= "uncertain" and self.phase ~= "closing" then
            if self.phase == "reaching" then self.phase="idle"; self.requestId=nil
            else self.phase="paused" end
        end
    elseif t == "begin" and self.near and (self.phase == "idle" or self.phase == "failed") then
        self.requestId=e.id; self.phase="reaching"; self.page=1; self.reading=nil
    elseif t == "contact" and self.phase == "reaching" then self.phase="loading"
    elseif t == "received" and e.id == self.requestId and not self.reading then
        self.reading=e.reading; self.page=1
        self.phase=(self.near and self.phase == "loading") and "revealing" or "paused"
    elseif t == "revealed" and self.phase == "revealing" then self.phase="reading"
    elseif t == "select" and self.reading and self.phase ~= "closing" then
        self.page=math.max(1,math.min(#self.reading.verses,e.page))
    elseif t == "language" and (e.lang == "en" or e.lang == "zh") then self.lang=e.lang
    elseif t == "pause" and self.reading then self.phase="paused"
    elseif t == "resume" and self.near and self.reading and self.phase == "paused" then self.phase="reading"
    elseif t == "finish" and self.reading then self.phase="closing"
    elseif t == "closed" and self.phase == "closing" then
        self.phase="idle"; self.reading=nil; self.requestId=nil; self.page=1
    elseif t == "failure" and e.id == self.requestId and not self.reading then
        self.phase=e.uncertain and "uncertain" or "failed"
        if not e.uncertain then self.requestId=nil end
    elseif t == "respawn" then
        self.near=false
        if self.phase == "reaching" then self.phase="idle"; self.requestId=nil
        elseif self.phase ~= "idle" and self.phase ~= "uncertain" and self.phase ~= "failed" and self.phase ~= "closing" then self.phase="paused" end
    end
    return self:snapshot()
end
return Session
