-- Engine doubles only for executing real server routing, not rendering/physics claims.
local function signal()
    return {Connect=function(self,fn) self.callback=fn; return {Disconnect=function() end} end}
end
local objects={}
local function object(class)
    local o={ClassName=class,OnServerEvent=signal(),OnClientEvent=signal(),Triggered=signal()}
    function o:FindFirstChild(name) return self[name] end
    function o:WaitForChild(name) return assert(self[name],name) end
    function o:SetAttribute(k,v) self[k]=v end
    function o:FireClient(player,response) player.last=response end
    function o:FireAllClients(...) publicCalls=publicCalls+1 end
    table.insert(objects,o)
    return o
end
Instance={new=object}
local dummy=setmetatable({},{__index=function(_,k) return k end})
Enum=setmetatable({},{__index=function() return dummy end})
UDim2={fromScale=function() return {} end}
Color3={fromRGB=function() return {} end}
Random={new=function() return {NextInteger=function(_,min) return min end} end}
warn=function() end
local position=setmetatable({},{__sub=function() return {Magnitude=distance or 0} end})
workspace=object("Workspace")
for _,name in ipairs({"VerseBoard","AltarBible","RegisterDesk","AssistantNPC","LibraryWall"}) do
    workspace[name]=object("Part"); workspace[name].Position=position
end
local replicated=object("ReplicatedStorage")
replicated.VerseData=VerseData
local server=object("ServerScriptService")
server.DrawRequests=DrawRequests
script={Parent=server,GetAttribute=function(_,key)
    if key=="LectioApiKey" and liveMode then return "test-key" end
end}
require=function(value) return value end
publicCalls=0; httpCalls=0; dataWrites=0
local http={HttpEnabled=true}
function http:JSONEncode(value) return table.concat(value,"|") end
-- Backend payloads are dictionaries: only request fingerprints need string output.
function http:JSONEncode(value)
    if value[1] then return table.concat(value,"|") end
    return "request"
end
function http:JSONDecode() return backendResponse end
function http:RequestAsync()
    httpCalls=httpCalls+1
    if failHttp then error("transport timeout") end
    return {Success=true,StatusCode=200,Body="response"}
end
local stored={}
local store={GetAsync=function(_,key) return stored[key] end,
    SetAsync=function(_,key,value) stored[key]=value; dataWrites=dataWrites+1 end}
local players={PlayerRemoving=signal()}
local services={ReplicatedStorage=replicated,HttpService=http,
    DataStoreService={GetDataStore=function() return store end},Players=players}
game={GetService=function(_,name) return assert(services[name],name) end}
function getRemote(name)
    for _,o in ipairs(objects) do if o.ClassName=="RemoteEvent" and o.Name==name then return o end end
    error("missing remote "..name)
end
function newPlayer(id)
    local char=object("Model")
    char.HumanoidRootPart={Position=position}
    return {UserId=id,DisplayName="PrivateReader",Character=char,Parent=players}
end
function assertPrivateBoard()
    for _,o in ipairs(objects) do
        assert(not (type(o.Text)=="string" and o.Text:find("PRIVATE_VERSE",1,true)))
        assert(not (type(o.Text)=="string" and o.Text:find("PrivateReader",1,true)))
    end
    assert(publicCalls==0)
end
