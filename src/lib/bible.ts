// Bible verse readings — scripture drawn in place of tarot cards.
// Verse texts use public-domain sources: Chinese Union Version (和合本) for zh,
// World English Bible (WEB, "the LORD" rendering) for en. Do not hand-edit texts casually.

import type { Lang, Spread } from './tarot';

export type Mode = 'tarot' | 'bible';

export interface BibleVerseEntry {
  ref: string; // e.g. 'John 3:16' / '约翰福音 3:16'
  text: string;
  theme: string; // short fallback label, like a card's upright meaning
}

export interface BibleVerse {
  en: BibleVerseEntry;
  zh: BibleVerseEntry;
}

export interface DrawnVerse {
  refEn: string;
  refZh: string;
  textEn: string;
  textZh: string;
  themeEn: string;
  themeZh: string;
  position?: string;
  interp_text?: string;
  tags?: string[];
}

export function getBibleDeck(): BibleVerse[] {
  return BIBLE_VERSES;
}

/** Draw `number` unique random verses (no reversal concept for scripture). */
export function drawVerses(number = 1): DrawnVerse[] {
  const available = [...BIBLE_VERSES];
  const drawn: DrawnVerse[] = [];
  const count = Math.min(number, available.length);

  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * available.length);
    const v = available.splice(idx, 1)[0];
    drawn.push({
      refEn: v.en.ref,
      refZh: v.zh.ref,
      textEn: v.en.text,
      textZh: v.zh.text,
      themeEn: v.en.theme,
      themeZh: v.zh.theme,
    });
  }
  return drawn;
}

/**
 * Rebuild DrawnVerses from English refs (no randomness). Used to restore a
 * pending Bible draw from its signed cookie. Unknown refs are skipped so a
 * stale cookie can never inject verses outside the deck.
 */
export function rebuildDrawnVerses(refsEn: string[]): DrawnVerse[] {
  const byRef = new Map(BIBLE_VERSES.map((v) => [v.en.ref, v]));
  const seen = new Set<string>();
  const drawn: DrawnVerse[] = [];
  for (const ref of refsEn) {
    const v = byRef.get(ref);
    if (!v || seen.has(ref)) continue;
    seen.add(ref);
    drawn.push({
      refEn: v.en.ref,
      refZh: v.zh.ref,
      textEn: v.en.text,
      textZh: v.zh.text,
      themeEn: v.en.theme,
      themeZh: v.zh.theme,
    });
  }
  return drawn;
}

// Bible verse layouts, mirroring the tarot spreads exactly (same keys so the
// existing entitlement/quota gates apply unchanged, and same position labels so
// readings read the same way: past/present/future for 3, Celtic Cross for 10).
// ---- Chapter context ("read it in a real Bible" page) ----------------------
// Context texts come from src/lib/bibleChapters.json (generated once by
// scripts/fetch-bible-context.mjs from public-domain sources: World English
// Bible + 和合本 CUV 神版, via api.getbible.net). Pending-view Bible pages
// render drawn verses inside their chapter's neighbouring verses; deck texts
// remain the source for the actual readings.
import bibleChapters from './bibleChapters.json';

// Standard Protestant book order (getbible book numbers).
const BOOK_NR: Record<string, number> = {
  Genesis: 1, Exodus: 2, Leviticus: 3, Numbers: 4, Deuteronomy: 5, Joshua: 6, Judges: 7, Ruth: 8,
  '1 Samuel': 9, '2 Samuel': 10, '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14,
  Ezra: 15, Nehemiah: 16, Esther: 17, Job: 18, Psalms: 19, Psalm: 19, Proverbs: 20, Ecclesiastes: 21,
  Isaiah: 23, Jeremiah: 24, Lamentations: 25, Ezekiel: 26, Daniel: 27, Hosea: 28, Joel: 29, Amos: 30,
  Obadiah: 31, Jonah: 32, Micah: 33, Nahum: 34, Zephaniah: 36, Zechariah: 38, Malachi: 39,
  Matthew: 40, Mark: 41, Luke: 42, John: 43, Acts: 44, Romans: 45, '1 Corinthians': 46,
  '2 Corinthians': 47, Galatians: 48, Ephesians: 49, Philippians: 50, Colossians: 51,
  '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54, '2 Timothy': 55, Titus: 56,
  Philemon: 57, Hebrews: 58, James: 59, '1 Peter': 60, '2 Peter': 61, '1 John': 62, Jude: 65,
  Revelation: 66,
};

function parseVerseRef(ref: string): { book: string; chapter: number; start: number; end: number } | null {
  const m = ref.match(/^((?:[1-3] )?[A-Za-z]+) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  return { book: m[1], chapter: Number(m[2]), start: Number(m[3]), end: m[4] ? Number(m[4]) : Number(m[3]) };
}

export interface BibleContextVerse {
  num: number;
  textEn: string;
  textZh: string;
  /** Draw-order index of the drawn verse this row belongs to, -1 for context. */
  drawnIndex: number;
  /** True on the first verse of a drawn range (position-tag anchor). */
  isRangeStart: boolean;
}

export interface BibleChapterPage {
  bookEn: string;
  bookZh: string;
  chapter: number;
  /** True when verses exist before/after the shown window (ellipsis markers). */
  startsOpen: boolean;
  endsOpen: boolean;
  verses: BibleContextVerse[];
}

/**
 * Build "real Bible page" context for the drawn verses: each drawn verse (or
 * range) embedded in its chapter with ±`windowSize` neighbouring verses,
 * chapters in draw order. Falls back to the deck verse alone when a chapter
 * is missing from the context data.
 */
export function buildBiblePages(drawn: DrawnVerse[], windowSize = 6): BibleChapterPage[] {
  const groups = new Map<
    string,
    { bookEn: string; bookZh: string; chapter: number; items: Array<{ start: number; end: number; drawnIndex: number }> }
  >();
  drawn.forEach((v, idx) => {
    const ref = parseVerseRef(v.refEn);
    if (!ref) return;
    const nr = BOOK_NR[ref.book];
    if (nr === undefined) return;
    const key = `${nr}:${ref.chapter}`;
    let g = groups.get(key);
    if (!g) {
      const zhRef = v.refZh.match(/^(\S+) (\d+):/);
      g = { bookEn: ref.book, bookZh: zhRef ? zhRef[1] : '', chapter: ref.chapter, items: [] };
      groups.set(key, g);
    }
    g.items.push({ start: ref.start, end: ref.end, drawnIndex: idx });
  });

  const pages: BibleChapterPage[] = [];
  for (const [key, g] of groups) {
    const data = (bibleChapters as Record<string, { en: string[]; zh: string[] }>)[key];
    const maxVerse = data ? data.en.length : Math.max(...g.items.map((i) => i.end));
    const minDrawn = Math.min(...g.items.map((i) => i.start));
    const maxDrawn = Math.max(...g.items.map((i) => i.end));
    const from = Math.max(1, minDrawn - windowSize);
    const to = Math.min(maxVerse, maxDrawn + windowSize);
    const verses: BibleContextVerse[] = [];
    if (!data) {
      for (const item of g.items) {
        const v = drawn[item.drawnIndex];
        verses.push({ num: item.start, textEn: v.textEn, textZh: v.textZh, drawnIndex: item.drawnIndex, isRangeStart: true });
      }
    } else {
      for (let n = from; n <= to; n++) {
        const hit = g.items.find((i) => n >= i.start && n <= i.end);
        verses.push({
          num: n,
          textEn: data.en[n - 1] ?? '',
          textZh: data.zh[n - 1] ?? '',
          drawnIndex: hit ? hit.drawnIndex : -1,
          isRangeStart: hit ? hit.start === n : false,
        });
      }
    }
    pages.push({
      bookEn: g.bookEn,
      bookZh: g.bookZh,
      chapter: g.chapter,
      startsOpen: data ? from > 1 : false,
      endsOpen: data ? to < maxVerse : false,
      verses,
    });
  }
  return pages;
}

export const BIBLE_SPREADS: Record<string, Spread> = {
  single: {
    number: 1,
    name: { zh: '单节经文', en: 'Single Verse' },
    description: { zh: '一节经文，为当下带来领受与亮光', en: 'One verse brings light and insight for this moment' },
    positions: { zh: ['核心信息'], en: ['Core Message'] },
  },
  '3card': {
    number: 3,
    name: { zh: '三节经文', en: 'Three Verses' },
    description: { zh: '三节经文对应事物的过去、现在与未来', en: 'Three verses for the past, present, and future' },
    positions: { zh: ['过去', '现在', '未来'], en: ['Past', 'Present', 'Future'] },
  },
  celtic_cross: {
    number: 10,
    name: { zh: '十节经文', en: 'Ten Verses' },
    description: { zh: '经典十节经文布局，全面深入解读你的问题', en: 'Classic ten-verse layout for a thorough, in-depth reflection' },
    positions: {
      zh: ['现状', '挑战', '远因', '近因', '可能的发展', '近期未来', '自身态度', '外在环境', '希望与恐惧', '最终结果'],
      en: [
        'Present Situation', 'Challenge', 'Distant Past', 'Recent Past', 'Best Outcome',
        'Near Future', 'Your Attitude', 'External Influences', 'Hopes and Fears', 'Final Outcome',
      ],
    },
  },
};

export function getBibleSpreadName(spreadKey: string, lang: Lang): string {
  return (BIBLE_SPREADS[spreadKey] ?? BIBLE_SPREADS.single).name[lang];
}

export const BIBLE_VERSES: BibleVerse[] = [
  {
    en: { ref: 'John 3:16', text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.', theme: "God's love" },
    zh: { ref: '约翰福音 3:16', text: '神爱世人，甚至将他的独生子赐给他们，叫一切信他的，不至灭亡，反得永生。', theme: '神的爱' },
  },
  {
    en: { ref: 'Romans 5:8', text: 'But God commends his own love toward us, in that while we were yet sinners, Christ died for us.', theme: 'Love demonstrated' },
    zh: { ref: '罗马书 5:8', text: '惟有基督在我们还作罪人的时候为我们死，神的爱就在此向我们显明了。', theme: '爱的显明' },
  },
  {
    en: { ref: '1 Corinthians 13:4-5', text: "Love is patient and is kind. Love doesn't envy. Love doesn't brag, is not proud, doesn't behave itself inappropriately, doesn't seek its own way, is not provoked, takes no account of evil.", theme: 'Love in action' },
    zh: { ref: '哥林多前书 13:4-5', text: '爱是恒久忍耐，又有恩慈；爱是不嫉妒，爱是不自夸，不张狂，不做害羞的事，不求自己的益处，不轻易发怒，不计算人的恶。', theme: '爱的实践' },
  },
  {
    en: { ref: '1 John 4:18', text: 'There is no fear in love; but perfect love casts out fear.', theme: 'Love casts out fear' },
    zh: { ref: '约翰一书 4:18', text: '爱里没有惧怕；爱既完全，就把惧怕除去。', theme: '爱除惧怕' },
  },
  {
    en: { ref: '1 Peter 4:8', text: 'Above all things be earnest in your love among yourselves, for love covers a multitude of sins.', theme: 'Covering love' },
    zh: { ref: '彼得前书 4:8', text: '最要紧的是彼此切实相爱，因为爱能遮掩许多的罪。', theme: '爱的遮盖' },
  },
  {
    en: { ref: 'Proverbs 17:17', text: 'A friend loves at all times; and a brother is born for adversity.', theme: 'Friendship' },
    zh: { ref: '箴言 17:17', text: '朋友乃时常亲爱，弟兄为患难而生。', theme: '友谊' },
  },
  {
    en: { ref: 'Proverbs 15:1', text: 'A gentle answer turns away wrath, but a harsh word stirs up anger.', theme: 'Gentle answers' },
    zh: { ref: '箴言 15:1', text: '回答柔和，使怒消退；言语暴戾，触动怒气。', theme: '柔和回答' },
  },
  {
    en: { ref: 'Romans 12:2', text: "Don't be conformed to this world, but be transformed by the renewing of your mind, so that you may prove what is the good, well-pleasing, and perfect will of God.", theme: 'Renewed mind' },
    zh: { ref: '罗马书 12:2', text: '不要效法这个世界，只要心意更新而变化，叫你们察验何为神的善良、纯全、可喜悦的旨意。', theme: '心意更新' },
  },
  {
    en: { ref: 'Proverbs 4:23', text: 'Keep your heart with all diligence, for out of it is the wellspring of life.', theme: 'Guard your heart' },
    zh: { ref: '箴言 4:23', text: '你要保守你心，胜过保守一切，因为一生的果效是由心发出。', theme: '保守己心' },
  },
  {
    en: { ref: '1 Samuel 16:7', text: 'Man looks at the outward appearance, but the LORD looks at the heart.', theme: 'The inner heart' },
    zh: { ref: '撒母耳记上 16:7', text: '人是看外貌，耶和华是看内心。', theme: '内在之心' },
  },
  {
    en: { ref: 'Psalm 139:14', text: 'I will give thanks to you, for I am fearfully and wonderfully made. Your works are wonderful. My soul knows that very well.', theme: 'Wonderfully made' },
    zh: { ref: '诗篇 139:14', text: '我要称谢你，因我受造奇妙可畏。你的作为奇妙，这是我心深知道的。', theme: '受造奇妙' },
  },
  {
    en: { ref: '2 Corinthians 5:17', text: 'If anyone is in Christ, he is a new creation. The old things have passed away. Behold, all things have become new.', theme: 'New beginnings' },
    zh: { ref: '哥林多后书 5:17', text: '若有人在基督里，他就是新造的人，旧事已过，都变成新的了。', theme: '新的开始' },
  },
  {
    en: { ref: 'Galatians 5:1', text: "For freedom Christ has set us free. Stand firm therefore, and don't be subject again to a yoke of slavery.", theme: 'Freedom' },
    zh: { ref: '加拉太书 5:1', text: '基督释放了我们，叫我们得以自由。所以要站立得稳，不要再被奴仆的轭挟制。', theme: '自由' },
  },
  {
    en: { ref: 'Ephesians 2:10', text: 'For we are his workmanship, created in Christ Jesus for good works, which God prepared beforehand, that we would walk in them.', theme: 'Created for purpose' },
    zh: { ref: '以弗所书 2:10', text: '我们原是他的工作，在基督耶稣里造成的，为要叫我们行善，就是神所预备叫我们行的。', theme: '受造目的' },
  },
  {
    en: { ref: 'Jeremiah 29:11', text: "'For I know the plans that I have for you,' says the LORD, 'plans for peace and not for evil, to give you hope and a future.'", theme: 'Hope and future' },
    zh: { ref: '耶利米书 29:11', text: '耶和华说：我知道我向你们所怀的意念是赐平安的意念，不是降灾祸的意念，要叫你们末后有指望。', theme: '盼望与未来' },
  },
  {
    en: { ref: 'Philippians 1:6', text: 'He who began a good work in you will complete it until the day of Jesus Christ.', theme: 'He completes' },
    zh: { ref: '腓立比书 1:6', text: '我深信那在你们心里动了善工的，必成全这工，直到耶稣基督的日子。', theme: '成全善工' },
  },
  {
    en: { ref: 'Proverbs 3:5-6', text: "Trust in the LORD with all your heart, and don't lean on your own understanding. In all your ways acknowledge him, and he will make your paths straight.", theme: 'Guidance' },
    zh: { ref: '箴言 3:5-6', text: '你要专心仰赖耶和华，不可倚靠自己的聪明，在你一切所行的事上都要认定他，他必指引你的路。', theme: '蒙引之路' },
  },
  {
    en: { ref: 'Psalm 119:105', text: 'Your word is a lamp to my feet, and a light for my path.', theme: 'Light for the path' },
    zh: { ref: '诗篇 119:105', text: '你的话是我脚前的灯，是我路上的光。', theme: '脚前之灯' },
  },
  {
    en: { ref: 'Psalm 32:8', text: 'I will instruct you and teach you in the way which you shall go. I will counsel you with my eye on you.', theme: 'Divine counsel' },
    zh: { ref: '诗篇 32:8', text: '我要教导你，指示你当行的路；我要定睛在你身上劝戒你。', theme: '神的教导' },
  },
  {
    en: { ref: 'Isaiah 30:21', text: "Your ears will hear a voice behind you, saying, 'This is the way. Walk in it.'", theme: 'The right path' },
    zh: { ref: '以赛亚书 30:21', text: '你必听见后边有声音说：这是正路，要行在其间。', theme: '正路指引' },
  },
  {
    en: { ref: 'James 1:5', text: 'If any of you lacks wisdom, let him ask of God, who gives to all liberally and without reproach, and it will be given to him.', theme: 'Wisdom' },
    zh: { ref: '雅各书 1:5', text: '你们中间若有缺少智慧的，应当求那厚赐与众人、也不斥责人的神，主就必赐给他。', theme: '智慧' },
  },
  {
    en: { ref: 'Matthew 7:7', text: 'Ask, and it will be given you. Seek, and you will find. Knock, and it will be opened for you.', theme: 'Ask and receive' },
    zh: { ref: '马太福音 7:7', text: '你们祈求，就给你们；寻找，就寻见；叩门，就给你们开门。', theme: '祈求寻找' },
  },
  {
    en: { ref: 'Isaiah 41:10', text: "Don't be afraid, for I am with you. Don't be dismayed, for I am your God. I will strengthen you. Yes, I will help you. I will uphold you with my righteous right hand.", theme: 'Fear not' },
    zh: { ref: '以赛亚书 41:10', text: '你不要害怕，因为我与你同在；不要惊惶，因为我是你的神。我必坚固你，我必帮助你，我必用我公义的右手扶持你。', theme: '毋惧毋慌' },
  },
  {
    en: { ref: 'Joshua 1:9', text: "Be strong and courageous. Don't be afraid. Don't be dismayed, for the LORD your God is with you wherever you go.", theme: 'Courage' },
    zh: { ref: '约书亚记 1:9', text: '你当刚强壮胆！不要惧怕，也不要惊惶，因为你无论往哪里去，耶和华你的神必与你同在。', theme: '刚强壮胆' },
  },
  {
    en: { ref: 'Philippians 4:13', text: 'I can do all things through Christ, who strengthens me.', theme: 'Strength' },
    zh: { ref: '腓立比书 4:13', text: '我靠着那加给我力量的，凡事都能做。', theme: '力量源泉' },
  },
  {
    en: { ref: 'Isaiah 40:31', text: 'Those who wait for the LORD will renew their strength. They will soar with wings like eagles. They will run, and not be weary. They will walk, and not faint.', theme: 'Renewed strength' },
    zh: { ref: '以赛亚书 40:31', text: '但那等候耶和华的必从新得力。他们必如鹰展翅上腾，他们奔跑却不困倦，行走却不疲乏。', theme: '重新得力' },
  },
  {
    en: { ref: 'Psalm 46:1', text: 'God is our refuge and strength, a very present help in trouble.', theme: 'Refuge' },
    zh: { ref: '诗篇 46:1', text: '神是我们的避难所，是我们的力量，是我们在患难中随时的帮助。', theme: '避难所' },
  },
  {
    en: { ref: 'Psalm 27:1', text: 'The LORD is my light and my salvation. Whom shall I fear? The LORD is the strength of my life. Of whom shall I be afraid?', theme: 'Light and salvation' },
    zh: { ref: '诗篇 27:1', text: '耶和华是我的亮光，是我的拯救，我还怕谁呢？耶和华是我性命的保障，我还惧谁呢？', theme: '亮光拯救' },
  },
  {
    en: { ref: 'Deuteronomy 31:6', text: 'Be strong and courageous. Don\'t be afraid or scared of them, for the LORD your God himself is who goes with you. He will not fail you nor forsake you.', theme: 'Never forsaken' },
    zh: { ref: '申命记 31:6', text: '你们当刚强壮胆，不要害怕，也不要畏惧他们，因为耶和华你的神和你同去。他必不撇下你，也不丢弃你。', theme: '永不撇弃' },
  },
  {
    en: { ref: '2 Timothy 1:7', text: "For God didn't give us a spirit of fear, but of power, love, and self-control.", theme: 'Power and sound mind' },
    zh: { ref: '提摩太后书 1:7', text: '因为神赐给我们，不是胆怯的心，乃是刚强、仁爱、谨守的心。', theme: '刚强谨守' },
  },
  {
    en: { ref: 'Psalm 56:3', text: 'When I am afraid, I will put my trust in you.', theme: 'Trust when afraid' },
    zh: { ref: '诗篇 56:3', text: '我惧怕的时候要倚靠你。', theme: '惧怕时倚靠' },
  },
  {
    en: { ref: 'Romans 8:31', text: 'If God is for us, who can be against us?', theme: 'God with us' },
    zh: { ref: '罗马书 8:31', text: '神若帮助我们，谁能敌挡我们呢？', theme: '神若帮助' },
  },
  {
    en: { ref: 'Philippians 4:6-7', text: 'In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God. The peace of God, which surpasses all understanding, will guard your hearts and thoughts in Christ Jesus.', theme: 'Peace over anxiety' },
    zh: { ref: '腓立比书 4:6-7', text: '应当一无挂虑，只要凡事藉着祷告、祈求和感谢，将你们所要的告诉神。神所赐出人意外的平安，必在基督耶稣里保守你们的心怀意念。', theme: '平安胜忧虑' },
  },
  {
    en: { ref: '1 Peter 5:7', text: 'Cast all your worries on him, because he cares for you.', theme: 'Cast your cares' },
    zh: { ref: '彼得前书 5:7', text: '你们要将一切的忧虑卸给神，因为他顾念你们。', theme: '卸下忧虑' },
  },
  {
    en: { ref: 'John 14:27', text: "Peace I leave with you. My peace I give to you; not as the world gives. Don't let your heart be troubled, neither let it be fearful.", theme: 'True peace' },
    zh: { ref: '约翰福音 14:27', text: '我留下平安给你们，我将我的平安赐给你们。我所赐的，不像世人所赐的。你们心里不要忧愁，也不要胆怯。', theme: '真平安' },
  },
  {
    en: { ref: 'Isaiah 26:3', text: 'You will keep him in perfect peace, whose mind is stayed on you, because he trusts in you.', theme: 'Perfect peace' },
    zh: { ref: '以赛亚书 26:3', text: '坚心倚赖你的，你必保守他十分平安，因为他倚靠你。', theme: '十分平安' },
  },
  {
    en: { ref: 'Colossians 3:15', text: 'Let the peace of God rule in your hearts, to which also you were called in one body; and be thankful.', theme: 'Peace rules' },
    zh: { ref: '歌罗西书 3:15', text: '又要叫基督的平安在你们心里作主；你们也为此蒙召，归为一体，且要存感谢的心。', theme: '平安作主' },
  },
  {
    en: { ref: 'John 16:33', text: 'In the world you have trouble; but cheer up! I have overcome the world.', theme: 'Overcoming' },
    zh: { ref: '约翰福音 16:33', text: '在世上你们有苦难，但你们可以放心，我已经胜了世界。', theme: '胜过世界' },
  },
  {
    en: { ref: 'Romans 15:13', text: 'Now may the God of hope fill you with all joy and peace in believing, that you may abound in hope by the power of the Holy Spirit.', theme: 'Abounding hope' },
    zh: { ref: '罗马书 15:13', text: '但愿使人有盼望的神，因信将诸般的喜乐平安充满你们的心，使你们藉着圣灵的能力大有盼望。', theme: '盼望满溢' },
  },
  {
    en: { ref: 'Matthew 11:28', text: 'Come to me, all you who labor and are heavily burdened, and I will give you rest.', theme: 'Rest' },
    zh: { ref: '马太福音 11:28', text: '凡劳苦担重担的人可以到我这里来，我就使你们得安息。', theme: '得享安息' },
  },
  {
    en: { ref: 'Matthew 11:29', text: 'Take my yoke upon you, and learn from me, for I am gentle and lowly in heart; and you will find rest for your souls.', theme: 'Rest for your soul' },
    zh: { ref: '马太福音 11:29', text: '我心里柔和谦卑，你们当负我的轭，学我的样式，这样，你们心里就必得享安息。', theme: '心灵安息' },
  },
  {
    en: { ref: 'Psalm 30:5', text: 'Weeping may stay for the night, but joy comes in the morning.', theme: 'Morning joy' },
    zh: { ref: '诗篇 30:5', text: '一宿虽然有哭泣，早晨便必欢呼。', theme: '早晨欢呼' },
  },
  {
    en: { ref: 'Psalm 147:3', text: 'He heals the broken in heart, and binds up their wounds.', theme: 'Healing' },
    zh: { ref: '诗篇 147:3', text: '他医好伤心的人，裹好他们的伤处。', theme: '医治伤口' },
  },
  {
    en: { ref: 'Psalm 34:18', text: 'The LORD is near to those who have a broken heart, and saves those who have a crushed spirit.', theme: 'Near the broken' },
    zh: { ref: '诗篇 34:18', text: '耶和华靠近伤心的人，拯救灵性痛悔的人。', theme: '靠近伤心人' },
  },
  {
    en: { ref: 'Lamentations 3:22-23', text: "It is because of the LORD's loving kindnesses that we are not consumed, because his compassions don't fail. They are new every morning. Great is your faithfulness.", theme: 'New every morning' },
    zh: { ref: '耶利米哀歌 3:22-23', text: '我们不致消灭，是出于耶和华诸般的慈爱，是因他的怜悯不致断绝。每早晨这都是新的。你的诚实极其广大！', theme: '慈爱常新' },
  },
  {
    en: { ref: '2 Corinthians 12:9', text: 'My grace is sufficient for you, for my power is made perfect in weakness.', theme: 'Grace in weakness' },
    zh: { ref: '哥林多后书 12:9', text: '我的恩典够你用的，因为我的能力是在人的软弱上显得完全。', theme: '恩典够用' },
  },
  {
    en: { ref: 'Isaiah 43:2', text: 'When you pass through the waters, I will be with you; and through the rivers, they will not overflow you. When you walk through the fire, you will not be burned, and flame will not scorch you.', theme: 'Presence in trials' },
    zh: { ref: '以赛亚书 43:2', text: '你从水中经过，我必与你同在；你趟过江河，水必不漫过你；你从火中行过，必不被烧，火焰也不着在你身上。', theme: '患难同在' },
  },
  {
    en: { ref: 'James 1:2-3', text: 'Count it all joy, my brothers, when you fall into various trials, knowing that the testing of your faith produces endurance.', theme: 'Joy in trials' },
    zh: { ref: '雅各书 1:2-3', text: '我的弟兄们，你们落在百般试炼中，都要以为大喜乐；因为知道你们的信心经过试验，就生忍耐。', theme: '试炼喜乐' },
  },
  {
    en: { ref: 'Psalm 126:5', text: 'Those who sow in tears will reap in joy.', theme: 'Sowing and reaping' },
    zh: { ref: '诗篇 126:5', text: '流泪撒种的，必欢呼收割。', theme: '流泪撒种' },
  },
  {
    en: { ref: 'Galatians 6:9', text: "Let's not be weary in doing good, for we will reap in due season if we don't give up.", theme: 'Perseverance' },
    zh: { ref: '加拉太书 6:9', text: '我们行善，不可丧志；若不灰心，到了时候就要收成。', theme: '恒心行善' },
  },
  {
    en: { ref: 'Ecclesiastes 3:1', text: 'For everything there is a season, and a time for every purpose under heaven.', theme: 'Seasons of life' },
    zh: { ref: '传道书 3:1', text: '凡事都有定期，天下万务都有定时。', theme: '人生时节' },
  },
  {
    en: { ref: 'Zephaniah 3:17', text: 'The LORD your God is among you, a mighty one who will save. He will rejoice over you with joy. He will calm you in his love. He will rejoice over you with singing.', theme: 'God rejoices over you' },
    zh: { ref: '西番雅书 3:17', text: '耶和华你的神是施行拯救、大有能力的主。他在你中间必因你欢欣喜乐，默然爱你，且因你喜乐而欢呼。', theme: '神因你欢欣' },
  },
  {
    en: { ref: 'Nahum 1:7', text: 'The LORD is good, a stronghold in the day of trouble; and he knows those who take refuge in him.', theme: 'God is good' },
    zh: { ref: '那鸿书 1:7', text: '耶和华本为善，在患难的日子为人的保障，并且认得那些投靠他的人。', theme: '神本为善' },
  },
  {
    en: { ref: 'Psalm 34:8', text: 'Oh taste and see that the LORD is good. Blessed is the man who takes refuge in him.', theme: 'Taste and see' },
    zh: { ref: '诗篇 34:8', text: '你们要尝尝主恩的滋味，便知道他是美善；投靠他的人有福了。', theme: '尝主恩滋味' },
  },
  {
    en: { ref: 'Proverbs 18:10', text: "The LORD's name is a strong tower: the righteous run into it, and are safe.", theme: 'Strong tower' },
    zh: { ref: '箴言 18:10', text: '耶和华的名是坚固台，义人奔入便得安稳。', theme: '坚固台' },
  },
  {
    en: { ref: 'Psalm 121:1-2', text: 'I will lift up my eyes to the hills. Where does my help come from? My help comes from the LORD, who made heaven and earth.', theme: 'Help from above' },
    zh: { ref: '诗篇 121:1-2', text: '我要向山举目。我的帮助从何而来？我的帮助从造天地的耶和华而来。', theme: '从上而来的帮助' },
  },
  {
    en: { ref: '2 Thessalonians 3:3', text: 'But the Lord is faithful, who will establish you and guard you from the evil one.', theme: 'Faithful protection' },
    zh: { ref: '帖撒罗尼迦后书 3:3', text: '但主是信实的，要坚固你们，保护你们脱离那恶者。', theme: '信实保守' },
  },
  {
    en: { ref: 'Hebrews 13:8', text: 'Jesus Christ is the same yesterday, today, and forever.', theme: 'Unchanging' },
    zh: { ref: '希伯来书 13:8', text: '耶稣基督昨日、今日、一直到永远，是一样的。', theme: '永不改变' },
  },
  {
    en: { ref: 'Matthew 6:26', text: "Look at the birds of the air: they don't sow, neither do they reap, nor gather into barns. Your heavenly Father feeds them. Aren't you of much more value than they?", theme: "God's provision" },
    zh: { ref: '马太福音 6:26', text: '你们看那天上的飞鸟，也不种，也不收，也不积蓄在仓里，你们的天父尚且养活它。你们不比飞鸟贵重得多吗？', theme: '天父看顾' },
  },
  {
    en: { ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall lack nothing.', theme: 'The Shepherd' },
    zh: { ref: '诗篇 23:1', text: '耶和华是我的牧者，我必不致缺乏。', theme: '牧者供应' },
  },
  {
    en: { ref: 'Matthew 6:33', text: "But seek first God's Kingdom and his righteousness, and all these things will be given to you as well.", theme: 'Right priorities' },
    zh: { ref: '马太福音 6:33', text: '你们要先求他的国和他的义，这些东西都要加给你们了。', theme: '先后次序' },
  },
  {
    en: { ref: 'Psalm 37:4', text: 'Delight yourself in the LORD, and he will give you the desires of your heart.', theme: 'Delight in God' },
    zh: { ref: '诗篇 37:4', text: '又要以耶和华为乐，他就将你心里所求的赐给你。', theme: '以主为乐' },
  },
  {
    en: { ref: 'Proverbs 16:3', text: 'Commit your deeds to the LORD, and your plans shall succeed.', theme: 'Commit your plans' },
    zh: { ref: '箴言 16:3', text: '你所做的，要交托耶和华，你所谋的，就必成立。', theme: '交托成全' },
  },
  {
    en: { ref: 'Colossians 3:23', text: 'Whatever you do, work heartily, as for the Lord and not for men.', theme: 'Wholehearted work' },
    zh: { ref: '歌罗西书 3:23', text: '无论做什么，都要从心里做，像是给主做的，不是给人做的。', theme: '尽心做工' },
  },
  {
    en: { ref: '1 Corinthians 10:31', text: 'Whether you eat or drink, or whatever you do, do all to the glory of God.', theme: "For God's glory" },
    zh: { ref: '哥林多前书 10:31', text: '你们或吃或喝，无论做什么，都要为荣耀神而行。', theme: '荣耀而行' },
  },
  {
    en: { ref: 'Galatians 5:22-23', text: 'The fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faith, gentleness, and self-control. Against such things there is no law.', theme: 'Fruit of the Spirit' },
    zh: { ref: '加拉太书 5:22-23', text: '圣灵所结的果子，就是仁爱、喜乐、和平、忍耐、恩慈、良善、信实、温柔、节制。这样的事没有律法禁止。', theme: '圣灵果子' },
  },
  {
    en: { ref: 'Micah 6:8', text: 'What does the LORD require of you, but to act justly, to love mercy, and to walk humbly with your God?', theme: 'Justice and humility' },
    zh: { ref: '弥迦书 6:8', text: '耶和华已指示你何为善。他向你所要的是什么呢？只要你行公义，好怜悯，存谦卑的心，与你的神同行。', theme: '公义谦卑' },
  },
  {
    en: { ref: 'Matthew 5:16', text: 'Let your light shine before men, that they may see your good works and glorify your Father who is in heaven.', theme: 'Shining light' },
    zh: { ref: '马太福音 5:16', text: '你们的光也当这样照在人前，叫他们看见你们的好行为，便将荣耀归给你们在天上的父。', theme: '照亮世界' },
  },
  {
    en: { ref: 'John 15:5', text: 'I am the vine. You are the branches. He who remains in me, and I in him, bears much fruit, for apart from me you can do nothing.', theme: 'Abiding fruit' },
    zh: { ref: '约翰福音 15:5', text: '我是葡萄树，你们是枝子。常在我里面的，我也常在他里面，这人就多结果子；因为离了我，你们就不能做什么。', theme: '常在主里' },
  },
  {
    en: { ref: 'Ephesians 3:20', text: 'Now to him who is able to do exceedingly abundantly above all that we ask or think, according to the power that works in us.', theme: 'Beyond asking' },
    zh: { ref: '以弗所书 3:20', text: '神能照着运行在我们心里的大力，充充足足地成就一切，超过我们所求所想的。', theme: '超乎所想' },
  },
  {
    en: { ref: 'Mark 9:23', text: 'All things are possible to him who believes.', theme: 'Power of faith' },
    zh: { ref: '马可福音 9:23', text: '在信的人，凡事都能。', theme: '信心之能' },
  },
  {
    en: { ref: 'Luke 1:37', text: 'For no word from God will be void of power.', theme: "God's powerful word" },
    zh: { ref: '路加福音 1:37', text: '因为出于神的话，没有一句不带能力的。', theme: '话语带能' },
  },
  {
    en: { ref: 'Hebrews 11:1', text: 'Now faith is assurance of things hoped for, proof of things not seen.', theme: 'Faith' },
    zh: { ref: '希伯来书 11:1', text: '信就是所望之事的实底，是未见之事的确据。', theme: '信心实底' },
  },
  {
    en: { ref: '1 Corinthians 16:13-14', text: 'Watch! Stand firm in the faith! Be courageous! Be strong! Let all that you do be done in love.', theme: 'Stand firm' },
    zh: { ref: '哥林多前书 16:13-14', text: '你们务要警醒，在真道上站立得稳，要作大丈夫，要刚强。凡你们所做的都要凭爱心而做。', theme: '站立得稳' },
  },
  {
    en: { ref: 'Psalm 118:24', text: 'This is the day that the LORD has made. We will rejoice and be glad in it.', theme: 'Rejoice today' },
    zh: { ref: '诗篇 118:24', text: '这是耶和华所定的日子，我们在其中要高兴欢喜。', theme: '今日欢喜' },
  },
  {
    en: { ref: 'Psalm 5:3', text: 'In the morning, the LORD, you will hear my voice. In the morning I will lay my requests before you, and will watch expectantly.', theme: 'Morning prayer' },
    zh: { ref: '诗篇 5:3', text: '耶和华啊，早晨你必听我的声音；早晨我必向你陈明我的心意，并要警醒。', theme: '清晨祷告' },
  },
  {
    en: { ref: 'Romans 8:28', text: 'We know that all things work together for good for those who love God, for those who are called according to his purpose.', theme: 'All things work together' },
    zh: { ref: '罗马书 8:28', text: '我们晓得万事都互相效力，叫爱神的人得益处，就是按他旨意被召的人。', theme: '万事互相效力' },
  },
  {
    en: { ref: 'Isaiah 55:8-9', text: "'For my thoughts are not your thoughts, and my ways are not your ways,' says the LORD. 'For as the heavens are higher than the earth, so are my ways higher than your ways, and my thoughts than your thoughts.'", theme: 'Higher ways' },
    zh: { ref: '以赛亚书 55:8-9', text: '我的意念非同你们的意念，我的道路非同你们的道路。天怎样高过地，照样，我的道路高过你们的道路，我的意念高过你们的意念。', theme: '高于己意' },
  },
];
