-- LectioServer: usage limits, registration, verse selection, 3D board, prompts.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local VerseData = require(ReplicatedStorage:WaitForChild("VerseData"))

local remoteNames = { "LectioExplore", "LectioRegister", "LectioAssistant", "LectioState", "LectioToday" }
local remotes = {}
for _, name in ipairs(remoteNames) do
	local r = Instance.new("RemoteEvent")
	r.Name = name
	r.Parent = ReplicatedStorage
	remotes[name] = r
end

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

local function versesFor(ids)
	local out = {}
	for _, id in ipairs(ids) do
		local v = VerseData.Verses[id]
		if v then
			table.insert(out, { en = v.en, zh = v.zh, refEn = v.refEn, refZh = v.refZh })
		end
	end
	return out
end

-- 3D scripture board above the altar
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

local function updateBoard(verse, lang, who)
	if not verse then return end
	if lang == "zh" then
		boardVerse.Text = verse.zh
		boardRef.Text = verse.refZh
	else
		boardVerse.Text = verse.en
		boardRef.Text = verse.refEn
	end
	boardWho.Text = "offered for " .. who
end

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
if altar then addPrompt(altar, "Flip open the Bible", "Lectio", "main") end
local desk = workspace:FindFirstChild("RegisterDesk")
if desk then addPrompt(desk, "Register free", "Lectio Registration", "register") end
local npc = workspace:FindFirstChild("AssistantNPC")
if npc then addPrompt(npc, "Ask a question", "Lectio Assistant", "assistant") end
local shelf = workspace:FindFirstChild("LibraryWall")
if shelf then addPrompt(shelf, "Browse verses", "Verse Library", "library") end

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

remotes.LectioState.OnServerEvent:Connect(function(player)
	local data = getData(player.UserId)
	remotes.LectioState:FireClient(player, stateFor(data))
end)

remotes.LectioExplore.OnServerEvent:Connect(function(player, topic, mode, lang)
	if type(topic) ~= "string" then topic = "" end
	if type(lang) ~= "string" or (lang ~= "en" and lang ~= "zh") then lang = "en" end
	if mode ~= "daily" and mode ~= "divina" and mode ~= "deep" then return end
	if #topic > 200 then topic = string.sub(topic, 1, 200) end
	if topic == "" then
		local pick = VerseData.PopularTopics[rng:NextInteger(1, #VerseData.PopularTopics)]
		topic = pick.en
	end

	local data, key = getData(player.UserId)
	if mode == "daily" then
		local limit = data.registered and 6 or 3
		if data.daily >= limit then
			remotes.LectioExplore:FireClient(player, { ok = false, errorKey = "limitMsg" })
			return
		end
		data.daily = data.daily + 1
	elseif mode == "divina" then
		if not data.registered or data.divina <= 0 then
			remotes.LectioExplore:FireClient(player, { ok = false, errorKey = "divinaMsg" })
			return
		end
		data.divina = data.divina - 1
	elseif mode == "deep" then
		if not data.registered or data.deep <= 0 then
			remotes.LectioExplore:FireClient(player, { ok = false, errorKey = "deepMsg" })
			return
		end
		data.deep = data.deep - 1
	end
	saveData(key, data)

	local count = 1
	if mode == "divina" then count = 3 end
	if mode == "deep" then count = 10 end
	local verses = versesFor(pickIds(count, categoryFor(topic)))
	remotes.LectioExplore:FireClient(player, {
		ok = true,
		mode = mode,
		topic = topic,
		verses = verses,
		state = stateFor(data),
	})
	if #verses > 0 then
		updateBoard(verses[1], lang, player.DisplayName)
	end
end)

remotes.LectioRegister.OnServerEvent:Connect(function(player)
	local data, key = getData(player.UserId)
	if not data.registered then
		data.registered = true
		data.divina = 3
		data.deep = 1
		saveData(key, data)
	end
	remotes.LectioRegister:FireClient(player, stateFor(data))
end)

remotes.LectioToday.OnServerEvent:Connect(function(player)
	local idx = tonumber(os.date("!%w")) + 1
	local reading = VerseData.TodayReadings[idx] or VerseData.TodayReadings[1]
	local steps = {}
	for _, s in ipairs(reading.steps) do
		table.insert(steps, { en = s.en, zh = s.zh, refEn = s.refEn, refZh = s.refZh })
	end
	remotes.LectioToday:FireClient(player, { ok = true, titleEn = reading.titleEn, titleZh = reading.titleZh, steps = steps })
end)

remotes.LectioAssistant.OnServerEvent:Connect(function(player, text, lang)
	if type(text) ~= "string" then return end
	if type(lang) ~= "string" or (lang ~= "en" and lang ~= "zh") then lang = "en" end
	text = string.sub(text, 1, 300)

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

print("Lectio server ready")
