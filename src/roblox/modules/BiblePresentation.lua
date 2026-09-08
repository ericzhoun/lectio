local TweenService=game:GetService("TweenService")
local Players=game:GetService("Players")
local RunService=game:GetService("RunService")
local Segments=require(script.Parent.TextSegments)
local ReadingText=require(script.Parent.ReadingText)
local ReadingLayout=require(script.Parent.ReadingLayout)
local Practice=require(script.Parent.ReadingPractice)
local Theme=require(script.Parent.ReadingTheme)
local Presentation={}
Presentation.__index=Presentation
local ink=Theme.text
local paper=Theme.panel
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
    if self.layoutConnection then self.layoutConnection:Disconnect(); self.layoutConnection=nil end
    self:releaseCamera()
    for _,g in ipairs(self.bookmarks) do g:Destroy() end
    self.bookmarks={}
    if self.folder then self.folder:Destroy(); self.folder=nil end
    if self.gui then self.gui:Destroy(); self.gui=nil end
    for part,value in pairs(self.hidden) do if part.Parent then part.LocalTransparencyModifier=value end end
    for gui,value in pairs(self.hiddenGuis) do if gui.Parent then gui.Enabled=value end end
    self.hiddenGuis={}
    self.hidden={}; self.pages={}; self.key=nil; self.body=nil; self.audio=nil
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
function Presentation:allowsNarration()
    return Practice.get(self.movement,self.snapshot and self.snapshot.lang).narrate
end
function Presentation:selectMovement(movement)
    self.movement=movement
    self.manualCollapsed=movement=="contemplatio"
    self.onAction({type="pause"})
    self:refreshText()
    if self.scroll then self.scroll.CanvasPosition=Vector2.new(0,0) end
    if self:allowsNarration() then self.onAction({type="replay"}) end
    self:updateLayout()
end
function Presentation:refreshText()
    if not self.body or not self.snapshot or not self.snapshot.reading then return end
    local s=self.snapshot
    local verse=s.reading.verses[s.page]
    local text=s.lang=="zh" and verse.textZh or verse.textEn
    self.chunks=Segments.split(text or "",180)
    self.segment=math.max(1,math.min(self.segment,math.max(1,#self.chunks)))
    local practice=Practice.get(self.movement,s.lang)
    local content=ReadingText.build(s.reading,s.page,s.lang,self.compact and text or self.chunks[self.segment] or "",practice.view)
    self.body.Text=practice.view=="prompt" and practice.prompt or content.body
    if practice.view=="summary" then self.body.Text=self.body.Text.."\n\n"..practice.prompt end
    self.ref.Text=string.format("%s   ·   %d / %d",(s.lang=="zh" and verse.refZh or verse.refEn) or "",s.page,#s.reading.verses)
    self.heading.Text=s.reading.title or "Lectio"
    local nextMovement=Practice.next(self.movement)
    self.movementButton.Text=string.format("%d / 6 · %s  →  %s",practice.index,practice.title,
        nextMovement and Practice.get(nextMovement,s.lang).title or (s.lang=="zh" and "静默" or "Stillness"))
    for _,tab in ipairs(self.tabs) do
        tab.button.BackgroundColor3=practice.view==tab.view and Theme.green or Theme.panel2
        tab.button.TextColor3=practice.view==tab.view and Theme.cream or ink
    end
    self.moreButton.Text=s.lang=="zh" and "下一段" or "More text"
    self.moreButton.Active=#self.chunks>1 and practice.narrate
    self.moreButton.AutoButtonColor=self.moreButton.Active
    self.moreButton.TextTransparency=self.moreButton.Active and 0 or 0.55
    self.handle.Text=self.movement=="contemplatio" and (s.lang=="zh" and "安歇片刻 · 继续 →" or "Rest a while · Continue →") or
        (s.lang=="zh" and "阅读已保留 · 拉远视角以阅读" or "Reading held · zoom out to read")
end
-- Project whole objects, not world-X offsets. A camera orbit must not move text over the book.
function Presentation:protectedRects(camera)
    local rects={}
    local function protect(cf,size)
        local minX,minY,maxX,maxY=math.huge,math.huge,-math.huge,-math.huge
        local front,behind=false,false
        for _,x in ipairs({-0.5,0.5}) do for _,y in ipairs({-0.5,0.5}) do for _,z in ipairs({-0.5,0.5}) do
            local p=camera:WorldToViewportPoint(cf*Vector3.new(size.X*x,size.Y*y,size.Z*z))
            if p.Z>0 then
                front=true; minX=math.min(minX,p.X); minY=math.min(minY,p.Y)
                maxX=math.max(maxX,p.X); maxY=math.max(maxY,p.Y)
            else behind=true end
        end end end
        if front and behind then
            table.insert(rects,{x=0,y=0,width=camera.ViewportSize.X,height=camera.ViewportSize.Y})
        elseif front then table.insert(rects,{x=minX-12,y=minY-12,width=maxX-minX+24,height=maxY-minY+24}) end
    end
    protect(self.anchors.visual:GetBoundingBox())
    if self.book then protect(self.book:GetBoundingBox()) end
    local character=Players.LocalPlayer.Character
    if character then protect(character:GetBoundingBox()) end
    if self.bubblePage and self.bubblePage.Parent then protect(self.bubblePage.CFrame,self.bubblePage.Size) end
    return rects
end
function Presentation:updateLayout()
    if not self.gui or not self.card then return end
    local camera=workspace.CurrentCamera
    if not camera then return end
    local viewport=camera.ViewportSize
    local protected=self:protectedRects(camera)
    local layout=ReadingLayout.place(viewport.X,viewport.Y,protected,self.edge)
    self.gui.Enabled=layout.visible
    if not layout.visible then return end
    self.edge=layout.edge
    if self.manualCollapsed and not layout.collapsed then
        layout.height=48; layout.collapsed=true
    end
    self.card.Visible=not layout.collapsed
    self.handle.Visible=layout.collapsed
    local target=layout.collapsed and self.handle or self.card
    target.Position=UDim2.fromOffset(layout.x,layout.y)
    target.Size=UDim2.fromOffset(layout.width,layout.height)
    if not layout.collapsed then
        local changed=self.compact~=layout.compact
        self.compact=layout.compact
        self.heading.Visible=not self.compact
        self.minimize.Visible=not self.compact
        self.movementButton.Position=UDim2.new(0,8,0,self.compact and 0 or 28)
        for i,tab in ipairs(self.tabs) do tab.button.Position=UDim2.new((i-1)/3,5,0,self.compact and 36 or 62) end
        self.scroll.Position=UDim2.new(0,14,0,self.compact and 78 or 102)
        self.scroll.Size=UDim2.new(1,-28,0,layout.bodyHeight)
        self.ref.Position=UDim2.new(0,14,1,self.compact and -64 or -114)
        for _,button in ipairs(self.audioButtons) do button.Visible=not self.compact end
        if changed then self:refreshText() end
    end
end
function Presentation:buildBubble(page)
    if self.layoutConnection then self.layoutConnection:Disconnect() end
    if self.gui then self.gui:Destroy() end
    self.bubblePage=page
    self.gui=make("ScreenGui",{Name="PersonalVerseBubble",IgnoreGuiInset=true,ResetOnSpawn=false,
        DisplayOrder=3,ZIndexBehavior=Enum.ZIndexBehavior.Sibling},Players.LocalPlayer:WaitForChild("PlayerGui"))
    local frame=make("Frame",{Name="ReadingBubble",BackgroundColor3=paper,BorderSizePixel=0},self.gui)
    self.card=frame; round(frame)
    make("UIStroke",{Color=Theme.line,Thickness=1},frame)
    self.handle=make("TextButton",{Name="ReadingHandle",Text="",BackgroundColor3=paper,TextColor3=ink,
        Font=Enum.Font.Gotham,TextSize=13,BorderSizePixel=0,Visible=false,Selectable=true},self.gui)
    round(self.handle)
    self.handle.Activated:Connect(function()
        if self.movement=="contemplatio" then self:selectMovement("actio")
        else self.manualCollapsed=false; self:updateLayout() end
    end)
    local function label(y,h,size)
        return make("TextLabel",{Position=UDim2.new(0,14,0,y),Size=UDim2.new(1,-28,0,h),
            BackgroundTransparency=1,TextColor3=ink,Font=Enum.Font.Gotham,TextSize=size,
            TextWrapped=true,Text=""},frame)
    end
    self.heading=label(6,20,13)
    self.heading.Size=UDim2.new(1,-60,0,20)
    self.heading.TextTruncate=Enum.TextTruncate.AtEnd
    self.heading.TextWrapped=false
    self.heading.TextXAlignment=Enum.TextXAlignment.Left
    local minimize=make("TextButton",{Text="−",Position=UDim2.new(1,-38,0,0),Size=UDim2.fromOffset(36,28),
        BackgroundTransparency=1,TextColor3=ink,TextSize=20,Selectable=true},frame)
    minimize.Activated:Connect(function() self.manualCollapsed=true; self:updateLayout() end)
    self.minimize=minimize
    self.movementButton=make("TextButton",{Position=UDim2.new(0,8,0,28),Size=UDim2.new(1,-16,0,32),
        BackgroundTransparency=1,TextColor3=Theme.gold,Font=Enum.Font.Gotham,TextSize=13,Text="",Selectable=true},frame)
    self.movementButton.Activated:Connect(function() self:selectMovement(Practice.next(self.movement) or "silencio") end)
    self.tabs={}
    local zh=self.snapshot.lang=="zh"
    for i,v in ipairs({{"lectio","scripture",zh and "经文" or "Scripture"},{"meditatio","reflection",zh and "默想" or "Reflection"},{"actio","summary",zh and "小结" or "Summary"}}) do
        local tab=make("TextButton",{Text=v[3],Position=UDim2.new((i-1)/3,5,0,62),Size=UDim2.new(1/3,-10,0,36),
            BackgroundColor3=Theme.panel2,TextColor3=ink,Font=Enum.Font.Gotham,TextSize=13,BorderSizePixel=0,Selectable=true},frame)
        round(tab); table.insert(self.tabs,{button=tab,view=v[2]})
        tab.Activated:Connect(function()
            if self.compact and v[1]=="lectio" and self:allowsNarration() then
                if self.audioStatus=="playing" or self.audioStatus=="loading" then self.onAction({type="pause"})
                elseif self.audioStatus=="paused" then self.onAction({type="resume"})
                else self:selectMovement("lectio") end
            else self:selectMovement(v[1]) end
        end)
    end
    local scroll=make("ScrollingFrame",{Position=UDim2.new(0,14,0,102),Size=UDim2.new(1,-28,0,150),
        BackgroundTransparency=1,BorderSizePixel=0,ScrollBarThickness=4,ScrollBarImageColor3=Theme.gold,
        CanvasSize=UDim2.new(),AutomaticCanvasSize=Enum.AutomaticSize.Y},frame)
    self.scroll=scroll
    self.body=make("TextLabel",{Size=UDim2.new(1,-8,0,0),AutomaticSize=Enum.AutomaticSize.Y,
        BackgroundTransparency=1,TextColor3=ink,Font=Enum.Font.Garamond,TextSize=22,
        TextWrapped=true,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top,Text=""},scroll)
    self.ref=label(0,20,12); self.ref.Position=UDim2.new(0,14,1,-114)
    local function button(text,index,row,callback)
        local b=make("TextButton",{Text=text,Position=UDim2.new((index-1)/3,5,1,-88+row*44),
            Size=UDim2.new(1/3,-10,0,40),BackgroundColor3=Theme.panel2,
            TextColor3=ink,TextSize=13,Font=Enum.Font.Gotham,Selectable=true,BorderSizePixel=0},frame)
        round(b); b.Activated:Connect(callback); return b
    end
    self.audioButtons={}
    table.insert(self.audioButtons,button(zh and "重播" or "Replay",1,0,function() self:selectMovement("lectio") end))
    self.audio=button(zh and "朗读" or "Listen",2,0,function()
        if self.audioStatus=="playing" or self.audioStatus=="loading" then self.onAction({type="pause"})
        elseif self.audioStatus=="paused" and self:allowsNarration() then self.onAction({type="resume"})
        else self:selectMovement("lectio") end
    end)
    self.moreButton=button(zh and "下一段" or "More text",3,0,function()
        if not self:allowsNarration() or #self.chunks<=1 then return end
        self.onAction({type="segment"})
        self.segment=self.segment%#self.chunks+1; self:refreshText(); self.scroll.CanvasPosition=Vector2.new(0,0)
    end)
    table.insert(self.audioButtons,self.audio); table.insert(self.audioButtons,self.moreButton)
    button(zh and "上一页" or "Previous",1,1,function() self.onAction({type="previous"}) end)
    button(zh and "下一页" or "Next page",2,1,function() self.onAction({type="next"}) end)
    local finish=button(zh and "阿们 · 结束" or "Amen · Finish",3,1,function() self.onAction({type="finish"}) end)
    finish.BackgroundColor3=Theme.accent; finish.TextColor3=Theme.cream
    self:refreshText(); self:setAudioState(self.audioStatus or "paused"); self:updateLayout()
    self.layoutConnection=RunService.RenderStepped:Connect(function() self:updateLayout() end)
end
function Presentation:setAudioState(state)
    if type(state)=="table" then
        self.segment=state.segment or self.segment
        if self:allowsNarration() then self:refreshText() end
        state=state.status
    end
    self.audioStatus=state
    if self.audio then
        local zh=self.snapshot and self.snapshot.lang=="zh"
        local names=zh and {idle="朗读",unavailable="语音不可用",loading="准备中…",playing="暂停",paused="继续朗读",ended="重听",muted="已静音"} or
            {idle="Listen",unavailable="No audio",loading="Loading…",playing="Pause",paused="Listen",ended="Listen again",muted="Muted"}
        self.audio.Text=names[state] or ""
    end
end
function Presentation:render(s,settings)
    self.snapshot=s
    if s.phase=="idle" then self.activeReading=nil end
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
        if self.gui then self.gui.Enabled=false end
        if self.layoutConnection then self.layoutConnection:Disconnect(); self.layoutConnection=nil end
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
    if self.activeReading~=s.reading then
        self.activeReading=s.reading; self.displayedPage=s.page
        self.movement=s.reading.mode=="today" and "silencio" or "lectio"
        self.manualCollapsed=false
    elseif self.displayedPage~=s.page then
        self.displayedPage=s.page; self.movement="lectio"; self.manualCollapsed=false
    end
    self.key=key; self.segment=1
    if self.layoutConnection then self.layoutConnection:Disconnect(); self.layoutConnection=nil end
    if self.gui then self.gui:Destroy(); self.gui=nil end
    self.body=nil; self.audio=nil
    local destination=self.anchors.destination.CFrame
    for i=1,s.page do
        if not self.pages[i] then
            self.pages[i]=self:createPage(i,self.anchors.altar.CFrame*CFrame.Angles(math.pi/2,0,0))
            for _,face in ipairs({Enum.NormalId.Front,Enum.NormalId.Back}) do
                local surface=make("SurfaceGui",{Name="PageLettering",Face=face,CanvasSize=Vector2.new(360,480),
                    LightInfluence=0,AlwaysOnTop=false},self.pages[i])
                make("TextLabel",{Name="Scripture",Position=UDim2.fromScale(0.1,0.1),Size=UDim2.fromScale(0.8,0.8),
                    BackgroundTransparency=1,TextColor3=ink,Font=Enum.Font.Garamond,TextScaled=true,TextWrapped=true,Text=""},surface)
            end
        end
        local verse=s.reading.verses[i]
        for _,child in ipairs(self.pages[i]:GetChildren()) do
            if child:IsA("SurfaceGui") then
                child.Scripture.Text=((s.lang=="zh" and verse.refZh or verse.refEn) or "").."\n\n"..
                    ((s.lang=="zh" and verse.textZh or verse.textEn) or "")
            end
        end
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
        else self:tween(page,duration,{CFrame=target,Transparency=i==s.page and 0 or (i<s.page and i>=s.page-3 and 0.18 or 1)}) end
        for _,child in ipairs(page:GetChildren()) do if child:IsA("SurfaceGui") then child.Enabled=i==s.page end end
        if i<s.page and i>=s.page-3 then
            local bookmark=make("BillboardGui",{Name="PageBookmark",Adornee=page,Size=UDim2.fromOffset(36,36),AlwaysOnTop=false,MaxDistance=14,Active=true,ResetOnSpawn=false},Players.LocalPlayer.PlayerGui)
            table.insert(self.bookmarks,bookmark)
            local b=make("TextButton",{Size=UDim2.fromScale(1,1),Text=tostring(i),BackgroundColor3=paper,TextColor3=ink,TextSize=16},bookmark)
            b.Activated:Connect(function() self.onAction({type="select",page=i}) end)
        end
    end
    -- Opening and page flight occupy the stage alone. Stale timers cannot restore dismissed text.
    local generation=self.generation
    task.delay(duration,function()
        if self.generation==generation and self.key==key and self.folder and self.snapshot.phase~="closing" then
            self:buildBubble(self.pages[s.page])
        end
    end)
end
function Presentation:destroy() self:clear() end
return Presentation
