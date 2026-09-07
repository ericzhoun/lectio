local Players=game:GetService("Players")
local RunService=game:GetService("RunService")
local TweenService=game:GetService("TweenService")
local Interaction={}
Interaction.__index=Interaction

-- A local visual gesture for the owner and each observer. Never moves the avatar root.
function Interaction.gesture(character,target,onContact)
    if not character then return function() end end
    local humanoid=character:FindFirstChildOfClass("Humanoid")
    if not humanoid then return function() end end
    local alive=true
    local glow=Instance.new("PointLight")
    glow.Color=Color3.fromRGB(255,222,160); glow.Range=7; glow.Brightness=0.6; glow.Parent=target
    local ik,shoulder,original
    local hand=character:FindFirstChild("RightHand")
    if hand and character:FindFirstChild("RightUpperArm") then
        ik=Instance.new("IKControl")
        ik.Type=Enum.IKControlType.Position
        ik.ChainRoot=character.RightUpperArm; ik.EndEffector=hand
        ik.Target=target; ik.SmoothTime=0.18; ik.Weight=1; ik.Parent=humanoid
    else
        local torso=character:FindFirstChild("Torso")
        shoulder=torso and torso:FindFirstChild("Right Shoulder")
        if shoulder then
            original=shoulder.C0
            shoulder.C0=original*CFrame.Angles(0,0,math.rad(-70))
        end
    end
    local function cleanup()
        if not alive then return end
        alive=false
        glow:Destroy()
        if ik then ik:Destroy() end
        if shoulder and shoulder.Parent then shoulder.C0=original end
    end
    task.delay(0.45,function() if alive and character.Parent and onContact then onContact() end end)
    task.delay(1.0,cleanup)
    return cleanup
end

function Interaction.new(anchors,onAction)
    local self=setmetatable({anchors=anchors,onAction=onAction,connections={},prompts={},detectors={},near=false},Interaction)
    local function prompt(part,action,key,callback)
        local p=Instance.new("ProximityPrompt")
        p.ActionText=action; p.ObjectText="Lectio"; p.HoldDuration=0.2
        p.MaxActivationDistance=7; p.RequiresLineOfSight=true
        p.KeyboardKeyCode=key
        p.Exclusivity=Enum.ProximityPromptExclusivity.OnePerButton
        p.Parent=part
        table.insert(self.prompts,p)
        table.insert(self.connections,p.Triggered:Connect(callback))
        return p
    end
    self.main=prompt(anchors.contact,"Touch Bible",Enum.KeyCode.E,function() onAction({type="activate"}) end)
    self.main.MaxActivationDistance=3.5
    self.main.RequiresLineOfSight=false
    self.options=prompt(anchors.contact,"Reading options",Enum.KeyCode.Q,function() onAction({type="options"}) end)
    self.options.GamepadKeyCode=Enum.KeyCode.ButtonY
    self.options.RequiresLineOfSight=false
    for _,name in ipairs({"CoverLeft","CoverRight"}) do
        local detector=Instance.new("ClickDetector")
        detector.MaxActivationDistance=6
        detector.Parent=anchors.visual:WaitForChild(name)
        table.insert(self.detectors,detector)
        table.insert(self.connections,detector.MouseClick:Connect(function(who)
            if who==Players.LocalPlayer then onAction({type="activate"}) end
        end))
    end
    local modes={{"RibbonDaily","Daily Word","daily",Enum.KeyCode.One},
        {"RibbonDivina","Lectio Divina","divina",Enum.KeyCode.Two},
        {"RibbonDeep","Deep Lectio","deep",Enum.KeyCode.Three}}
    for index,v in ipairs(modes) do
        local p=prompt(anchors.visual:WaitForChild(v[1]),v[2],v[4],function() onAction({type="mode",mode=v[3]}) end)
        p.GamepadKeyCode=({Enum.KeyCode.DPadLeft,Enum.KeyCode.DPadUp,Enum.KeyCode.DPadRight})[index]
    end
    table.insert(self.connections,RunService.Heartbeat:Connect(function()
        local char=Players.LocalPlayer.Character
        local root=char and char:FindFirstChild("HumanoidRootPart")
        local near=root ~= nil and (root.Position-anchors.altar.Position).Magnitude <= 9
        if near ~= self.near then
            self.near=near
            if not near and self.cancel then self.cancel(); self.cancel=nil end
            onAction({type="near",value=near})
        end
    end))
    return self
end
function Interaction:setEnabled(enabled)
    self.main.Enabled=enabled
    for _,detector in ipairs(self.detectors) do detector.MaxActivationDistance=enabled and 6 or 0 end
end
function Interaction:isWithinReach()
    local character=Players.LocalPlayer.Character
    local root=character and character:FindFirstChild("HumanoidRootPart")
    return root~=nil and (root.Position-self.anchors.contact.Position).Magnitude<=3.5
end
function Interaction:setLanguage(lang,mode,resume)
    self.options.ActionText=lang=="zh" and "阅读选项" or "Reading options"
    self.main.ActionText=resume and (lang=="zh" and "继续阅读" or "Resume reading") or (lang=="zh" and "触摸圣经" or "Touch Bible")
    self.main.ObjectText=({daily=lang=="zh" and "每日圣言" or "Daily Word",divina="Lectio Divina",deep="Deep Lectio",today=lang=="zh" and "今日经课" or "Today's reading"})[mode]
end
function Interaction:reach(onContact)
    if self.cancel then self.cancel() end
    self.cancel=Interaction.gesture(Players.LocalPlayer.Character,self.anchors.contact,onContact)
end
function Interaction:destroy()
    if self.cancel then self.cancel() end
    for _,c in ipairs(self.connections) do c:Disconnect() end
    for _,p in ipairs(self.prompts) do p:Destroy() end
    for _,d in ipairs(self.detectors) do d:Destroy() end
end
return Interaction
