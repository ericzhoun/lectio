-- LectioServer: bridges the world to the Lectio backend (enjoyhim.org).
-- Live mode: every feature is served by the site's API — the real 148-verse
-- deck, D1-enforced quotas and welcome credits, AI reflections, the AI
-- assistant and the church-calendar lectionary. If HTTP is disabled or the
-- backend is unreachable, the world falls back to the built-in VerseData
-- logic below so a reading never dead-ends.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local VerseData = require(ReplicatedStorage:WaitForChild("VerseData"))
local DrawRequests = require(script.Parent:WaitForChild("DrawRequests"))
local drawRequests = DrawRequests.new()

-- Configuration. Script attributes override the constants, so the key can be
-- set from Studio's properties pane (LectioBackendUrl / LectioApiKey on this
-- Script) without editing code. In production set LectioApiKey via the
-- Creator Dashboard or publish the place with the attribute filled in.
local DEFAULT_BACKEND_URL = "https://enjoyhim.org"
local DEFAULT_API_KEY = ""
local BACKEND_URL = script:GetAttribute("LectioBackendUrl") or DEFAULT_BACKEND_URL
local API_KEY = script:GetAttribute("LectioApiKey") or DEFAULT_API_KEY

local remoteNames = { "LectioExplore", "LectioRegister", "LectioAssistant", "LectioState", "LectioToday", "LectioLibrary", "LectioActivity" }
local remotes = {}
for _, name in ipairs(remoteNames) do
	local r = Instance.new("RemoteEvent")
	r.Name = name
	r.Parent = ReplicatedStorage
	remotes[name] = r
end

-- ---- Live backend client ----------------------------------------------------

local LIVE = false
if API_KEY == "" then
	warn("Lectio: no API key configured (script attribute LectioApiKey) - running in offline fallback mode.")
elseif not HttpService.HttpEnabled then
	warn("Lectio: HTTP requests are disabled - enable Game Settings > Security > Allow HTTP Requests. Using offline fallback mode.")
else
	LIVE = true
	print("Lectio: live backend mode -> " .. BACKEND_URL)
end

local warnedPaths = {}
--- POST `payload` to the backend; returns the decoded table, or nil on any
--- failure (the caller then falls back to local logic). A 401/503 means the
--- integration itself is misconfigured, so live mode is switched off.
local function callBackend(path, payload)
	if not LIVE then return nil end
	local ok, resp = pcall(function()
		return HttpService:RequestAsync({
			Url = BACKEND_URL .. path,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-Lectio-Key"] = API_KEY,
			},
			Body = HttpService:JSONEncode(payload),
		})
	end)
	if not ok then
		if not warnedPaths[path] then
			warnedPaths[path] = true
			warn("Lectio: backend call to " .. path .. " failed: " .. tostring(resp))
		end
		return nil
	end
	if resp.StatusCode == 401 or resp.StatusCode == 503 then
		LIVE = false
		warn("Lectio: backend rejected the request (HTTP " .. tostring(resp.StatusCode) .. "). Check LectioApiKey / server config. Switching to offline fallback mode.")
		return nil
	end
	if not resp.Success then
		if not warnedPaths[path] then
			warnedPaths[path] = true
			warn("Lectio: backend returned HTTP " .. tostring(resp.StatusCode) .. " for " .. path)
		end
		return nil
	end
	local decoded
	local okDecode = pcall(function()
		decoded = HttpService:JSONDecode(resp.Body)
	end)
	if not okDecode then return nil end
	return decoded
end

-- ---- Offline fallback state (DataStore, session-memory if unavailable) ------

local store = nil
pcall(function()
	store = DataStoreService:GetDataStore("LectioData_v1")
end)
if not store then
	warn("Lectio: DataStore unavailable (enable Studio API access for persistence). Using session memory.")
end
local memory = {}

local rng = Random.new()

local function todayKey()
	return os.date("!%Y-%m-%d")
end

local function freshData()
	return { date = todayKey(), daily = 0, registered = false, divina = 3, deep = 1, assist = 0 }
end

local function getData(userId)
	local key = "u_" .. tostring(userId)
	local data = nil
	if store then
		local ok, result = pcall(function()
			return store:GetAsync(key)
		end)
		if ok then data = result end
	end
	if not data then data = memory[key] end
	if type(data) ~= "table" or data.date ~= todayKey() then
		data = freshData()
	end
	if data.registered then
		data.divina = 3
		data.deep = 1
	end
	return data, key
end

local function saveData(key, data)
	memory[key] = data
	if store then
		pcall(function()
			store:SetAsync(key, data)
		end)
	end
end

local function categoryFor(topic)
	local lowered = string.lower(topic)
	for _, cat in pairs(VerseData.Categories) do
		for _, kw in ipairs(cat.keywords) do
			if string.find(lowered, string.lower(kw), 1, true) then
				return cat.verses
			end
		end
	end
	return VerseData.AllVerseIds
end

local function pickIds(count, pool)
	local ids = {}
	local used = {}
	local bag = {}
	local function refill()
		bag = {}
		for _, id in ipairs(pool) do
			if not used[id] then table.insert(bag, id) end
		end
		if #bag == 0 then
			for _, id in ipairs(VerseData.AllVerseIds) do
				if not used[id] then table.insert(bag, id) end
			end
		end
	end
	refill()
	while #ids < count do
		if #bag == 0 then refill() end
		if #bag == 0 then break end
		local i = rng:NextInteger(1, #bag)
		local id = bag[i]
		table.remove(bag, i)
		used[id] = true
		table.insert(ids, id)
	end
	return ids
end

-- Same shape the backend sends, so the client treats both identically.
local function versesFor(ids)
	local out = {}
	for _, id in ipairs(ids) do
		local v = VerseData.Verses[id]
		if v then
			table.insert(out, {
				refEn = v.refEn, refZh = v.refZh,
				textEn = v.en, textZh = v.zh,
				themeEn = "", themeZh = "",
				positionEn = "", positionZh = "",
				interp = "", tags = {},
			})
		end
	end
	return out
end

local function stateFor(data)
	return {
		ok = true,
		used = data.daily,
		limit = data.registered and 6 or 3,
		registered = data.registered,
		divina = data.registered and data.divina or 0,
		deep = data.registered and data.deep or 0,
	}
end

-- Offline Explore: same rules as the world's original logic.
local function localExplore(player, topic, mode, lang)
	local data, key = getData(player.UserId)
	if mode == "daily" then
		local limit = data.registered and 6 or 3
		if data.daily >= limit then
			return { ok = false, errorKey = "limitMsg" }
		end
		data.daily = data.daily + 1
	elseif mode == "divina" then
		if not data.registered or data.divina <= 0 then
			return { ok = false, errorKey = "divinaMsg" }
		end
		data.divina = data.divina - 1
	elseif mode == "deep" then
		if not data.registered or data.deep <= 0 then
			return { ok = false, errorKey = "deepMsg" }
		end
		data.deep = data.deep - 1
	end
	saveData(key, data)

	local count = 1
	if mode == "divina" then count = 3 end
	if mode == "deep" then count = 10 end
	local verses = versesFor(pickIds(count, categoryFor(topic)))
	return {
		ok = true,
		mode = mode,
		topic = topic,
		verses = verses,
		summary = "",
		state = stateFor(data),
	}
end

-- ---- 3D scripture board above the altar --------------------------------------

local board = workspace:WaitForChild("VerseBoard")
local boardGui = Instance.new("SurfaceGui")
boardGui.Name = "BoardGui"
boardGui.Face = Enum.NormalId.Front
boardGui.ResetOnSpawn = false
boardGui.Parent = board

local boardBg = Instance.new("Frame")
boardBg.Size = UDim2.fromScale(1, 1)
boardBg.BackgroundColor3 = Color3.fromRGB(30, 25, 21)
boardBg.BorderSizePixel = 0
boardBg.Parent = boardGui

local boardTitle = Instance.new("TextLabel")
boardTitle.BackgroundTransparency = 1
boardTitle.Position = UDim2.fromScale(0.3, 0.03)
boardTitle.Size = UDim2.fromScale(0.4, 0.11)
boardTitle.Font = Enum.Font.Garamond
boardTitle.Text = "L e c t i o"
boardTitle.TextColor3 = Color3.fromRGB(212, 178, 112)
boardTitle.TextScaled = true
boardTitle.Parent = boardBg

local boardVerse = Instance.new("TextLabel")
boardVerse.BackgroundTransparency = 1
boardVerse.Position = UDim2.fromScale(0.06, 0.17)
boardVerse.Size = UDim2.fromScale(0.88, 0.56)
boardVerse.Font = Enum.Font.Garamond
boardVerse.TextColor3 = Color3.fromRGB(238, 231, 216)
boardVerse.TextScaled = true
boardVerse.TextWrapped = true
boardVerse.Text = "Be still, and know that I am God."
boardVerse.Parent = boardBg

local boardRef = Instance.new("TextLabel")
boardRef.BackgroundTransparency = 1
boardRef.Position = UDim2.fromScale(0.06, 0.76)
boardRef.Size = UDim2.fromScale(0.88, 0.12)
boardRef.Font = Enum.Font.Garamond
boardRef.TextColor3 = Color3.fromRGB(212, 178, 112)
boardRef.TextScaled = true
boardRef.Text = "Psalm 46:10"
boardRef.Parent = boardBg

local boardWho = Instance.new("TextLabel")
boardWho.BackgroundTransparency = 1
boardWho.Position = UDim2.fromScale(0.06, 0.89)
boardWho.Size = UDim2.fromScale(0.88, 0.09)
boardWho.Font = Enum.Font.Gotham
boardWho.TextColor3 = Color3.fromRGB(150, 142, 128)
boardWho.TextScaled = true
boardWho.Text = "a verse for everyone who seeks"
boardWho.Parent = boardBg

-- ---- Proximity prompts --------------------------------------------------------

local function addPrompt(part, actionText, objectText, key)
	local p = Instance.new("ProximityPrompt")
	p.ActionText = actionText
	p.ObjectText = objectText
	p.HoldDuration = 0.4
	p.MaxActivationDistance = 10
	p.RequiresLineOfSight = false
	p:SetAttribute("LectioKey", key)
	p.Parent = part
end

local altar = workspace:FindFirstChild("AltarBible")
-- Bible and ribbon prompts are private client objects; the server validates requests.
local desk = workspace:FindFirstChild("RegisterDesk")
if desk then addPrompt(desk, "Register free", "Lectio Registration", "register") end
local npc = workspace:FindFirstChild("AssistantNPC")
if npc then addPrompt(npc, "Ask a question", "Lectio Assistant", "assistant") end
local shelf = workspace:FindFirstChild("LibraryWall")
if shelf then addPrompt(shelf, "Browse verses", "Verse Library", "library") end

-- ---- Remote handlers (live first, local fallback) ------------------------------

local function sanitizeTopic(topic)
	if type(topic) ~= "string" then return "" end
	topic = string.sub(topic, 1, 300)
	return topic
end

local function sanitizeLang(lang)
	if type(lang) ~= "string" or (lang ~= "en" and lang ~= "zh") then return "en" end
	return lang
end

remotes.LectioState.OnServerEvent:Connect(function(player)
	local resp = callBackend("/api/roblox/state", {
		playerId = tostring(player.UserId),
		displayName = player.DisplayName,
	})
	if resp and resp.ok and type(resp.state) == "table" then
		remotes.LectioState:FireClient(player, resp.state)
		return
	end
	local data = getData(player.UserId)
	remotes.LectioState:FireClient(player, stateFor(data))
end)

local function beginDraw(player, id, remote, signature)
    if type(id) ~= "string" or #id < 8 or #id > 80 then return false end
    local root=player.Character and player.Character:FindFirstChild("HumanoidRootPart")
    if not root or not altar or (root.Position-altar.Position).Magnitude > 10 then
        remote:FireClient(player,{requestId=id,status="rejected",response={ok=false,errorKey="approachBible"}})
        return false
    end
    local status,cached=drawRequests:begin(player.UserId,id,signature)
    if status == "cached" then remote:FireClient(player,cached); return false end
    if status ~= "start" then
        if status == "blocked" then remote:FireClient(player,{requestId=id,status="uncertain",response={ok=false,errorKey="drawUncertain"}}) end
        if status == "expired" or status == "conflict" then remote:FireClient(player,{requestId=id,status="rejected",response={ok=false,errorKey="backendError"}}) end
        return false
    end
    return true
end
local function finishDraw(player,id,remote,result)
    local envelope={requestId=id,status=result.kind == "uncertain" and "uncertain" or
        (result.response and result.response.ok and "complete" or "rejected"),response=result.response}
    if result.kind == "uncertain" then
        drawRequests:uncertain(player.UserId,id)
    else drawRequests:complete(player.UserId,id,envelope) end
    if player.Parent then remote:FireClient(player,envelope) end
end

local lastActivity={}
remotes.LectioActivity.OnServerEvent:Connect(function(player)
    local root=player.Character and player.Character:FindFirstChild("HumanoidRootPart")
    local now=os.clock()
    if root and altar and (root.Position-altar.Position).Magnitude <= 10 and now-(lastActivity[player.UserId] or -10)>1.5 then
        lastActivity[player.UserId]=now
        remotes.LectioActivity:FireAllClients(player.UserId)
    end
end)
Players.PlayerRemoving:Connect(function(player)
    drawRequests:remove(player.UserId); lastActivity[player.UserId]=nil
end)
boardVerse.Text="A quiet place to read and reflect."
boardRef.Text="Walk to the Bible to begin."
boardWho.Text="Your reading is personal."

remotes.LectioExplore.OnServerEvent:Connect(function(player, topic, mode, lang, requestId)
	if mode ~= "daily" and mode ~= "divina" and mode ~= "deep" then return end
	topic = sanitizeTopic(topic)
	lang = sanitizeLang(lang)
    if not beginDraw(player,requestId,remotes.LectioExplore,HttpService:JSONEncode({topic,mode,lang})) then return end
	if topic == "" then
		local pick = VerseData.PopularTopics[rng:NextInteger(1, #VerseData.PopularTopics)]
		topic = pick.en
	end

    local liveAtStart=LIVE
    local result=DrawRequests.executeDraw(liveAtStart and "live" or "offline",function()
	local resp = callBackend("/api/roblox/explore", {
		playerId = tostring(player.UserId),
		displayName = player.DisplayName,
		topic = topic,
		mode = mode,
		lang = lang,
	})
    if resp and resp.ok == false then return {kind="rejected",response=resp} end
    if resp and resp.ok and type(resp.verses)=="table" and #resp.verses>0 then return {kind="complete",response=resp} end
    return {kind="uncertain"}
    end,function() return localExplore(player,topic,mode,lang) end)
    finishDraw(player,requestId,remotes.LectioExplore,result)
end)

remotes.LectioRegister.OnServerEvent:Connect(function(player)
	local resp = callBackend("/api/roblox/register", {
		playerId = tostring(player.UserId),
		displayName = player.DisplayName,
	})
	if resp and resp.ok and type(resp.state) == "table" then
		remotes.LectioRegister:FireClient(player, resp.state)
		return
	end
	local data, key = getData(player.UserId)
	if not data.registered then
		data.registered = true
		data.divina = 3
		data.deep = 1
		saveData(key, data)
	end
	remotes.LectioRegister:FireClient(player, stateFor(data))
end)

remotes.LectioToday.OnServerEvent:Connect(function(player, lang, requestId)
	lang = sanitizeLang(lang)
    if not beginDraw(player,requestId,remotes.LectioToday,"today:"..lang) then return end
	local resp = callBackend("/api/roblox/today", { lang = lang })
	if resp and resp.ok and type(resp.steps) == "table" and #resp.steps > 0 then
		finishDraw(player,requestId,remotes.LectioToday,{kind="complete",response=resp})
		return
	end
	local idx = tonumber(os.date("!%w")) + 1
	local reading = VerseData.TodayReadings[idx] or VerseData.TodayReadings[1]
	local steps = {}
	for _, s in ipairs(reading.steps) do
		table.insert(steps, { en = s.en, zh = s.zh, refEn = s.refEn, refZh = s.refZh })
	end
	finishDraw(player,requestId,remotes.LectioToday,{kind="complete",response={ ok = true, titleEn = reading.titleEn, titleZh = reading.titleZh, steps = steps }})
end)

local function sanitizeReadingContext(raw)
	if type(raw) ~= "table" then return nil end
	local items = {}
	if type(raw.items) == "table" then
		for i, it in ipairs(raw.items) do
			if i > 12 then break end
			if type(it) == "table" then
				table.insert(items, {
					name = type(it.name) == "string" and string.sub(it.name, 1, 100) or "",
					position = type(it.position) == "string" and string.sub(it.position, 1, 100) or "",
					interp = type(it.interp) == "string" and string.sub(it.interp, 1, 1000) or "",
				})
			end
		end
	end
	return {
		spread = type(raw.spread) == "string" and string.sub(raw.spread, 1, 100) or "",
		question = type(raw.question) == "string" and string.sub(raw.question, 1, 300) or "",
		items = items,
	}
end

remotes.LectioAssistant.OnServerEvent:Connect(function(player, text, lang, reading)
	if type(text) ~= "string" then return end
	text = string.sub(text, 1, 300)
	lang = sanitizeLang(lang)

	local resp = callBackend("/api/roblox/assistant", {
		playerId = tostring(player.UserId),
		displayName = player.DisplayName,
		message = text,
		lang = lang,
		reading = sanitizeReadingContext(reading),
	})
	if resp and resp.ok and type(resp.text) == "string" then
		remotes.LectioAssistant:FireClient(player, { ok = true, text = resp.text, remaining = resp.remaining })
		return
	end
	if resp and resp.ok == false then
		remotes.LectioAssistant:FireClient(player, resp)
		return
	end

	-- Offline fallback: the local keyword-rule engine.
	local data, key = getData(player.UserId)
	if data.assist >= 10 then
		remotes.LectioAssistant:FireClient(player, { ok = false, errorKey = "assistantLimitMsg" })
		return
	end
	data.assist = data.assist + 1
	saveData(key, data)

	local lowered = string.lower(text)
	local reply = nil
	for _, rule in ipairs(VerseData.AssistantRules) do
		for _, kw in ipairs(rule.kw) do
			if string.find(lowered, string.lower(kw), 1, true) then
				reply = rule[lang]
				break
			end
		end
		if reply then break end
	end
	if not reply then
		reply = VerseData.AssistantFallback[lang]
	end
	remotes.LectioAssistant:FireClient(player, { ok = true, text = reply, remaining = 10 - data.assist })
end)

-- The Verse Library is only served by the backend (the local VerseData copy
-- stays the client-side fallback when this never succeeds).
local libraryCache = nil
remotes.LectioLibrary.OnServerEvent:Connect(function(player)
	if libraryCache == nil then
		local resp = callBackend("/api/roblox/library", {})
		if resp and resp.ok and type(resp.verses) == "table" and #resp.verses > 0 then
			libraryCache = resp
		end
	end
	remotes.LectioLibrary:FireClient(player, libraryCache or { ok = false })
end)

print("Lectio server ready" .. (LIVE and " (live backend)" or " (offline fallback)"))
