-- Client-only exact-text TTS. No public audio emitter or website media URL.
local Segments=require(script.Parent.TextSegments)
local Driver={}
function Driver.start(text,lang,onState)
    local folder=Instance.new("Folder")
    folder.Name="LectioPrivateSpeech"
    folder.Parent=game:GetService("SoundService")
    local alive,paused,ready=true,false,false
    local speech,output,wire,ended
    local chunks=Segments.split(text,180)
    local index=1
    local function dispose()
        if not alive then return end
        alive=false
        if ended then ended:Disconnect() end
        folder:Destroy()
    end
    local function failed()
        if alive then onState("unavailable"); dispose() end
    end
    local ok=pcall(function()
        speech=Instance.new("AudioTextToSpeech")
        speech.VoiceId="2"
        speech.Volume=0.8
        speech.Parent=folder
        output=Instance.new("AudioDeviceOutput")
        output.Player=game:GetService("Players").LocalPlayer
        output.Parent=folder
        wire=Instance.new("Wire")
        wire.SourceInstance=speech; wire.TargetInstance=output; wire.Parent=folder
    end)
    if not ok then failed(); return {pause=function() end,resume=function() end,stop=dispose} end
    local generation=0
    local function loadChunk()
        generation=generation+1
        local token=generation
        ready=false
        task.spawn(function()
            local success=pcall(function()
                speech.Text=chunks[index]
                speech.TimePosition=0
                local status=speech:LoadAsync()
                if not alive or generation ~= token then return end
                if status ~= Enum.AssetFetchStatus.Success then error("speech unavailable") end
                ready=true
                if not paused then speech:Play(); onState({status="playing",segment=index}) end
            end)
            if not success then failed() end
        end)
        task.delay(20,function()
            if alive and generation == token and not ready then failed() end
        end)
    end
    ended=speech.Ended:Connect(function()
        if not alive then return end
        index=index+1
        if index > #chunks then onState("ended"); dispose() else loadChunk() end
    end)
    loadChunk()
    return {
        stop=dispose,
        pause=function() paused=true; if alive and ready then pcall(function() speech:Pause() end) end end,
        resume=function()
            paused=false
            if alive and ready then
                local success=pcall(function() speech:Play() end)
                if success then onState({status="playing",segment=index}) else failed() end
            end
        end,
    }
end
return Driver
