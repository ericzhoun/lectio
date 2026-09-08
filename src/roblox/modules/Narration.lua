-- Pure playback ownership; Roblox driver is supplied at composition time.
local Narration={}
Narration.__index=Narration
function Narration.new(driver,onState)
    return setmetatable({driver=driver,onState=onState,generation=0},Narration)
end
function Narration:stop()
    self.generation=self.generation+1
    if self.playback then self.playback.stop(); self.playback=nil end
    self.onState("idle")
end
function Narration:play(verse,lang)
    self:stop()
    local text=lang == "zh" and verse.textZh or verse.textEn
    if not text or text == "" then self.onState("unavailable"); return end
    local generation=self.generation
    self.onState("loading")
    local ok,playback=pcall(self.driver.start,text,lang,function(state)
        if self.generation == generation then self.onState(state) end
    end)
    if ok then self.playback=playback else self.onState("unavailable") end
end
function Narration:pause()
    if self.playback then self.playback.pause(); self.onState("paused") end
end
function Narration:resume()
    if self.playback then self.playback.resume() end
end
function Narration:destroy() self:stop() end
return Narration
