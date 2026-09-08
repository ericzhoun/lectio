-- Exercise real presentation behavior. These doubles do not model Roblox rendering,
-- physics, font metrics, or perspective; those still require Studio playtesting.
local function signal()
    local event={listeners={}}
    function event:Connect(callback)
        local listener={callback=callback,connected=true}
        table.insert(self.listeners,listener)
        return {Disconnect=function() listener.connected=false end}
    end
    function event:Fire(...)
        for _,listener in ipairs(self.listeners) do
            if listener.connected then listener.callback(...) end
        end
    end
    return event
end

local vector={}
vector.__index=vector
function vector.__add(a,b) return Vector3.new(a.X+b.X,a.Y+b.Y,a.Z+b.Z) end
function vector.__sub(a,b) return Vector3.new(a.X-b.X,a.Y-b.Y,a.Z-b.Z) end
function vector.__mul(a,b)
    if type(a)=="number" then a,b=b,a end
    return Vector3.new(a.X*b,a.Y*b,a.Z*b)
end
Vector3={new=function(x,y,z) return setmetatable({X=x or 0,Y=y or 0,Z=z or 0},vector) end}
Vector2={new=function(x,y) return {X=x or 0,Y=y or 0} end}
local frame={}
frame.__index=frame
function frame.__mul(a,b)
    if getmetatable(b)==vector then return a.Position+b end
    return CFrame.new(a.Position+b.Position)
end
function frame.__add(a,b) return CFrame.new(a.Position+b) end
function frame:Lerp(other,alpha) return CFrame.new(self.Position+(other.Position-self.Position)*alpha) end
CFrame={new=function(x,y,z)
    return setmetatable({Position=type(x)=="table" and x or Vector3.new(x,y,z)},frame)
end,Angles=function() return setmetatable({Position=Vector3.new()},frame) end}
CFrame.lookAt=function(position) return CFrame.new(position) end
UDim={new=function(scale,offset) return {Scale=scale or 0,Offset=offset or 0} end}
UDim2={new=function(xs,xo,ys,yo) return {X=UDim.new(xs,xo),Y=UDim.new(ys,yo)} end}
UDim2.fromOffset=function(x,y) return UDim2.new(0,x,0,y) end
UDim2.fromScale=function(x,y) return UDim2.new(x,0,y,0) end
Color3={fromRGB=function(r,g,b) return {R=r/255,G=g/255,B=b/255} end}
Enum=setmetatable({},{__index=function(t,category)
    local values=setmetatable({},{__index=function(v,key) local value=category.."."..key; rawset(v,key,value); return value end})
    rawset(t,category,values); return values
end})
TweenInfo={new=function(seconds) return {Time=seconds} end}

local methods={}
local objectMeta={}
local allObjects={}
function objectMeta.__index(o,key)
    if methods[key] then return methods[key] end
    local value=o._properties[key]
    if value~=nil then return value end
    for _,child in ipairs(o._children) do if child.Name==key then return child end end
end
function objectMeta.__newindex(o,key,value)
    if key=="Parent" then
        local old=o._properties.Parent
        if old then
            for i,child in ipairs(old._children) do if child==o then table.remove(old._children,i); break end end
        end
        if value then table.insert(value._children,o) end
    end
    o._properties[key]=value
end
Instance={new=function(class)
    local o=setmetatable({_properties={ClassName=class,Name=class,Visible=true,Enabled=true,
        LocalTransparencyModifier=0,CFrame=CFrame.new(),Size=Vector3.new(1,1,1),Activated=signal()},_children={}},objectMeta)
    table.insert(allObjects,o)
    return o
end}
function methods:IsA(class)
    return self.ClassName==class or (class=="BasePart" and self.ClassName=="Part")
end
function methods:GetChildren()
    local result={}; for _,child in ipairs(self._children) do table.insert(result,child) end; return result
end
function methods:GetDescendants()
    local result={}
    for _,child in ipairs(self._children) do
        table.insert(result,child)
        for _,descendant in ipairs(child:GetDescendants()) do table.insert(result,descendant) end
    end
    return result
end
function methods:WaitForChild(name) return assert(self[name],"missing child "..name) end
function methods:Destroy()
    for _,child in ipairs(self:GetChildren()) do child:Destroy() end
    self.Parent=nil; self.Destroyed=true
end
function methods:Clone()
    local copy=Instance.new(self.ClassName)
    for key,value in pairs(self._properties) do
        if key~="Parent" and key~="Activated" then copy[key]=value end
    end
    for _,child in ipairs(self._children) do child:Clone().Parent=copy end
    return copy
end
function methods:GetBoundingBox() return CFrame.new(640,360,10),Vector3.new(200,300,2) end
function countBubbles()
    local count=0
    for _,o in ipairs(allObjects) do
        if o.ClassName=="ScreenGui" and o.Name=="PersonalVerseBubble" and not o.Destroyed then count=count+1 end
    end
    return count
end

local now,timers=0,{}
task={delay=function(seconds,callback) table.insert(timers,{at=now+seconds,callback=callback}) end}
function advance(seconds)
    local target=now+seconds
    while true do
        local index,at=nil,math.huge
        for i,timer in ipairs(timers) do if timer.at<=target and timer.at<at then index,at=i,timer.at end end
        if not index then break end
        local timer=table.remove(timers,index); now=timer.at; timer.callback()
    end
    now=target
end
local renderSignal=signal()
function renderFrame() renderSignal:Fire() end
local tweenService={Create=function(_,object,info,properties)
    return {Play=function() for key,value in pairs(properties) do object[key]=value end end,Cancel=function() end}
end}
workspace=Instance.new("Workspace")
workspace.CurrentCamera={ViewportSize=Vector2.new(1280,720),CameraType=Enum.CameraType.Custom,CFrame=CFrame.new(),
    WorldToViewportPoint=function(_,position) return position end}
local player=Instance.new("Player")
local playerGui=Instance.new("PlayerGui"); playerGui.Name="PlayerGui"; playerGui.Parent=player
game={GetService=function(_,name)
    if name=="TweenService" then return tweenService end
    if name=="Players" then return {LocalPlayer=player} end
    if name=="RunService" then return {RenderStepped=renderSignal} end
    error("unexpected service "..name)
end}
script={Parent={}}
require=function(module) return assert(module,"missing module") end

function newAnchors()
    local visual=Instance.new("Model"); visual.Name="BibleVisual"; visual.Parent=workspace
    for _,name in ipairs({"CoverLeft","CoverRight","PageBlock"}) do
        local part=Instance.new("Part"); part.Name=name; part.Parent=visual
    end
    local coverTitle=Instance.new("SurfaceGui"); coverTitle.Name="CoverTitle"; coverTitle.Parent=visual.CoverRight
    local altar=Instance.new("Part"); altar.CFrame=CFrame.new(0,5,-49); altar.Parent=workspace
    local contact=Instance.new("Part"); contact.Position=Vector3.new(0,5,-48); contact.Parent=workspace
    local destination=Instance.new("Part"); destination.CFrame=CFrame.new(0,7,-46); destination.Parent=workspace
    return {visual=visual,altar=altar,contact=contact,destination=destination}
end
function exampleReading(mode)
    return {mode=mode or "daily",title="A quiet reading",summary="Carry this supplied summary into today.",
        verses={{refEn="Psalm 46:10",textEn="Be still, and know that I am God.",refZh="诗篇 46:10",textZh="你们要休息，要知道我是神。",interp="Receive the supplied reflection."},
                {refEn="John 14:27",textEn="Peace I leave with you.",refZh="约翰福音 14:27",textZh="我留下平安给你们。",interp="Receive peace."}}}
end
function newPresentation()
    actions={}
    local presentation=Presentation.new(newAnchors(),function(event) table.insert(actions,event.type) end)
    presentation.protectedRects=function() return {{x=420,y=150,width=410,height=470}} end
    return presentation
end
function showReading(presentation,reading,page,lang,phase,reducedMotion)
    presentation:render({reading=reading,page=page or 1,lang=lang or "en",phase=phase or "revealing"},
        {reducedMotion=reducedMotion==true})
end
