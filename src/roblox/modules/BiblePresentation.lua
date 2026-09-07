local TweenService=game:GetService("TweenService")
local Players=game:GetService("Players")
local Segments=require(script.Parent.TextSegments)
local Presentation={}
Presentation.__index=Presentation
local ink=Color3.fromRGB(63,49,34)
local paper=Color3.fromRGB(250,241,218)
local function make(class,props,parent)
    local o=Instance.new(class)
    for k,v in pairs(props) do o[k]=v end
    o.Parent=parent
    return o
end
local function round(o) make("UICorner",{CornerRadius=UDim.new(0,10)},o) end
function Presentation.new(anchors,onAction)
    return setmetatable({anchors=anchors,onAction=onAction,segment=1,pages={},bookmarks={},hidden={},hiddenGuis={},tweens={},generation=0},Presentation)
end
function Presentation:tween(object,seconds,props)
    local t=TweenService:Create(object,TweenInfo.new(seconds,Enum.EasingStyle.Sine,Enum.EasingDirection.InOut),props)
    table.insert(self.tweens,t); t:Play()
end
function Presentation:clear()
    self.generation=self.generation+1
    for _,t in ipairs(self.tweens) do t:Cancel() end
    self.tweens={}
    self:releaseCamera()
    for _,g in ipairs(self.bookmarks) do g:Destroy() end
    self.bookmarks={}
    if self.folder then self.folder:Destroy(); self.folder=nil end
    if self.gui then self.gui:Destroy(); self.gui=nil end
    for part,value in pairs(self.hidden) do if part.Parent then part.LocalTransparencyModifier=value end end
    for gui,value in pairs(self.hiddenGuis) do if gui.Parent then gui.Enabled=value end end
    self.hiddenGuis={}
    self.hidden={}; self.pages={}; self.key=nil
end
function Presentation:releaseCamera()
    if self.cameraState then
        local saved=self.cameraState
        if saved.camera.CameraType==Enum.CameraType.Scriptable then
            saved.camera.CameraType=saved.kind
            saved.camera.CFrame=saved.cframe
        end
        self.cameraState=nil
    end
end
function Presentation:ensureBook()
    if self.folder then return end
    self.folder=make("Folder",{Name="LectioPersonalReading"},workspace)
    self.book=self.anchors.visual:Clone()
    for _,o in ipairs(self.book:GetDescendants()) do
        if o:IsA("ProximityPrompt") or o:IsA("ClickDetector") then o:Destroy()
        elseif o:IsA("BasePart") then o.CanCollide=false; o.CanTouch=false; o.CanQuery=false end
    end
    self.book.Parent=self.folder
    self.closedLeft=self.book.CoverLeft.CFrame
    self.closedRight=self.book.CoverRight.CFrame
    for _,o in ipairs(self.anchors.visual:GetDescendants()) do
        if o:IsA("BasePart") then self.hidden[o]=o.LocalTransparencyModifier; o.LocalTransparencyModifier=1 end
        if o:IsA("SurfaceGui") then self.hiddenGuis[o]=o.Enabled; o.Enabled=false end
    end
end
function Presentation:createPage(i,cf)
    return make("Part",{Name="ReadingPage"..i,Size=Vector3.new(2.1,2.8,0.045),
        Color=paper,Material=Enum.Material.SmoothPlastic,Anchored=true,CanCollide=false,
        CanTouch=false,CanQuery=false,CFrame=cf,CastShadow=false},self.folder)
end
function Presentation:refreshText()
    if not self.body or not self.snapshot or not self.snapshot.reading then return end
    local s=self.snapshot
    local verse=s.reading.verses[s.page]
    local text=s.lang=="zh" and verse.textZh or verse.textEn
    self.chunks=Segments.split(text or "",180)
    self.segment=math.max(1,math.min(self.segment,math.max(1,#self.chunks)))
    self.body.Text=self.showReflection and ((verse.interp and verse.interp~="") and verse.interp or (s.lang=="zh" and "暂无默想。" or "No reflection available.")) or (self.chunks[self.segment] or "")
    if self.showSummary then self.body.Text=s.reading.summary or "" end
    self.ref.Text=(s.lang=="zh" and verse.refZh or verse.refEn) or ""
    self.progress.Text=string.format("%d / %d   ·   %d / %d",s.page,#s.reading.verses,self.segment,math.max(1,#self.chunks))
    self.heading.Text=self.showSummary and (s.lang=="zh" and "阅读小结" or "Reading summary") or (self.showReflection and (s.lang=="zh" and "默想 · 原始语言" or "Reflection · original language") or ((s.reading.labels or {})[s.page] or (s.lang=="zh" and "经文" or "Scripture")))
end
function Presentation:buildBubble(page)
    if self.gui then self.gui:Destroy() end
    local viewport=workspace.CurrentCamera.ViewportSize
    local width=math.min(380,math.max(240,viewport.X-24))
    local height=math.min(410,math.max(260,viewport.Y-48))
    local bodyHeight=height-236
    self.gui=make("BillboardGui",{Name="PersonalVerseBubble",Adornee=page,
        Size=UDim2.fromOffset(width,height),StudsOffsetWorldSpace=Vector3.new(0,0,0),
        AlwaysOnTop=true,MaxDistance=24,Active=true,ResetOnSpawn=false},Players.LocalPlayer:WaitForChild("PlayerGui"))
    local frame=make("Frame",{Size=UDim2.fromScale(1,1),BackgroundColor3=paper,BorderSizePixel=0},self.gui)
    round(frame)
    local function label(y,h,size)
        return make("TextLabel",{Position=UDim2.new(0,14,0,y),Size=UDim2.new(1,-28,0,h),
            BackgroundTransparency=1,TextColor3=ink,Font=Enum.Font.Gotham,TextSize=size,
            TextWrapped=true,Text=""},frame)
    end
    self.heading=label(8,22,13)
    local scroll=make("ScrollingFrame",{Position=UDim2.new(0,14,0,34),Size=UDim2.new(1,-28,0,bodyHeight),
        BackgroundTransparency=1,BorderSizePixel=0,ScrollBarThickness=4,CanvasSize=UDim2.new(),AutomaticCanvasSize=Enum.AutomaticSize.Y},frame)
    self.body=make("TextLabel",{Size=UDim2.new(1,-8,0,0),AutomaticSize=Enum.AutomaticSize.Y,
        BackgroundTransparency=1,TextColor3=ink,Font=Enum.Font.Gotham,TextSize=19,
        TextWrapped=true,TextYAlignment=Enum.TextYAlignment.Top,Text=""},scroll)
    self.ref=label(37+bodyHeight,24,16); self.progress=label(63+bodyHeight,18,12); self.audio=label(84+bodyHeight,18,12)
    local zh=self.snapshot.lang=="zh"
    local function button(text,index,row,callback)
        local b=make("TextButton",{Text=text,Position=UDim2.new((index-1)/3,5,0,108+bodyHeight+row*40),
            Size=UDim2.new(1/3,-10,0,36),BackgroundColor3=Color3.fromRGB(225,211,177),
            TextColor3=ink,TextSize=13,Font=Enum.Font.Gotham,Selectable=true,BorderSizePixel=0},frame)
        round(b); b.Activated:Connect(callback)
    end
    button(zh and "重播" or "Replay",1,0,function() self.onAction({type="replay"}) end)
    button(zh and "暂停" or "Pause",2,0,function() self.onAction({type="pause"}) end)
    button(zh and "继续" or "Resume",3,0,function() self.onAction({type="resume"}) end)
    button(zh and "上一页" or "Previous",1,1,function() self.onAction({type="previous"}) end)
    button(zh and "下一页" or "Next page",2,1,function() self.onAction({type="next"}) end)
    button(zh and "结束" or "Finish",3,1,function() self.onAction({type="finish"}) end)
    button(zh and "下一段" or "More text",1,2,function()
        self.showReflection=false; self.showSummary=false
        self.onAction({type="segment"})
        self.segment=self.segment%math.max(1,#self.chunks)+1; self:refreshText()
    end)
    button(zh and "默想 / 经文" or "Reflection",2,2,function()
        self.showSummary=false; self.showReflection=not self.showReflection; self:refreshText()
    end)
    button(zh and "小结" or "Summary",3,2,function()
        if self.snapshot.page == #self.snapshot.reading.verses then self.showSummary=true; self:refreshText() end
    end)
    self:refreshText()
end
function Presentation:setAudioState(state)
    if type(state)=="table" then
        self.segment=state.segment or self.segment
        if not self.showReflection and not self.showSummary then self:refreshText() end
        state=state.status
    end
    if self.audio then
        local zh=self.snapshot and self.snapshot.lang=="zh"
        local names=zh and {unavailable="语音暂不可用",loading="准备语音…",playing="正在朗读",paused="已暂停",ended="朗读结束",muted="语音已关闭"} or
            {unavailable="Audio unavailable",loading="Preparing voice…",playing="Reading aloud",paused="Paused",ended="Reading complete",muted="Narration muted"}
        self.audio.Text=names[state] or ""
    end
end
function Presentation:render(s,settings)
    self.snapshot=s
    if s.phase=="idle" or s.phase=="failed" or s.phase=="uncertain" or s.phase=="paused" then self:clear(); return end
    self:ensureBook()
    local duration=settings.reducedMotion and 0.08 or 0.65
    if s.phase=="reaching" and self.key~="reaching" then
        self.key="reaching"
        if not settings.reducedMotion then
            local camera=workspace.CurrentCamera
            self.cameraState={camera=camera,kind=camera.CameraType,cframe=camera.CFrame}
            camera.CameraType=Enum.CameraType.Scriptable
            local target=self.anchors.contact.Position
            self:tween(camera,0.3,{CFrame=CFrame.lookAt(target+Vector3.new(4,3,6),target)})
            local generation=self.generation
            task.delay(0.95,function() if self.generation==generation then self:releaseCamera() end end)
        end
    end
    if s.phase=="closing" then
        for _,page in ipairs(self.pages) do self:tween(page,duration,{CFrame=self.anchors.altar.CFrame,Transparency=1}) end
        self:tween(self.book.CoverLeft,duration,{CFrame=self.closedLeft})
        self:tween(self.book.CoverRight,duration,{CFrame=self.closedRight})
        return
    end
    if s.phase=="loading" and self.key~="loading" then
        self.key="loading"
        local hinge=self.anchors.altar.CFrame
        local generation=self.generation
        if not settings.reducedMotion then
            self:tween(self.book.CoverLeft,duration/2,{CFrame=hinge*CFrame.Angles(0,0,math.rad(-70))*CFrame.new(-1.1,0,0)})
            self:tween(self.book.CoverRight,duration/2,{CFrame=hinge*CFrame.Angles(0,0,math.rad(70))*CFrame.new(1.1,0,0)})
        end
        task.delay(settings.reducedMotion and 0 or duration/2,function()
            if self.generation~=generation or not self.folder then return end
            self:tween(self.book.CoverLeft,duration/2,{CFrame=hinge*CFrame.new(-1.1,0,0)})
            self:tween(self.book.CoverRight,duration/2,{CFrame=hinge*CFrame.new(1.1,0,0)})
        end)
        if not settings.reducedMotion then
            for i=1,3 do
                local p=self:createPage(i,hinge*CFrame.Angles(math.pi/2,0,0))
                self:tween(p,0.4+i*0.15,{CFrame=hinge*CFrame.Angles(math.pi/2,0,math.rad(150)),Transparency=1})
            end
        end
    end
    if not s.reading then return end
    local key=tostring(s.reading)..":"..s.page..":"..s.lang
    if key==self.key then return end
    self.key=key; self.segment=1; self.showReflection=false; self.showSummary=false
    local destination=self.anchors.destination.CFrame
    for i=1,s.page do
        if not self.pages[i] then self.pages[i]=self:createPage(i,self.anchors.altar.CFrame*CFrame.Angles(math.pi/2,0,0)) end
    end
    for _,g in ipairs(self.bookmarks) do g:Destroy() end
    self.bookmarks={}
    for i,page in ipairs(self.pages) do
        local target=i==s.page and destination or destination*CFrame.new(2.4+(i-1)*0.06,-1.2+(i-1)*0.07,-0.2)
        if i==s.page and not settings.reducedMotion then
            local midpoint=page.CFrame:Lerp(target,0.5)+Vector3.new(0,0.9,0)
            self:tween(page,duration/2,{CFrame=midpoint,Transparency=0})
            local generation=self.generation
            task.delay(duration/2,function()
                if self.generation==generation and page.Parent and self.key==key then self:tween(page,duration/2,{CFrame=target}) end
            end)
        else self:tween(page,duration,{CFrame=target,Transparency=i==s.page and 0 or 0.18}) end
        if i~=s.page then
            local bookmark=make("BillboardGui",{Name="PageBookmark",Adornee=page,StudsOffsetWorldSpace=Vector3.new((i-1)*0.35,0,0),Size=UDim2.fromOffset(44,44),AlwaysOnTop=true,Active=true,ResetOnSpawn=false},Players.LocalPlayer.PlayerGui)
            table.insert(self.bookmarks,bookmark)
            local b=make("TextButton",{Size=UDim2.fromScale(1,1),Text=tostring(i),BackgroundColor3=paper,TextColor3=ink,TextSize=16},bookmark)
            b.Activated:Connect(function() self.onAction({type="select",page=i}) end)
        end
    end
    self:buildBubble(self.pages[s.page])
end
function Presentation:destroy() self:clear() end
return Presentation
