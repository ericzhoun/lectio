-- VerseData: scripture library, topics, today's readings, assistant rules.
-- English text is KJV (public domain). Chinese text is CUV (public domain).
local VerseData = {}

VerseData.PopularTopics = {
	{ en = "How do I face this season of pressure at work?", zh = "我该如何面对这段工作中的压力？" },
	{ en = "I want to learn to love better in this relationship.", zh = "我想在这段关系中学习更好地去爱。" },
	{ en = "What do I need to let go of in the coming weeks?", zh = "在接下来的日子里，我需要放下什么？" },
	{ en = "How can I find stillness in a busy life?", zh = "在忙碌的生活中，我如何找到安静？" },
}

VerseData.Verses = {
	psa4610 = { refEn = "Psalm 46:10", refZh = "诗篇 46:10", en = "Be still, and know that I am God.", zh = "你们要休息，要知道我是神。" },
	matt1128 = { refEn = "Matthew 11:28", refZh = "马太福音 11:28", en = "Come unto me, all ye that labour and are heavy laden, and I will give you rest.", zh = "凡劳苦担重担的人，可以到我这里来，我就使你们得安息。" },
	matt1129 = { refEn = "Matthew 11:29-30", refZh = "马太福音 11:29-30", en = "Take my yoke upon you, and learn of me; for I am meek and lowly in heart: and ye shall find rest unto your souls. For my yoke is easy, and my burden is light.", zh = "我心里柔和谦卑，你们当负我的轭，学我的样式，这样，你们心里就必得享安息。因为我的轭是容易的，我的担子是轻省的。" },
	phil467 = { refEn = "Philippians 4:6-7", refZh = "腓立比书 4:6-7", en = "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.", zh = "应当一无挂虑，只要凡事借着祷告、祈求和感谢，将你们所要的告诉神。神所赐出人意外的平安，必在基督耶稣里保守你们的心怀意念。" },
	psa625 = { refEn = "Psalm 62:5", refZh = "诗篇 62:5", en = "My soul, wait thou only upon God; for my expectation is from him.", zh = "我的心哪，你当默默无声，专等候神，因为我的盼望是从他而来。" },
	psa231 = { refEn = "Psalm 23:1-3", refZh = "诗篇 23:1-3", en = "The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul.", zh = "耶和华是我的牧者，我必不致缺乏。他使我躺卧在青草地上，领我在可安歇的水边。他使我的灵魂苏醒。" },
	joh1427 = { refEn = "John 14:27", refZh = "约翰福音 14:27", en = "Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid.", zh = "我留下平安给你们，我将我的平安赐给你们。我所赐的，不像世人所赐的。你们心里不要忧愁，也不要胆怯。" },
	col315 = { refEn = "Colossians 3:15", refZh = "歌罗西书 3:15", en = "And let the peace of God rule in your hearts, to the which also ye are called in one body; and be ye thankful.", zh = "又要叫基督的平安在你们心里作主，你们也为此蒙召，归为一体，且要存感谢的心。" },
	isa4110 = { refEn = "Isaiah 41:10", refZh = "以赛亚书 41:10", en = "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.", zh = "你不要害怕，因为我与你同在；不要惊惶，因为我是你的神。我必坚固你，我必帮助你，我必用我公义的右手扶持你。" },
	psa461 = { refEn = "Psalm 46:1", refZh = "诗篇 46:1", en = "God is our refuge and strength, a very present help in trouble.", zh = "神是我们的避难所，是我们的力量，是我们在患难中随时的帮助。" },
	deut316 = { refEn = "Deuteronomy 31:6", refZh = "申命记 31:6", en = "Be strong and of a good courage, fear not, nor be afraid of them: for the LORD thy God, he it is that doth go with thee; he will not fail thee, nor forsake thee.", zh = "你们当刚强壮胆，不要害怕，也不要畏惧他们，因为耶和华你的神和你同去。他必不撇下你，也不丢弃你。" },
	onepe57 = { refEn = "1 Peter 5:7", refZh = "彼得前书 5:7", en = "Casting all your care upon him; for he careth for you.", zh = "你们要将一切的忧虑卸给神，因为他顾念你们。" },
	josh19 = { refEn = "Joshua 1:9", refZh = "约书亚记 1:9", en = "Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.", zh = "你当刚强壮胆！不要惧怕，也不要惊惶，因为你无论往哪里去，耶和华你的神必与你同在。" },
	isa4031 = { refEn = "Isaiah 40:31", refZh = "以赛亚书 40:31", en = "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; they shall walk, and not faint.", zh = "但那等候耶和华的必从新得力。他们必如鹰展翅上腾，他们奔跑却不困倦，行走却不疲乏。" },
	phil413 = { refEn = "Philippians 4:13", refZh = "腓立比书 4:13", en = "I can do all things through Christ which strengtheneth me.", zh = "我靠着那加给我力量的，凡事都能做。" },
	gal69 = { refEn = "Galatians 6:9", refZh = "加拉太书 6:9", en = "And let us not be weary in well doing: for in due season we shall reap, if we faint not.", zh = "我们行善，不可丧志；若不灰心，到了时候就要收成。" },
	psa5522 = { refEn = "Psalm 55:22", refZh = "诗篇 55:22", en = "Cast thy burden upon the LORD, and he shall sustain thee: he shall never suffer the righteous to be moved.", zh = "你要把你的重担卸给耶和华，他必抚养你，他永不叫义人动摇。" },
	pro165 = { refEn = "Proverbs 16:3", refZh = "箴言 16:3", en = "Commit thy works unto the LORD, and thy thoughts shall be established.", zh = "你所做的，要交托耶和华，你所谋的，就必成立。" },
	pro356 = { refEn = "Proverbs 3:5-6", refZh = "箴言 3:5-6", en = "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.", zh = "你要专心仰赖耶和华，不可倚靠自己的聪明，在你一切所行的事上都要认定他，他必指引你的路。" },
	jas15 = { refEn = "James 1:5", refZh = "雅各书 1:5", en = "If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.", zh = "你们中间若有缺少智慧的，应当求那厚赐与众人、也不斥责人的神，主就必赐给他。" },
	psa375 = { refEn = "Psalm 37:5", refZh = "诗篇 37:5", en = "Commit thy way unto the LORD; trust also in him; and he shall bring it to pass.", zh = "当将你的事交托耶和华，并倚靠他，他就必成全。" },
	mic68 = { refEn = "Micah 6:8", refZh = "弥迦书 6:8", en = "He hath shewed thee, O man, what is good; and what doth the LORD require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?", zh = "世人哪，耶和华已指示你何为善。他向你所要的是什么呢？只要你行公义，好怜悯，存谦卑的心，与你的神同行。" },
	oneco1345 = { refEn = "1 Corinthians 13:4-5", refZh = "哥林多前书 13:4-5", en = "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up, doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil.", zh = "爱是恒久忍耐，又有恩慈；爱是不嫉妒，爱是不自夸，不张狂，不做害羞的事，不求自己的益处，不轻易发怒，不计算人的恶。" },
	onejo418 = { refEn = "1 John 4:18-19", refZh = "约翰一书 4:18-19", en = "There is no fear in love; but perfect love casteth out fear. We love him, because he first loved us.", zh = "爱里没有惧怕；爱既完全，就把惧怕除去。我们爱，因为神先爱我们。" },
	eph432 = { refEn = "Ephesians 4:32", refZh = "以弗所书 4:32", en = "And be ye kind one to another, tenderhearted, forgiving one another, even as God for Christ's sake hath forgiven you.", zh = "并要以恩慈相待，存怜悯的心，彼此饶恕，正如神在基督里饶恕了你们一样。" },
	col313 = { refEn = "Colossians 3:13", refZh = "歌罗西书 3:13", en = "Forbearing one another, and forgiving one another, if any man have a quarrel against any: even as Christ forgave you, so also do ye.", zh = "倘若这人与那人有嫌隙，总要彼此包容，彼此饶恕；主怎样饶恕了你们，你们也要怎样饶恕人。" },
	matt614 = { refEn = "Matthew 6:14", refZh = "马太福音 6:14", en = "For if ye forgive men their trespasses, your heavenly Father will also forgive you.", zh = "你们饶恕人的过犯，你们的天父也必饶恕你们的过犯。" },
	joh152 = { refEn = "John 15:12", refZh = "约翰福音 15:12", en = "This is my commandment, That ye love one another, as I have loved you.", zh = "你们要彼此相爱，像我爱你们一样，这就是我的命令。" },
	rom58 = { refEn = "Romans 5:8", refZh = "罗马书 5:8", en = "But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.", zh = "惟有基督在我们还作罪人的时候为我们死，神的爱就在此向我们显明了。" },
	isa4318 = { refEn = "Isaiah 43:18-19", refZh = "以赛亚书 43:18-19", en = "Remember ye not the former things, neither consider the things of old. Behold, I will do a new thing; now it shall spring forth; shall ye not know it?", zh = "耶和华如此说：你们不要记念从前的事，也不要思想古时的事。看哪，我要做一件新事，如今要发现，你们岂不知道吗？" },
	twoco517 = { refEn = "2 Corinthians 5:17", refZh = "哥林多后书 5:17", en = "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new.", zh = "若有人在基督里，他就是新造的人，旧事已过，都变成新的了。" },
	phil313 = { refEn = "Philippians 3:13-14", refZh = "腓立比书 3:13-14", en = "This one thing I do, forgetting those things which are behind, and reaching forth unto those things which are before, I press toward the mark for the prize of the high calling of God in Christ Jesus.", zh = "我只有一件事，就是忘记背后，努力面前的，向着标竿直跑，要得神在基督耶稣里从上面召我来得的奖赏。" },
	rom122 = { refEn = "Romans 12:2", refZh = "罗马书 12:2", en = "And be not conformed to this world: but be ye transformed by the renewing of your mind, that ye may prove what is that good, and acceptable, and perfect, will of God.", zh = "不要效法这个世界，只要心意更新而变化，叫你们察验何为神的善良、纯全、可喜悦的旨意。" },
	ecc31 = { refEn = "Ecclesiastes 3:1", refZh = "传道书 3:1", en = "To every thing there is a season, and a time to every purpose under the heaven.", zh = "凡事都有定期，天下万务都有定时。" },
	matt634 = { refEn = "Matthew 6:34", refZh = "马太福音 6:34", en = "Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself. Sufficient unto the day is the evil thereof.", zh = "所以，不要为明天忧虑，因为明天自有明天的忧虑。一天的难处一天当就够了。" },
	jer2911 = { refEn = "Jeremiah 29:11", refZh = "耶利米书 29:11", en = "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.", zh = "耶和华说：我知道我向你们所怀的意念是赐平安的意念，不是降灾祸的意念，要叫你们末后有指望。" },
	rom828 = { refEn = "Romans 8:28", refZh = "罗马书 8:28", en = "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.", zh = "我们晓得万事都互相效力，叫爱神的人得益处，就是按他旨意被召的人。" },
	psa1211 = { refEn = "Psalm 121:1-2", refZh = "诗篇 121:1-2", en = "I will lift up mine eyes unto the hills, from whence cometh my help. My help cometh from the LORD, which made heaven and earth.", zh = "我要向山举目，我的帮助从何而来？我的帮助从造天地的耶和华而来。" },
	lam322 = { refEn = "Lamentations 3:22-23", refZh = "耶利米哀歌 3:22-23", en = "It is of the LORD's mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.", zh = "我们不致消灭，是出于耶和华诸般的慈爱，是因他的怜悯不致断绝。每早晨这都是新的。你的诚实极其广大！" },
	heb121 = { refEn = "Hebrews 12:1-2", refZh = "希伯来书 12:1-2", en = "Let us lay aside every weight, and run with patience the race that is set before us, looking unto Jesus the author and finisher of our faith.", zh = "放下各样的重担，存心忍耐，奔那摆在我们前头的路程，仰望为我们信心创始成终的耶稣。" },
	col323 = { refEn = "Colossians 3:23", refZh = "歌罗西书 3:23", en = "And whatsoever ye do, do it heartily, as to the Lord, and not unto men.", zh = "无论做什么，都要从心里做，像是给主做的，不是给人做的。" },
	psa1031 = { refEn = "Psalm 103:1-2", refZh = "诗篇 103:1-2", en = "Bless the LORD, O my soul: and all that is within me, bless his holy name. Bless the LORD, O my soul, and forget not all his benefits.", zh = "我的心哪，你要称颂耶和华！凡在我里面的，也要称颂他的圣名！我的心哪，你要称颂耶和华，不可忘记他的一切恩惠。" },
	oneth516 = { refEn = "1 Thessalonians 5:16-18", refZh = "帖撒罗尼迦前书 5:16-18", en = "Rejoice evermore. Pray without ceasing. In every thing give thanks: for this is the will of God in Christ Jesus concerning you.", zh = "要常常喜乐，不住地祷告，凡事谢恩，因为这是神在基督耶稣里向你们所定的旨意。" },
}

VerseData.AllVerseIds = {
	"psa4610", "matt1128", "matt1129", "phil467", "psa625", "psa231", "joh1427", "col315",
	"isa4110", "psa461", "deut316", "onepe57", "josh19", "isa4031", "phil413", "gal69",
	"psa5522", "pro165", "pro356", "jas15", "psa375", "mic68", "oneco1345", "onejo418",
	"eph432", "col313", "matt614", "joh152", "rom58", "isa4318", "twoco517", "phil313",
	"rom122", "ecc31", "matt634", "jer2911", "rom828", "psa1211", "lam322", "heb121",
	"col323", "psa1031", "oneth516",
}

VerseData.Categories = {
	pressure = {
		keywords = { "pressure", "work", "job", "stress", "burnout", "exam", "school", "tired", "deadline", "boss", "压力", "工作", "考试", "学业", "疲惫", "上班", "老板", "加班" },
		verses = { "phil467", "matt1128", "gal69", "col323", "heb121", "psa5522", "onepe57", "phil413" },
	},
	love = {
		keywords = { "love", "loving", "relationship", "marriage", "friend", "family", "partner", "爱", "恋爱", "婚姻", "关系", "朋友", "家人", "伴侣" },
		verses = { "oneco1345", "onejo418", "joh152", "rom58", "eph432", "col313" },
	},
	letgo = {
		keywords = { "let go", "letting go", "past", "regret", "new", "change", "move on", "放下", "过去", "改变", "重新", "舍弃", "遗憾" },
		verses = { "isa4318", "twoco517", "phil313", "rom122", "ecc31", "matt634" },
	},
	stillness = {
		keywords = { "still", "stillness", "quiet", "rest", "busy", "peace", "calm", "slow", "安静", "休息", "忙碌", "平静", "平安", "停下" },
		verses = { "psa4610", "matt1128", "matt1129", "psa625", "psa231", "joh1427", "col315" },
	},
	fear = {
		keywords = { "fear", "afraid", "worry", "anxious", "anxiety", "panic", "scared", "惧怕", "害怕", "担心", "忧虑", "焦虑", "恐慌" },
		verses = { "isa4110", "phil467", "joh1427", "psa461", "deut316", "onepe57" },
	},
	hope = {
		keywords = { "hope", "future", "lost", "purpose", "sad", "down", "depress", "lonely", "盼望", "未来", "迷失", "意义", "沮丧", "低落", "孤单" },
		verses = { "jer2911", "rom828", "psa1211", "lam322", "psa375" },
	},
	guidance = {
		keywords = { "guidance", "decide", "decision", "direction", "wisdom", "choose", "path", "指引", "决定", "方向", "智慧", "选择", "道路" },
		verses = { "pro356", "jas15", "psa375", "mic68", "pro165", "rom828" },
	},
	forgiveness = {
		keywords = { "forgive", "forgiveness", "grudge", "bitter", "anger", "resent", "饶恕", "原谅", "怨恨", "愤怒", "苦毒" },
		verses = { "eph432", "col313", "matt614", "onejo418" },
	},
	strength = {
		keywords = { "strength", "strong", "weak", "courage", "brave", "overcome", "刚强", "力量", "软弱", "勇气", "得胜" },
		verses = { "isa4031", "josh19", "phil413", "psa461", "deut316", "heb121" },
	},
	gratitude = {
		keywords = { "gratitude", "thankful", "grateful", "praise", "joy", "感恩", "感谢", "赞美", "喜乐" },
		verses = { "psa1031", "oneth516", "lam322", "col315" },
	},
}

VerseData.TodayReadings = {
	{ titleEn = "The Lord is my shepherd", titleZh = "耶和华是我的牧者", steps = {
		{ refEn = "Psalm 23:1", refZh = "诗篇 23:1", en = "The LORD is my shepherd; I shall not want.", zh = "耶和华是我的牧者，我必不致缺乏。" },
		{ refEn = "Psalm 23:2", refZh = "诗篇 23:2", en = "He maketh me to lie down in green pastures: he leadeth me beside the still waters.", zh = "他使我躺卧在青草地上，领我在可安歇的水边。" },
		{ refEn = "Psalm 23:3", refZh = "诗篇 23:3", en = "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.", zh = "他使我的灵魂苏醒，为自己的名引导我走义路。" },
	} },
	{ titleEn = "Rest for the weary", titleZh = "得享安息", steps = {
		{ refEn = "Matthew 11:28", refZh = "马太福音 11:28", en = "Come unto me, all ye that labour and are heavy laden, and I will give you rest.", zh = "凡劳苦担重担的人，可以到我这里来，我就使你们得安息。" },
		{ refEn = "Matthew 11:29", refZh = "马太福音 11:29", en = "Take my yoke upon you, and learn of me; for I am meek and lowly in heart: and ye shall find rest unto your souls.", zh = "我心里柔和谦卑，你们当负我的轭，学我的样式，这样，你们心里就必得享安息。" },
		{ refEn = "Matthew 11:30", refZh = "马太福音 11:30", en = "For my yoke is easy, and my burden is light.", zh = "因为我的轭是容易的，我的担子是轻省的。" },
	} },
	{ titleEn = "Be still", titleZh = "你们要休息", steps = {
		{ refEn = "Psalm 46:1", refZh = "诗篇 46:1", en = "God is our refuge and strength, a very present help in trouble.", zh = "神是我们的避难所，是我们的力量，是我们在患难中随时的帮助。" },
		{ refEn = "Psalm 46:10", refZh = "诗篇 46:10", en = "Be still, and know that I am God.", zh = "你们要休息，要知道我是神。" },
		{ refEn = "Philippians 4:6-7", refZh = "腓立比书 4:6-7", en = "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.", zh = "应当一无挂虑，只要凡事借着祷告、祈求和感谢，将你们所要的告诉神。" },
	} },
	{ titleEn = "Fear not", titleZh = "不要害怕", steps = {
		{ refEn = "Isaiah 41:10", refZh = "以赛亚书 41:10", en = "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee.", zh = "你不要害怕，因为我与你同在；不要惊惶，因为我是你的神。我必坚固你，我必帮助你。" },
		{ refEn = "Deuteronomy 31:6", refZh = "申命记 31:6", en = "Be strong and of a good courage, fear not, nor be afraid of them: for the LORD thy God, he it is that doth go with thee.", zh = "你们当刚强壮胆，不要害怕，也不要畏惧他们，因为耶和华你的神和你同去。" },
		{ refEn = "Joshua 1:9", refZh = "约书亚记 1:9", en = "Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.", zh = "你当刚强壮胆！不要惧怕，也不要惊惶，因为你无论往哪里去，耶和华你的神必与你同在。" },
	} },
	{ titleEn = "The way of love", titleZh = "爱的道路", steps = {
		{ refEn = "1 Corinthians 13:4", refZh = "哥林多前书 13:4", en = "Charity suffereth long, and is kind; charity envieth not.", zh = "爱是恒久忍耐，又有恩慈；爱是不嫉妒。" },
		{ refEn = "1 Corinthians 13:5", refZh = "哥林多前书 13:5", en = "Doth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil.", zh = "不做害羞的事，不求自己的益处，不轻易发怒，不计算人的恶。" },
		{ refEn = "1 Corinthians 13:6", refZh = "哥林多前书 13:6", en = "Rejoiceth not in iniquity, but rejoiceth in the truth.", zh = "不喜欢不义，只喜欢真理。" },
	} },
	{ titleEn = "Peace I leave with you", titleZh = "我留下平安给你们", steps = {
		{ refEn = "John 14:1", refZh = "约翰福音 14:1", en = "Let not your heart be troubled: ye believe in God, believe also in me.", zh = "你们心里不要忧愁；你们信神，也当信我。" },
		{ refEn = "John 14:3", refZh = "约翰福音 14:3", en = "And if I go and prepare a place for you, I will come again, and receive you unto myself; that where I am, there ye may be also.", zh = "我若去为你们预备了地方，就必再来接你们到我那里去，我在哪里，叫你们也在哪里。" },
		{ refEn = "John 14:27", refZh = "约翰福音 14:27", en = "Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you.", zh = "我留下平安给你们，我将我的平安赐给你们。我所赐的，不像世人所赐的。" },
	} },
	{ titleEn = "New every morning", titleZh = "每早晨都是新的", steps = {
		{ refEn = "Lamentations 3:22", refZh = "耶利米哀歌 3:22", en = "It is of the LORD's mercies that we are not consumed, because his compassions fail not.", zh = "我们不致消灭，是出于耶和华诸般的慈爱，是因他的怜悯不致断绝。" },
		{ refEn = "Lamentations 3:23", refZh = "耶利米哀歌 3:23", en = "They are new every morning: great is thy faithfulness.", zh = "每早晨这都是新的。你的诚实极其广大！" },
		{ refEn = "Lamentations 3:24", refZh = "耶利米哀歌 3:24", en = "The LORD is my portion, saith my soul; therefore will I hope in him.", zh = "我心里说：耶和华是我的分，因此，我要仰望他。" },
	} },
}

VerseData.AssistantRules = {
	{ kw = { "register", "sign up", "signup", "account", "注册", "账号", "帐号" },
		en = "Tap the Create free account button in the register panel. Registration is free and raises your Daily Word limit from 3 to 6 per day, and grants 3 Lectio Divina trial credits and 1 Deep Lectio credit.", zh = "点击注册面板里的创建免费账户按钮。注册免费，每日一词上限从每天 3 次提升到 6 次，并获得 3 次灵阅（Lectio Divina）体验和 1 次深度灵阅。" },
	{ kw = { "limit", "how many", "per day", "credit", "每天", "次数", "限额", "上限" },
		en = "Anonymous visitors have 3 readings per day. Registered readers have 6 per day, plus trial credits for Lectio Divina and Deep Lectio. Your usage resets each day.", zh = "未注册的访客每天有 3 次读经。注册后每天 6 次，另有灵阅与深度灵阅的体验次数。每天自动重置。" },
	{ kw = { "how", "use", "start", "help", "guide", "怎么", "如何", "使用", "帮助" },
		en = "Bring a question: type it into the box, or tap a popular topic. Choose Daily Word for one verse, Lectio Divina for three movements, or Deep Lectio for a ten-verse path. Then tap Explore.", zh = "带着一个问题来：在输入框写下它，或点一个热门话题。选择每日一词（一节经文）、灵阅（三节经文，读经、默想、回应）或深度灵阅（十节经文的路径），然后点探索。" },
	{ kw = { "mean", "meaning", "understand", "interpret", "什么意思", "理解", "明白", "解读" },
		en = "Verses arrive unbidden; this is contemplative reading, not fortune-telling. Sit with the words slowly. Try Lectio Divina: read, reflect, then respond in prayer.", zh = "经文是不期而至的；这是灵修式阅读，不是占卜。请慢慢体会这些话语。可以试试灵阅：读经、默想，然后在祷告中回应。" },
	{ kw = { "today", "calendar", "今天", "日历", "今日" },
		en = "Tap Today's reading to walk the church calendar passage one step at a time, without using your daily readings.", zh = "点击今日读经，可以一步步地走教会年历的经文，不消耗每日读经次数。" },
	{ kw = { "hello", "hi", "hey", "你好", "嗨", "您好" },
		en = "Peace be with you. Ask me what a reading means, or how this place works.", zh = "愿你平安。可以问我某段经文的意思，或这里怎么使用。" },
}

VerseData.AssistantFallback = {
	en = "I am a simple assistant. Ask how the readings work, about daily limits, or what a verse might mean. For deeper questions, sit quietly with the verse itself.",
	zh = "我是一个简单的助手。可以问我读经怎么用、每日次数，或某节经文可能的意思。更深的问题，请在经文前安静片刻。",
}

return VerseData
