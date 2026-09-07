local Requests = {}
Requests.__index=Requests
function Requests.new() return setmetatable({players={}},Requests) end
function Requests:begin(player,id,signature)
    signature=signature or ""
    local p=self.players[player]
    if not p then p={cache={},order={},seen={},count=0}; self.players[player]=p end
    if p.seen[id] and p.seen[id]~=signature then return "conflict" end
    if p.cache[id] then return "cached",p.cache[id] end
    if p.uncertain then return "blocked" end
    if p.active then return p.active == id and "pending" or "blocked" end
    if p.seen[id] then return "expired" end
    if p.count>=256 then return "expired" end
    p.seen[id]=signature; p.count=p.count+1
    p.active=id
    return "start"
end
function Requests:complete(player,id,result)
    local p=self.players[player]
    if not p or p.active ~= id then return end
    p.active=nil; p.cache[id]=result
    table.insert(p.order,id)
    if #p.order > 16 then p.cache[table.remove(p.order,1)]=nil end
end
function Requests:uncertain(player,id)
    local p=self.players[player]
    if p and p.active == id then p.uncertain=true end
end
function Requests:remove(player) self.players[player]=nil end
function Requests.executeDraw(mode,backend,offline)
    if mode == "offline" then
        local ok,response=pcall(offline)
        return ok and {kind="complete",response=response} or {kind="uncertain"}
    end
    local ok,result=pcall(backend)
    if not ok or not result then return {kind="uncertain"} end
    return result
end
return Requests
