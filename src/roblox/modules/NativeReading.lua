local Players=game:GetService("Players")
local HttpService=game:GetService("HttpService")
local Session=require(script.Parent.ReadingSession)
local Presentation=require(script.Parent.BiblePresentation)
local Interaction=require(script.Parent.BibleInteraction)
local Narration=require(script.Parent.Narration)
local SpeechDriver=require(script.Parent.SpeechDriver)
local Native={}
Native.__index=Native
function Native.new(remotes,options)
    local self=setmetatable({remotes=remotes,options=options,session=Session.new(),
        settings={reducedMotion=false,narrationMuted=false},mode="daily"},Native)
    self.anchors={altar=workspace:WaitForChild("AltarBible"),visual=workspace:WaitForChild("BibleVisual"),
        contact=workspace:WaitForChild("Contact"),destination=workspace:WaitForChild("PageDestination")}
    self.presenter=Presentation.new(self.anchors,function(e) self:action(e) end)
    self.narrator=Narration.new(SpeechDriver,function(state) self.presenter:setAudioState(state) end)
    self.interaction=Interaction.new(self.anchors,function(e)
        if e.type=="activate" then self:activate()
        elseif e.type=="options" then options.openOptions()
        elseif e.type=="mode" then
            self.mode=e.mode; options.setMode(e.mode); self:render()
        elseif e.type=="near" then
            self.session:dispatch(e)
            if not e.value then self.narrator:pause() end
            self:render()
        end
    end)
    self.respawn=Players.LocalPlayer.CharacterRemoving:Connect(function()
        self.session:dispatch({type="respawn"}); self.narrator:stop(); self:render()
    end)
    self.activity=remotes.LectioActivity.OnClientEvent:Connect(function(id)
        if id==Players.LocalPlayer.UserId then return end
        local other=Players:GetPlayerByUserId(id)
        if other then Interaction.gesture(other.Character,self.anchors.contact) end
    end)
    return self
end
function Native:render()
    local s=self.session:snapshot()
    self.presenter:render(s,self.settings)
    if self.interaction then
        self.interaction:setEnabled(s.phase=="idle" or s.phase=="failed" or (s.phase=="paused" and s.reading~=nil))
        self.interaction:setLanguage(s.lang,self.mode,s.phase=="paused")
    end
end
function Native:play()
    local s=self.session:snapshot()
    if not s.reading or s.phase~="reading" or not s.near then return end
    if self.settings.narrationMuted then self.presenter:setAudioState("muted"); return end
    self.narrator:play(s.reading.verses[s.page],s.lang)
end
function Native:setLanguage(lang)
    self.session:dispatch({type="language",lang=lang})
    local reading=self.session.reading
    if reading then
        reading.labels=self.options.labels(reading.mode,#reading.verses)
        reading.title=(reading.mode=="today" and (lang=="zh" and reading.titleZh or reading.titleEn)) or self.options.title(reading.mode)
    end
    self.narrator:stop(); self:render()
end
function Native:activate(mode)
    local s=self.session:snapshot()
    if s.phase=="paused" and s.reading then self:action({type="resume"}); return end
    if mode then self.mode=mode end
    if not s.near or not self.interaction:isWithinReach() then self.options.toast("approachBible"); return end
    self.session:dispatch({type="language",lang=self.options.language()})
    local id=HttpService:GenerateGUID(false)
    self.session:dispatch({type="begin",id=id})
    if self.session.requestId~=id then return end
    self:render()
    self.remotes.LectioActivity:FireServer()
    local drawMode=self.mode
    local drawLang=self.session.lang
    local topic=self.options.topic()
    self.interaction:reach(function()
        if self.session.phase~="reaching" then return end
        self.session:dispatch({type="contact"}); self:render()
        if drawMode=="today" then self.remotes.LectioToday:FireServer(drawLang,id)
        else self.remotes.LectioExplore:FireServer(topic,drawMode,drawLang,id) end
        task.delay(45,function()
            if self.session.requestId==id and not self.session.reading then
                self.session:dispatch({type="failure",id=id,uncertain=true})
                self.narrator:stop(); self:render(); self.options.toast("drawUncertain")
            end
        end)
    end)
end
function Native:receive(envelope,today)
    if type(envelope)~="table" or envelope.requestId~=self.session.requestId then return end
    local response=envelope.response
    if envelope.status~="complete" or type(response)~="table" or not response.ok then
        self.session:dispatch({type="failure",id=envelope.requestId,uncertain=envelope.status=="uncertain"})
        self.narrator:stop(); self:render()
        self.options.toast(envelope.status=="uncertain" and "drawUncertain" or (response and response.errorKey or "backendError"))
        return
    end
    if self.session.reading then return end
    local verses=today and response.steps or response.verses
    if type(verses)~="table" or #verses==0 then return end
    for _,v in ipairs(verses) do v.textEn=v.textEn or v.en or ""; v.textZh=v.textZh or v.zh or "" end
    local labels=self.options.labels(today and "today" or response.mode or "daily",#verses)
    local title=today and (self.session.lang=="zh" and response.titleZh or response.titleEn) or self.options.title(response.mode)
    local reading={verses=verses,labels=labels,title=title or "Lectio",titleEn=response.titleEn,titleZh=response.titleZh,summary=response.summary or "",topic=response.topic or "",mode=response.mode or "today"}
    self.session:dispatch({type="received",id=envelope.requestId,reading=reading})
    self.options.accept(reading,response.state)
    self:render()
    task.delay(self.settings.reducedMotion and 0.1 or 0.7,function()
        if self.session.requestId~=envelope.requestId then return end
        self.session:dispatch({type="revealed"}); self:render(); self:play()
    end)
end
function Native:action(e)
    local s=self.session:snapshot()
    if e.type=="replay" then self:play()
    elseif e.type=="pause" or e.type=="segment" then self.narrator:pause()
    elseif e.type=="resume" then
        if s.phase=="paused" then self.session:dispatch({type="resume"}); self:render(); self:play()
        elseif s.phase=="reading" then self.narrator:resume() end
    elseif e.type=="next" or e.type=="previous" or e.type=="select" then
        if not s.reading then return end
        local page=e.page or (s.page+(e.type=="next" and 1 or -1))
        if page<1 or page>#s.reading.verses or page==s.page then return end
        self.narrator:stop(); self.session:dispatch({type="select",page=page}); self:render(); self:play()
    elseif e.type=="finish" then
        if not s.reading or s.phase=="closing" then return end
        self.narrator:stop(); self.session:dispatch({type="finish"}); self:render()
        task.delay(self.settings.reducedMotion and 0.1 or 0.7,function()
            self.session:dispatch({type="closed"}); self.options.accept(nil); self:render()
        end)
    end
end
function Native:toggleMute()
    self.settings.narrationMuted=not self.settings.narrationMuted
    self.narrator:stop(); self.presenter:setAudioState(self.settings.narrationMuted and "muted" or "paused")
    return self.settings.narrationMuted
end
function Native:toggleMotion()
    self.settings.reducedMotion=not self.settings.reducedMotion
    return self.settings.reducedMotion
end
function Native:destroy()
    self.interaction:destroy(); self.presenter:destroy(); self.narrator:destroy()
    self.respawn:Disconnect(); self.activity:Disconnect()
end
return Native
