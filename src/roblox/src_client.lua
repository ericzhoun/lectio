-- LectioClient: rebuilds the Lectio web UI as a Roblox interface.
-- Readings served by the site backend include the AI reflection per verse
-- (`interp`) plus an overall `summary`; when the server runs in offline
-- fallback mode those fields are empty and the panel simply shows verses.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local VerseData = require(ReplicatedStorage:WaitForChild("VerseData"))
local NativeReading = require(ReplicatedStorage:WaitForChild("LectioModules"):WaitForChild("NativeReading"))
local native

local remotes = {}
for _, n in ipairs({ "LectioExplore", "LectioRegister", "LectioAssistant", "LectioState", "LectioToday", "LectioLibrary", "LectioActivity" }) do
	remotes[n] = ReplicatedStorage:WaitForChild(n)
end

local C = {
	bg = Color3.fromRGB(23, 25, 31),
	panel = Color3.fromRGB(31, 34, 42),
	panel2 = Color3.fromRGB(40, 44, 54),
	line = Color3.fromRGB(62, 67, 80),
	text = Color3.fromRGB(236, 232, 224),
	dim = Color3.fromRGB(158, 156, 150),
	gold = Color3.fromRGB(212, 178, 112),
	green = Color3.fromRGB(92, 156, 110),
	red = Color3.fromRGB(196, 92, 92),
	darkText = Color3.fromRGB(32, 26, 18),
}

-- declared before L so localization closures can read them
local lang = "en"
local selectedMode = "daily"
local state = { used = 0, limit = 3, registered = false, divina = 0, deep = 0 }
local currentReading = nil
local readingStep = 1
local ui = nil
-- Flat verse list served by the backend (nil until the first fetch succeeds;
-- the library then falls back to the built-in VerseData copy).
local libraryData = nil

local L = {
	en = {
        approachBible = "Walk to the Bible to begin your reading.",
        drawUncertain = "Your reading is still unconfirmed. Another draw is paused to avoid using a second reading.",
		title = "Lectio — Daily Scripture Reading",
		sub = "Bring a question, flip open the Bible, and let a verse find you.",
		calendar = "✦ Or follow the church calendar — Today's reading",
		popular = "Popular Topics:",
		explore = "Explore",
		usageFmt = "Used today: %d / %d · register free for 6/day",
		m1t = "1 · Daily Word", m1d = "One verse to sit with for this moment",
		m2t = "3 · Lectio Divina", m2d = "Reading, reflection, and response",
		m3t = "10 · Deep Lectio", m3d = "A ten-verse contemplative path",
		register = "Register free, read more",
		regBullets = "• Daily Word readings: 3 → 6 per day\n• Lectio Divina (3 verses) trial credits ×3\n• Deep Lectio (10 verses) trial credit ×1",
		create = "Create free account",
		registered = "Registered — 6/day unlocked",
		library = "Verse Library",
		settings = "Settings",
		assistant = "Ask a question",
		placeholder = "I want to explore…",
		am1 = "Daily Word",
		am2 = "Lectio Divina",
		am3 = "Deep Lectio",
		lblReading = "Reading",
		lblReflection = "Reflection",
		lblResponse = "Response",
		reflectionHeader = "Reflection",
		next = "Next",
		prev = "Back",
		amen = "Amen",
		close = "Close",
		libTitle = "Verse Library",
		assistantTitle = "Lectio Assistant",
		send = "Send",
		chatWelcome = "Questions? Ask what a reading means, or how this place works.",
		chatPlaceholder = "Type your question…",
		limitMsg = "You have used today's free readings. Register free for 6/day.",
		divinaMsg = "Lectio Divina is a registered gift — create a free account to unlock trial credits.",
		deepMsg = "Deep Lectio is a registered gift — create a free account to unlock a trial credit.",
		assistantLimitMsg = "The assistant has reached today's message limit.",
		backendError = "The reading service could not be reached. Please try again in a moment.",
		registeredMsg = "You are registered. Daily limit is now 6, with Lectio Divina and Deep Lectio trials.",
		stepFmt = "Step %d of %d",
		music = "Music",
		setTitle = "Settings",
	},
	zh = {
        approachBible = "请走近圣经，开始阅读。",
        drawUncertain = "本次阅读尚未确认。为避免重复扣次数，暂不能再次抽取。",
		title = "Lectio — 每日读经默想",
		sub = "带着一个问题，翻开圣经，让经文找到你。",
		calendar = "✦ 或跟随教会年历 — 今日读经",
		popular = "热门话题：",
		explore = "探索",
		usageFmt = "今日已用：%d / %d · 免费注册可达 6 次/天",
		m1t = "1 · 每日一词", m1d = "一节经文，在此刻默想",
		m2t = "3 · 灵阅", m2d = "读经、默想、回应",
		m3t = "10 · 深度灵阅", m3d = "十节经文的默想路径",
		register = "免费注册，读得更多",
		regBullets = "• 每日一词：3 → 6 次/天\n• 灵阅（3 节经文）体验 ×3\n• 深度灵阅（10 节经文）体验 ×1",
		create = "创建免费账户",
		registered = "已注册 — 每日 6 次已解锁",
		library = "经文库",
		settings = "设置",
		assistant = "问一个问题",
		placeholder = "我想探索…",
		am1 = "每日一词",
		am2 = "灵阅",
		am3 = "深度灵阅",
		lblReading = "读经",
		lblReflection = "默想",
		lblResponse = "回应",
		reflectionHeader = "默想",
		next = "下一节",
		prev = "上一节",
		amen = "阿们",
		close = "关闭",
		libTitle = "经文库",
		assistantTitle = "Lectio 助手",
		send = "发送",
		chatWelcome = "有问题吗？可以问经文的意思，或这里怎么使用。",
		chatPlaceholder = "输入你的问题…",
		limitMsg = "今日免费读经次数已用完。免费注册可达每天 6 次。",
		divinaMsg = "灵阅是注册后的礼物 — 创建免费账户解锁体验次数。",
		deepMsg = "深度灵阅是注册后的礼物 — 创建免费账户解锁体验次数。",
		assistantLimitMsg = "助手已达到今日消息上限。",
		backendError = "读经服务暂时无法连接，请稍后再试。",
		registeredMsg = "注册成功。每日上限已提升至 6 次，并解锁灵阅与深度灵阅体验。",
		stepFmt = "第 %d 步，共 %d 步",
		music = "音乐",
		setTitle = "设置",
	},
}

local function t(key, ...)
	local v = L[lang][key]
	if type(v) == "function" then
		return v(...)
	end
	return v
end

--- Backend verses use textEn/textZh; offline fallback verses use en/zh.
--- Empty strings fall through to the fallback (Lua treats "" as truthy).
local function pick(value, fallback)
	if value ~= nil and value ~= "" then return value end
	return fallback
end

local function verseTextOf(v)
	return pick(lang == "zh" and v.textZh or v.textEn, lang == "zh" and v.zh or v.en)
end

local function verseRefOf(v)
	return pick(lang == "zh" and v.refZh or v.refEn, v.refEn)
end

local function mk(class, props, parent)
	local inst = Instance.new(class)
	for k, v in pairs(props) do
		inst[k] = v
	end
	inst.Parent = parent
	return inst
end

local function round(inst, r)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, r or 10)
	c.Parent = inst
end

local music = Instance.new("Sound")
music.Name = "LectioMusic"
music.SoundId = "rbxassetid://1841647093"
music.Looped = true
music.Volume = 0.2
music.Parent = SoundService
pcall(function()
	music:Play()
end)
local musicOn = true

local function showToast(msg)
	if not ui or not ui.toast then return end
	ui.toastLabel.Text = msg
	ui.toast.Visible = true
	task.delay(3.5, function()
		if ui and ui.toast and ui.toastLabel.Text == msg then
			ui.toast.Visible = false
		end
	end)
end

local function applyState(s)
	if type(s) ~= "table" then return end
	state.used = s.used or 0
	state.limit = s.limit or 3
	state.registered = s.registered or false
	state.divina = s.divina or 0
	state.deep = s.deep or 0
	refreshUsage()
end

function refreshUsage()
	if ui and ui.usage then
		ui.usage.Text = string.format(t("usageFmt"), state.used, state.limit)
	end
	if ui and ui.regBtn then
		ui.regBtn.Text = state.registered and t("registered") or t("create")
	end
	if ui and ui.cards then
		for _, card in ipairs(ui.cards) do
			if card.mode == "divina" then
				card.tag.Text = state.registered and ("×" .. tostring(state.divina)) or "×0"
			elseif card.mode == "deep" then
				card.tag.Text = state.registered and ("×" .. tostring(state.deep)) or "×0"
			end
		end
	end
end

local function showReadingStep()
	if not currentReading or not ui then return end
	local v = currentReading.verses[readingStep]
	if not v then return end
	local isLast = readingStep >= #currentReading.verses
	ui.verseText.Text = "“" .. (verseTextOf(v) or "") .. "”"
	ui.verseRef.Text = verseRefOf(v)
	local position = pick(lang == "zh" and v.positionZh or v.positionEn, currentReading.labels[readingStep])
	ui.stepLabel.Text = position or ""
	-- The AI reflection arrives in the language the reading was requested in;
	-- on the final step the overall summary is appended.
	local interp = v.interp or ""
	local summary = isLast and (currentReading.summary or "") or ""
	local combined = interp
	if summary ~= "" then
		combined = (interp ~= "" and (interp .. "\n\n") or "") .. summary
	end
	ui.reflectionHeader.Visible = combined ~= ""
	ui.reflectionLabel.Text = combined
	ui.reflectionLabel.Visible = combined ~= ""
	ui.bodyScroll.CanvasPosition = Vector2.new(0, 0)
	ui.prevBtn.Visible = readingStep > 1
	if isLast then
		ui.nextBtn.Text = t("amen")
	else
		ui.nextBtn.Text = t("next")
	end
end

local function startReading(verses, labels, titleText, summary, topic)
	if #verses == 0 then return end
	currentReading = { verses = verses, labels = labels, summary = summary or "", topic = topic or "" }
	ui.readingTitle.Text = titleText
	readingStep = 1
	showReadingStep()
	ui.reading.Visible = true
end

local function labelsForMode(mode)
	if mode == "divina" then
		return { t("lblReading"), t("lblReflection"), t("lblResponse") }
	end
	local modeName = t("am1")
	if mode == "deep" then modeName = t("am3") end
	local labels = {}
	local n = (mode == "deep") and 10 or 1
	for i = 1, n do
		table.insert(labels, modeName .. " · " .. string.format(t("stepFmt"), i, n))
	end
	return labels
end

local function modeTitle(mode)
	if mode == "divina" then return t("am2") end
	if mode == "deep" then return t("am3") end
	return t("am1")
end

local function refreshModeCards()
	for _, card in ipairs(ui.cards) do
		local selected = card.mode == selectedMode
		card.btn.BackgroundColor3 = selected and C.gold or C.panel2
		card.title.TextColor3 = selected and C.darkText or C.text
		card.desc.TextColor3 = selected and C.darkText or C.dim
		card.tag.TextColor3 = selected and C.darkText or C.gold
	end
end

-- Backend library: flat list in canonical book order, grouped by book.
local function buildBackendLibrary()
	local order = 0
	local currentBook = nil
	for _, v in ipairs(libraryData.verses) do
		local book = v.bookEn or ""
		if book ~= currentBook then
			currentBook = book
			order = order + 1
			local header = mk("TextLabel", {
				Size = UDim2.new(1, -8, 0, 26),
				BackgroundColor3 = C.panel2,
				TextColor3 = C.gold,
				Font = Enum.Font.GothamBold,
				TextSize = 16,
				Text = string.upper(book),
				TextXAlignment = Enum.TextXAlignment.Left,
				BackgroundTransparency = 0.3,
			}, ui.libScroll)
			round(header, 6)
			header.LayoutOrder = order
		end
		order = order + 1
		local ref = (lang == "zh") and v.refZh or v.refEn
		local text = (lang == "zh") and v.textZh or v.textEn
		local row = mk("TextLabel", {
			Size = UDim2.new(1, -8, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			BackgroundColor3 = C.panel,
			TextColor3 = C.text,
			TextSize = 15,
			Font = Enum.Font.Garamond,
			TextWrapped = true,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextYAlignment = Enum.TextYAlignment.Top,
			BackgroundTransparency = 0.2,
			Text = "《" .. ref .. "》  " .. text,
		}, ui.libScroll)
		round(row, 6)
		mk("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10), PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8) }, row)
		row.LayoutOrder = order
	end
end

local function buildLibrary()
	for _, child in ipairs(ui.libScroll:GetChildren()) do
		if child:IsA("Frame") or child:IsA("TextLabel") or child:IsA("UIListLayout") then
			child:Destroy()
		end
	end
	mk("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }, ui.libScroll)
	if libraryData and type(libraryData.verses) == "table" and #libraryData.verses > 0 then
		buildBackendLibrary()
	else
		local order = 0
		for name, cat in pairs(VerseData.Categories) do
			order = order + 1
			local header = mk("TextLabel", {
				Size = UDim2.new(1, -8, 0, 26),
				BackgroundColor3 = C.panel2,
				TextColor3 = C.gold,
				Font = Enum.Font.GothamBold,
				TextSize = 16,
				Text = string.upper(name),
				TextXAlignment = Enum.TextXAlignment.Left,
				BackgroundTransparency = 0.3,
			}, ui.libScroll)
			round(header, 6)
			header.LayoutOrder = order
			for _, id in ipairs(cat.verses) do
				local v = VerseData.Verses[id]
				if v then
					order = order + 1
					local row = mk("TextLabel", {
						Size = UDim2.new(1, -8, 0, 0),
						AutomaticSize = Enum.AutomaticSize.Y,
						BackgroundColor3 = C.panel,
						TextColor3 = C.text,
						TextSize = 15,
						Font = Enum.Font.Garamond,
						TextWrapped = true,
						TextXAlignment = Enum.TextXAlignment.Left,
						TextYAlignment = Enum.TextYAlignment.Top,
						BackgroundTransparency = 0.2,
						Text = "《" .. ((lang == "zh") and v.refZh or v.refEn) .. "》  " .. ((lang == "zh") and v.zh or v.en),
					}, ui.libScroll)
					round(row, 6)
					mk("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10), PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8) }, row)
					row.LayoutOrder = order
				end
			end
		end
	end
	ui.libScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	ui.libScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
end

local function addChatBubble(text, fromPlayer)
	local row = mk("Frame", { Size = UDim2.new(1, -8, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1 }, ui.chatLog)
	local label = mk("TextLabel", {
		Size = UDim2.new(1, -12, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = fromPlayer and C.gold or C.panel2,
		TextColor3 = fromPlayer and C.darkText or C.text,
		TextSize = 15,
		Font = Enum.Font.Gotham,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		Text = ((fromPlayer and "You: ") or "") .. text,
	}, row)
	round(label, 8)
	mk("UIPadding", { PaddingLeft = UDim.new(0, 8), PaddingRight = UDim.new(0, 8), PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6) }, label)
	task.defer(function()
		ui.chatLog.CanvasPosition = Vector2.new(0, 1e9)
	end)
end

local function openAssistant()
	ui.assistant.Visible = true
	if not ui.chatStarted then
		ui.chatStarted = true
		addChatBubble(t("chatWelcome"), false)
	end
end

local function openByKey(key)
	if key == "main" then
		ui.main.Visible = not ui.main.Visible
	elseif key == "assistant" then
		openAssistant()
	elseif key == "library" then
		buildLibrary()
		ui.library.Visible = true
		remotes.LectioLibrary:FireServer()
	elseif key == "register" then
		ui.main.Visible = true
		showToast(t("register"))
	end
end

local function buildGui()
	if ui and ui.gui then ui.gui:Destroy() end
	ui = { binds = {}, chips = {}, cards = {}, chatStarted = false }

	local gui = Instance.new("ScreenGui")
	gui.Name = "LectioGui"
	gui.ResetOnSpawn = false
	gui.Parent = playerGui
	ui.gui = gui

	-- main landing panel (mirrors the website homepage)
	local main = mk("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(720, 560),
		BackgroundColor3 = C.bg,
		BackgroundTransparency = 0.05,
		BorderSizePixel = 0,
		Active = true,
	}, gui)
	round(main, 14)
	ui.main = main
    main.Visible = false
    local menuBtn = mk("TextButton", {Position=UDim2.fromOffset(16,16),Size=UDim2.fromOffset(100,44),Text="Lectio",TextSize=16,BackgroundColor3=C.panel2,TextColor3=C.gold},gui)
    round(menuBtn,8)
    menuBtn.Activated:Connect(function() main.Visible=not main.Visible end)
    local mainScale=mk("UIScale",{Scale=math.min(1,(workspace.CurrentCamera.ViewportSize.X-24)/720,(workspace.CurrentCamera.ViewportSize.Y-70)/560)},main)
    workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(function()
        mainScale.Scale=math.min(1,(workspace.CurrentCamera.ViewportSize.X-24)/720,(workspace.CurrentCamera.ViewportSize.Y-70)/560)
    end)

	local title = mk("TextLabel", { Position = UDim2.fromOffset(20, 12), Size = UDim2.fromOffset(680, 40), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.Garamond, TextScaled = true, Text = t("title") }, main)
	local sub = mk("TextLabel", { Position = UDim2.fromOffset(20, 54), Size = UDim2.fromOffset(680, 24), BackgroundTransparency = 1, TextColor3 = C.dim, Font = Enum.Font.Gotham, TextSize = 14, Text = t("sub") }, main)
	local calendarBtn = mk("TextButton", { Position = UDim2.fromOffset(210, 82), Size = UDim2.fromOffset(300, 26), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.Gotham, TextSize = 14, Text = t("calendar") }, main)
	local popularLabel = mk("TextLabel", { Position = UDim2.fromOffset(20, 114), Size = UDim2.fromOffset(300, 20), BackgroundTransparency = 1, TextColor3 = C.dim, Font = Enum.Font.Gotham, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Left, Text = t("popular") }, main)

	local chipPos = { { 20, 138 }, { 370, 138 }, { 20, 178 }, { 370, 178 } }
	for i = 1, 4 do
		local chip = mk("TextButton", {
			Position = UDim2.fromOffset(chipPos[i][1], chipPos[i][2]),
			Size = UDim2.fromOffset(330, 34),
			BackgroundColor3 = C.panel2,
			TextColor3 = C.text,
			Font = Enum.Font.Gotham,
			TextSize = 13,
			Text = VerseData.PopularTopics[i][lang],
		}, main)
		round(chip, 8)
		chip.MouseButton1Click:Connect(function()
			ui.topicBox.Text = VerseData.PopularTopics[i][lang]
		end)
		table.insert(ui.chips, chip)
	end

	local topicBox = mk("TextBox", {
		Position = UDim2.fromOffset(20, 222),
		Size = UDim2.fromOffset(680, 42),
		BackgroundColor3 = C.panel,
		TextColor3 = C.text,
		PlaceholderColor3 = C.dim,
		PlaceholderText = t("placeholder"),
		Text = "",
		TextSize = 17,
		Font = Enum.Font.Gotham,
		ClearTextOnFocus = false,
	}, main)
	round(topicBox, 10)
	ui.topicBox = topicBox

	local usage = mk("TextLabel", { Position = UDim2.fromOffset(20, 268), Size = UDim2.fromOffset(680, 20), BackgroundTransparency = 1, TextColor3 = C.dim, Font = Enum.Font.Gotham, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Left, Text = string.format(t("usageFmt"), state.used, state.limit) }, main)
	ui.usage = usage

	local cardDefs = {
		{ mode = "daily", x = 20, titleKey = "m1t", descKey = "m1d" },
		{ mode = "divina", x = 252, titleKey = "m2t", descKey = "m2d" },
		{ mode = "deep", x = 484, titleKey = "m3t", descKey = "m3d" },
	}
	for _, def in ipairs(cardDefs) do
		local btn = mk("TextButton", { Position = UDim2.fromOffset(def.x, 294), Size = UDim2.fromOffset(216, 72), BackgroundColor3 = C.panel2, Text = "", AutoButtonColor = true }, main)
		round(btn, 10)
		local cardTitle = mk("TextLabel", { Position = UDim2.fromOffset(12, 8), Size = UDim2.fromOffset(192, 24), BackgroundTransparency = 1, TextColor3 = C.text, Font = Enum.Font.GothamBold, TextSize = 16, TextXAlignment = Enum.TextXAlignment.Left, Text = t(def.titleKey) }, btn)
		local cardDesc = mk("TextLabel", { Position = UDim2.fromOffset(12, 36), Size = UDim2.fromOffset(158, 32), BackgroundTransparency = 1, TextColor3 = C.dim, Font = Enum.Font.Gotham, TextSize = 12, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = t(def.descKey) }, btn)
		local cardTag = mk("TextLabel", { Position = UDim2.fromOffset(174, 40), Size = UDim2.fromOffset(36, 22), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.GothamBold, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Right, Text = "" }, btn)
		local card = { mode = def.mode, btn = btn, title = cardTitle, desc = cardDesc, tag = cardTag, titleKey = def.titleKey, descKey = def.descKey }
		btn.MouseButton1Click:Connect(function()
			selectedMode = def.mode
			refreshModeCards()
		end)
		table.insert(ui.cards, card)
	end

	local exploreBtn = mk("TextButton", { Position = UDim2.fromOffset(20, 374), Size = UDim2.fromOffset(680, 48), BackgroundColor3 = C.gold, TextColor3 = C.darkText, Font = Enum.Font.GothamBold, TextSize = 20, Text = t("explore") }, main)
	round(exploreBtn, 10)

	local regBox = mk("Frame", { Position = UDim2.fromOffset(20, 430), Size = UDim2.fromOffset(680, 76), BackgroundColor3 = C.panel, BorderSizePixel = 0 }, main)
	round(regBox, 10)
	local regTitle = mk("TextLabel", { Position = UDim2.fromOffset(14, 6), Size = UDim2.fromOffset(320, 22), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.GothamBold, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Left, Text = t("register") }, regBox)
	local regBullets = mk("TextLabel", { Position = UDim2.fromOffset(14, 28), Size = UDim2.fromOffset(430, 44), BackgroundTransparency = 1, TextColor3 = C.dim, Font = Enum.Font.Gotham, TextSize = 12, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = t("regBullets") }, regBox)
	local regBtn = mk("TextButton", { Position = UDim2.fromOffset(468, 17), Size = UDim2.fromOffset(196, 42), BackgroundColor3 = C.green, TextColor3 = Color3.fromRGB(245, 245, 240), Font = Enum.Font.GothamBold, TextSize = 15, Text = state.registered and t("registered") or t("create") }, regBox)
	round(regBtn, 8)
	ui.regBtn = regBtn

	local libraryBtn = mk("TextButton", { Position = UDim2.fromOffset(20, 514), Size = UDim2.fromOffset(170, 32), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 14, Text = t("library") }, main)
	round(libraryBtn, 8)
	local settingsBtn = mk("TextButton", { Position = UDim2.fromOffset(200, 514), Size = UDim2.fromOffset(120, 32), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 14, Text = t("settings") }, main)
	round(settingsBtn, 8)
	local assistantBtn = mk("TextButton", { Position = UDim2.fromOffset(430, 514), Size = UDim2.fromOffset(180, 32), BackgroundColor3 = C.panel2, TextColor3 = C.gold, Font = Enum.Font.Gotham, TextSize = 14, Text = t("assistant") }, main)
	round(assistantBtn, 8)
	local langBtn = mk("TextButton", { Position = UDim2.fromOffset(620, 514), Size = UDim2.fromOffset(80, 32), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 14, Text = (lang == "en") and "中文" or "English" }, main)
	round(langBtn, 8)
	ui.langBtn = langBtn

	table.insert(ui.binds, { inst = title, key = "title" })
	table.insert(ui.binds, { inst = sub, key = "sub" })
	table.insert(ui.binds, { inst = calendarBtn, key = "calendar" })
	table.insert(ui.binds, { inst = popularLabel, key = "popular" })
	table.insert(ui.binds, { inst = exploreBtn, key = "explore" })
	table.insert(ui.binds, { inst = regTitle, key = "register" })
	table.insert(ui.binds, { inst = regBullets, key = "regBullets" })
	table.insert(ui.binds, { inst = libraryBtn, key = "library" })
	table.insert(ui.binds, { inst = settingsBtn, key = "settings" })
	table.insert(ui.binds, { inst = assistantBtn, key = "assistant" })

	-- reading panel: verse + AI reflection scroll together; the reference and
	-- controls stay fixed below.
	local reading = mk("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(640, 500), BackgroundColor3 = C.bg, BackgroundTransparency = 0.04, BorderSizePixel = 0, Visible = false, Active = true }, gui)
	round(reading, 14)
	ui.reading = reading
	local stepLabel = mk("TextLabel", { Position = UDim2.fromOffset(20, 14), Size = UDim2.fromOffset(600, 22), BackgroundTransparency = 1, TextColor3 = C.dim, Font = Enum.Font.Gotham, TextSize = 14, Text = "" }, reading)
	ui.stepLabel = stepLabel
	local readingTitle = mk("TextLabel", { Position = UDim2.fromOffset(20, 38), Size = UDim2.fromOffset(600, 28), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.Garamond, TextSize = 24, Text = "" }, reading)
	ui.readingTitle = readingTitle
	local bodyScroll = mk("ScrollingFrame", { Position = UDim2.fromOffset(40, 74), Size = UDim2.fromOffset(560, 288), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 6, ScrollBarImageColor3 = C.line, CanvasSize = UDim2.new(0, 0, 0, 0) }, reading)
	bodyScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	ui.bodyScroll = bodyScroll
	mk("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }, bodyScroll)
	local verseText = mk("TextLabel", { Size = UDim2.new(1, -10, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, TextColor3 = C.text, Font = Enum.Font.Garamond, TextSize = 22, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = "", LayoutOrder = 1 }, bodyScroll)
	ui.verseText = verseText
	local reflectionHeader = mk("TextLabel", { Size = UDim2.new(1, -10, 0, 20), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.GothamBold, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Left, Text = t("reflectionHeader"), Visible = false, LayoutOrder = 2 }, bodyScroll)
	ui.reflectionHeader = reflectionHeader
	local reflectionLabel = mk("TextLabel", { Size = UDim2.new(1, -10, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, TextColor3 = C.dim, Font = Enum.Font.Gotham, TextSize = 14, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, Text = "", Visible = false, LayoutOrder = 3 }, bodyScroll)
	ui.reflectionLabel = reflectionLabel
	local verseRef = mk("TextLabel", { Position = UDim2.fromOffset(40, 368), Size = UDim2.fromOffset(560, 28), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.Garamond, TextSize = 22, Text = "" }, reading)
	ui.verseRef = verseRef
	local closeBtn = mk("TextButton", { Position = UDim2.fromOffset(20, 420), Size = UDim2.fromOffset(110, 44), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 15, Text = t("close") }, reading)
	round(closeBtn, 8)
	local prevBtn = mk("TextButton", { Position = UDim2.fromOffset(160, 420), Size = UDim2.fromOffset(140, 44), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 15, Text = t("prev") }, reading)
	round(prevBtn, 8)
	ui.prevBtn = prevBtn
	local nextBtn = mk("TextButton", { Position = UDim2.fromOffset(340, 420), Size = UDim2.fromOffset(140, 44), BackgroundColor3 = C.gold, TextColor3 = C.darkText, Font = Enum.Font.GothamBold, TextSize = 15, Text = t("next") }, reading)
	round(nextBtn, 8)
	ui.nextBtn = nextBtn
	table.insert(ui.binds, { inst = closeBtn, key = "close" })

	-- verse library
	local library = mk("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(700, 500), BackgroundColor3 = C.bg, BackgroundTransparency = 0.04, BorderSizePixel = 0, Visible = false, Active = true }, gui)
	round(library, 14)
	ui.library = library
	local libTitle = mk("TextLabel", { Position = UDim2.fromOffset(20, 12), Size = UDim2.fromOffset(600, 30), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.Garamond, TextSize = 26, TextXAlignment = Enum.TextXAlignment.Left, Text = t("libTitle") }, library)
	table.insert(ui.binds, { inst = libTitle, key = "libTitle" })
	local libClose = mk("TextButton", { Position = UDim2.fromOffset(640, 10), Size = UDim2.fromOffset(44, 32), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.GothamBold, TextSize = 16, Text = "×" }, library)
	round(libClose, 8)
	local libScroll = mk("ScrollingFrame", { Position = UDim2.fromOffset(20, 50), Size = UDim2.fromOffset(660, 432), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 6, ScrollBarImageColor3 = C.line, CanvasSize = UDim2.new(0, 0, 0, 0) }, library)
	ui.libScroll = libScroll

	-- assistant chat
	local assistant = mk("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(460, 540), BackgroundColor3 = C.bg, BackgroundTransparency = 0.04, BorderSizePixel = 0, Visible = false, Active = true }, gui)
	round(assistant, 14)
	ui.assistant = assistant
	local assistantTitle = mk("TextLabel", { Position = UDim2.fromOffset(16, 10), Size = UDim2.fromOffset(400, 26), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.Garamond, TextSize = 22, TextXAlignment = Enum.TextXAlignment.Left, Text = t("assistantTitle") }, assistant)
	table.insert(ui.binds, { inst = assistantTitle, key = "assistantTitle" })
	local assistantClose = mk("TextButton", { Position = UDim2.fromOffset(410, 8), Size = UDim2.fromOffset(36, 28), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.GothamBold, TextSize = 16, Text = "×" }, assistant)
	round(assistantClose, 8)
	local chatLog = mk("ScrollingFrame", { Position = UDim2.fromOffset(16, 44), Size = UDim2.fromOffset(428, 398), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 6, ScrollBarImageColor3 = C.line, CanvasSize = UDim2.new(0, 0, 0, 0) }, assistant)
	ui.chatLog = chatLog
	mk("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, chatLog)
	chatLog.AutomaticCanvasSize = Enum.AutomaticSize.Y
	local chatBox = mk("TextBox", { Position = UDim2.fromOffset(16, 452), Size = UDim2.fromOffset(330, 40), BackgroundColor3 = C.panel, TextColor3 = C.text, PlaceholderColor3 = C.dim, PlaceholderText = t("chatPlaceholder"), Text = "", TextSize = 15, Font = Enum.Font.Gotham, ClearTextOnFocus = false }, assistant)
	round(chatBox, 8)
	ui.chatBox = chatBox
	local sendBtn = mk("TextButton", { Position = UDim2.fromOffset(356, 452), Size = UDim2.fromOffset(88, 40), BackgroundColor3 = C.gold, TextColor3 = C.darkText, Font = Enum.Font.GothamBold, TextSize = 15, Text = t("send") }, assistant)
	round(sendBtn, 8)
	table.insert(ui.binds, { inst = sendBtn, key = "send" })

	-- settings
	local settings = mk("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(360, 220), BackgroundColor3 = C.bg, BackgroundTransparency = 0.04, BorderSizePixel = 0, Visible = false, Active = true }, gui)
	round(settings, 14)
	ui.settings = settings
    settings.Size=UDim2.fromOffset(360,300)
	local setTitle = mk("TextLabel", { Position = UDim2.fromOffset(20, 12), Size = UDim2.fromOffset(320, 28), BackgroundTransparency = 1, TextColor3 = C.gold, Font = Enum.Font.Garamond, TextSize = 22, Text = t("setTitle") }, settings)
	table.insert(ui.binds, { inst = setTitle, key = "setTitle" })
	local musicBtn = mk("TextButton", { Position = UDim2.fromOffset(20, 56), Size = UDim2.fromOffset(320, 40), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 15, Text = "" }, settings)
	round(musicBtn, 8)
	local setClose = mk("TextButton", { Position = UDim2.fromOffset(20, 106), Size = UDim2.fromOffset(320, 40), BackgroundColor3 = C.panel2, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 15, Text = t("close") }, settings)
	round(setClose, 8)
	table.insert(ui.binds, { inst = setClose, key = "close" })
    setClose.Position=UDim2.fromOffset(20,206)
    local voiceBtn=mk("TextButton",{Position=UDim2.fromOffset(20,106),Size=UDim2.fromOffset(320,40),Text="Narration: On",TextSize=15,BackgroundColor3=C.panel2,TextColor3=C.text},settings)
    local motionBtn=mk("TextButton",{Position=UDim2.fromOffset(20,156),Size=UDim2.fromOffset(320,40),Text="Reduced motion: Off",TextSize=15,BackgroundColor3=C.panel2,TextColor3=C.text},settings)
    ui.voiceBtn=voiceBtn; ui.motionBtn=motionBtn
    voiceBtn.Activated:Connect(function()
        native:toggleMute(); refreshLang()
    end)
    motionBtn.Activated:Connect(function()
        native:toggleMotion(); refreshLang()
    end)

	-- toast
	local toast = mk("Frame", { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -30), Size = UDim2.fromOffset(460, 44), BackgroundColor3 = C.panel2, BorderSizePixel = 0, Visible = false }, gui)
	round(toast, 10)
	ui.toast = toast
	local toastLabel = mk("TextLabel", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, TextColor3 = C.text, Font = Enum.Font.Gotham, TextSize = 14, TextWrapped = true, Text = "" }, toast)
	ui.toastLabel = toastLabel

	local function updateMusicBtn()
		musicBtn.Text = t("music") .. ": " .. (musicOn and "On" or "Off")
	end
	updateMusicBtn()

	-- wiring
	exploreBtn.MouseButton1Click:Connect(function()
        ui.main.Visible=false
        native:activate(selectedMode)
	end)
	topicBox.FocusLost:Connect(function(enterPressed)
		if enterPressed then
            ui.main.Visible=false
            native:activate(selectedMode)
		end
	end)
	regBtn.MouseButton1Click:Connect(function()
		remotes.LectioRegister:FireServer()
	end)
	calendarBtn.MouseButton1Click:Connect(function()
        ui.main.Visible=false
        native:activate("today")
	end)
	libraryBtn.MouseButton1Click:Connect(function()
		buildLibrary()
		ui.library.Visible = true
		remotes.LectioLibrary:FireServer()
	end)
	libClose.MouseButton1Click:Connect(function()
		ui.library.Visible = false
	end)
	settingsBtn.MouseButton1Click:Connect(function()
		ui.settings.Visible = true
	end)
	setClose.MouseButton1Click:Connect(function()
		ui.settings.Visible = false
	end)
	musicBtn.MouseButton1Click:Connect(function()
		musicOn = not musicOn
		if musicOn then
			pcall(function() music:Play() end)
		else
			music:Stop()
		end
		updateMusicBtn()
	end)
	assistantBtn.MouseButton1Click:Connect(openAssistant)
	assistantClose.MouseButton1Click:Connect(function()
		ui.assistant.Visible = false
	end)
	sendBtn.MouseButton1Click:Connect(function()
		local text = ui.chatBox.Text
		if text == "" then return end
		ui.chatBox.Text = ""
		addChatBubble(text, true)
		remotes.LectioAssistant:FireServer(text, lang, currentReadingContext())
	end)
	chatBox.FocusLost:Connect(function(enterPressed)
		if enterPressed then
			local text = ui.chatBox.Text
			if text == "" then return end
			ui.chatBox.Text = ""
			addChatBubble(text, true)
			remotes.LectioAssistant:FireServer(text, lang, currentReadingContext())
		end
	end)
	closeBtn.MouseButton1Click:Connect(function()
		ui.reading.Visible = false
	end)
	prevBtn.MouseButton1Click:Connect(function()
		if readingStep > 1 then
			readingStep = readingStep - 1
			showReadingStep()
		end
	end)
	nextBtn.MouseButton1Click:Connect(function()
		if currentReading and readingStep < #currentReading.verses then
			readingStep = readingStep + 1
			showReadingStep()
		else
			ui.reading.Visible = false
		end
	end)
	langBtn.MouseButton1Click:Connect(function()
		if lang == "en" then lang = "zh" else lang = "en" end
		refreshLang()
	end)

	refreshModeCards()
	refreshUsage()
end

-- What is on screen, so the assistant answers with the reading in context.
function currentReadingContext()
	if not currentReading or not ui then return nil end
	local items = {}
	for i, v in ipairs(currentReading.verses) do
		if i > 12 then break end
		table.insert(items, {
			name = verseRefOf(v),
			position = currentReading.labels[i] or "",
			interp = v.interp or "",
		})
	end
	return {
		spread = currentReading.title or "",
		question = currentReading.topic or "",
		items = items,
	}
end

function refreshLang()
	if not ui or not ui.gui then return end
    if native then
        native:setLanguage(lang)
        ui.voiceBtn.Text=(lang=="zh" and "语音：" or "Narration: ")..(native.settings.narrationMuted and (lang=="zh" and "关闭" or "Off") or (lang=="zh" and "开启" or "On"))
        ui.motionBtn.Text=(lang=="zh" and "减少动态：" or "Reduced motion: ")..(native.settings.reducedMotion and (lang=="zh" and "开启" or "On") or (lang=="zh" and "关闭" or "Off"))
    end
	for _, b in ipairs(ui.binds) do
		b.inst.Text = t(b.key)
	end
	ui.topicBox.PlaceholderText = t("placeholder")
	ui.chatBox.PlaceholderText = t("chatPlaceholder")
	for i, chip in ipairs(ui.chips) do
		chip.Text = VerseData.PopularTopics[i][lang]
	end
	for _, card in ipairs(ui.cards) do
		card.title.Text = t(card.titleKey)
		card.desc.Text = t(card.descKey)
	end
	refreshUsage()
	refreshModeCards()
	ui.langBtn.Text = (lang == "en") and "中文" or "English"
	if ui.reading.Visible then showReadingStep() end
	if ui.library.Visible then buildLibrary() end
end

-- server responses
remotes.LectioState.OnClientEvent:Connect(function(s)
	applyState(s)
end)

remotes.LectioExplore.OnClientEvent:Connect(function(resp)
    if native then native:receive(resp,false) end
end)

remotes.LectioRegister.OnClientEvent:Connect(function(s)
	applyState(s)
	showToast(t("registeredMsg"))
end)

remotes.LectioToday.OnClientEvent:Connect(function(resp)
    if native then native:receive(resp,true) end
end)

remotes.LectioLibrary.OnClientEvent:Connect(function(resp)
	if type(resp) ~= "table" or not resp.ok then return end
	libraryData = resp
	if ui and ui.library.Visible then
		buildLibrary()
	end
end)

remotes.LectioAssistant.OnClientEvent:Connect(function(resp)
	if type(resp) ~= "table" then return end
	if not resp.ok then
		showToast(t(resp.errorKey or "backendError"))
		return
	end
	addChatBubble(resp.text, false)
end)

-- 3D world prompts
local function connectPrompt(prompt)
	if prompt:GetAttribute("LectioKey") then
		prompt.Triggered:Connect(function(plr)
			if plr == player then
				openByKey(prompt:GetAttribute("LectioKey"))
			end
		end)
	end
end

for _, d in ipairs(workspace:GetDescendants()) do
	if d:IsA("ProximityPrompt") then
		connectPrompt(d)
	end
end
workspace.DescendantAdded:Connect(function(d)
	if d:IsA("ProximityPrompt") then
		connectPrompt(d)
	end
end)

buildGui()
native=NativeReading.new(remotes,{
    language=function() return lang end,
    topic=function() return ui.topicBox.Text end,
    setMode=function(mode) selectedMode=mode; refreshModeCards() end,
    labels=function(mode,count)
        if mode~="today" then return labelsForMode(mode) end
        local labels={}
        for i=1,count do labels[i]=string.format(t("stepFmt"),i,count) end
        return labels
    end,title=modeTitle,
    toast=function(key) showToast(t(key)) end,
    accept=function(reading,newState)
        currentReading=reading
        if newState then applyState(newState) end
    end,
})
remotes.LectioState:FireServer()
print("Lectio client ready")
