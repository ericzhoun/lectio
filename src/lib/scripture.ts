// Scripture readings for Lectio: a verse (or a small set of verses) drawn to
// be read, reflected on, and responded to.
// Verse texts use public-domain sources: Chinese Union Version (和合本) for zh,
// World English Bible (WEB, "the LORD" rendering) for en. Do not hand-edit texts casually.

// (no cross-module imports needed: layouts live in ./reading)

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

export function getVerseDeck(): BibleVerse[] {
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

// ---- Chapter context ("read it in a real Bible" page) ----------------------
// Context texts come from src/lib/bibleChapters.json (generated once by
// scripts/fetch-bible-context.mjs from public-domain sources: World English
// Bible + 和合本 CUV 神版, via api.getbible.net). Pending-view Bible pages
// render drawn verses inside their chapter's neighbouring verses; deck texts
// remain the source for the actual readings.
import bibleChapters from './bibleChapters.json';

// Standard Protestant book order (getbible book numbers).
// Exported for src/lib/passage.ts, which resolves lectionary references.
export const BOOK_NR: Record<string, number> = {
  Genesis: 1, Exodus: 2, Leviticus: 3, Numbers: 4, Deuteronomy: 5, Joshua: 6, Judges: 7, Ruth: 8,
  '1 Samuel': 9, '2 Samuel': 10, '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14,
  Ezra: 15, Nehemiah: 16, Esther: 17, Job: 18, Psalms: 19, Psalm: 19, Proverbs: 20, Ecclesiastes: 21,
  Isaiah: 23, Jeremiah: 24, Lamentations: 25, Ezekiel: 26, Daniel: 27, Hosea: 28, Joel: 29, Amos: 30,
  Obadiah: 31, Jonah: 32, Micah: 33, Nahum: 34, Zephaniah: 36, Zechariah: 38, Malachi: 39,
  Matthew: 40, Mark: 41, Luke: 42, John: 43, Acts: 44, Romans: 45, '1 Corinthians': 46,
  '2 Corinthians': 47, Galatians: 48, Ephesians: 49, Philippians: 50, Colossians: 51,
  '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54, '2 Timothy': 55, Titus: 56,
  Philemon: 57, Hebrews: 58, James: 59, '1 Peter': 60, '2 Peter': 61, '1 John': 62,
  '2 John': 63, '3 John': 64, Jude: 65, Revelation: 66,
  // Absent from the 148-verse deck, but reached by the daily lectionary.
  'Song of Solomon': 22, Habakkuk: 35, Haggai: 37,
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

export interface LibraryVerse {
  slug: string;
  refEn: string;
  refZh: string;
  textEn: string;
  textZh: string;
  themeEn: string;
  themeZh: string;
  bookEn: string;
  testament: 'old' | 'new';
}

/** URL slug for a verse reference: 'John 3:16' -> 'john-3-16'. */
export function verseSlug(refEn: string): string {
  return refEn.toLowerCase().replace(/[:\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** The whole deck as browsable library entries, in canonical book order. */
export function getLibraryVerses(): LibraryVerse[] {
  return BIBLE_VERSES.map((v) => {
    const parsed = parseVerseRef(v.en.ref);
    const bookEn = parsed?.book ?? v.en.ref;
    const nr = BOOK_NR[bookEn] ?? 99;
    return {
      slug: verseSlug(v.en.ref),
      refEn: v.en.ref,
      refZh: v.zh.ref,
      textEn: v.en.text,
      textZh: v.zh.text,
      themeEn: v.en.theme,
      themeZh: v.zh.theme,
      bookEn,
      testament: (nr < 40 ? 'old' : 'new') as 'old' | 'new',
      _nr: nr,
    };
  })
    .sort((a, b) => a._nr - b._nr)
    .map(({ _nr, ...rest }) => rest);
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
    en: { ref: '2 Corinthians 10:2-6', text: "Now I beg you that when I am present I may not yet be bold with that confidence by which I intend to be bold against some, who consider us to be walking according to the flesh. For though we walk in the flesh, we don't wage war according to the flesh; for the weapons of our warfare are not of the flesh, but mighty before God to the throwing down of strongholds, throwing down imaginations and every high thing that is exalted against the knowledge of God, and bringing every thought into captivity to the obedience of Christ; and being in readiness to avenge all disobedience, when your obedience will have been made full.", theme: 'Weapons not of the flesh' },
    zh: { ref: '哥林多后书 10:2-6', text: '有人以为我是凭着血气行事，我也以为必须用勇敢待这等人；求你们不要叫我在你们那里的时候，有这样的勇敢。因为我们虽然在血气中行事，却不凭着血气争战。我们争战的兵器本不是属血气的，乃是在神面前有能力，可以攻破坚固的营垒，将各样的计谋，各样拦阻人认识神的那些自高之事，一概攻破了，又将人所有的心意夺回，使他都顺服基督。并且我已经预备好了，等你们十分顺服的时候，要责罚那一切不顺服的人。', theme: '属灵争战' },
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

  {
    en: { ref: 'Psalm 23:4', text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.', theme: 'Through the valley' },
    zh: { ref: '诗篇 23:4', text: '我虽然行过死荫的幽谷，也不怕遭害，因为你与我同在；你的杖，你的竿，都安慰我。', theme: '走过幽谷' },
  },
  {
    en: { ref: '2 Corinthians 4:16-18', text: "Therefore we don't faint, but though our outward man is decaying, yet our inward man is renewed day by day. For our light affliction, which is for the moment, works for us more and more exceedingly an eternal weight of glory; while we don't look at the things which are seen, but at the things which are not seen. For the things which are seen are temporal, but the things which are not seen are eternal.", theme: 'Do not lose heart' },
    zh: { ref: '哥林多后书 4:16-18', text: '所以，我们不丧胆。外体虽然毁坏，内心却一天新似一天。我们这至暂至轻的苦楚，要为我们成就极重无比、永远的荣耀。原来我们不是顾念所见的，乃是顾念所不见的；因为所见的是暂时的，所不见的是永远的。', theme: '不要丧胆' },
  },
  {
    en: { ref: 'Matthew 11:28-30', text: "'Come to me, all you who labor and are heavily burdened, and I will give you rest. Take my yoke upon you, and learn from me, for I am gentle and lowly in heart; and you will find rest for your souls. For my yoke is easy, and my burden is light.'", theme: 'Rest for your soul' },
    zh: { ref: '马太福音 11:28-30', text: '凡劳苦担重担的人可以到我这里来，我就使你们得安息。我心里柔和谦卑，你们当负我的轭，学我的样式；这样，你们心里就必得享安息。因为我的轭是容易的，我的担子是轻省的。', theme: '得享安息' },
  },
  {
    en: { ref: 'Psalm 34:17-18', text: 'The righteous cry, and the LORD hears, and delivers them out of all their troubles. The LORD is near to those who have a broken heart, and saves those who have a crushed spirit.', theme: 'Near the brokenhearted' },
    zh: { ref: '诗篇 34:17-18', text: '义人呼求，耶和华听见了，便救他们脱离一切患难。耶和华靠近伤心的人，拯救灵性痛悔的人。', theme: '近伤心的人' },
  },
  {
    en: { ref: 'Psalm 91:1-2', text: "He who dwells in the secret place of the Most High will rest in the shadow of the Almighty. I will say of the LORD, 'He is my refuge and my fortress; my God, in whom I trust.'", theme: 'My refuge' },
    zh: { ref: '诗篇 91:1-2', text: '住在至高者隐密处的，必住在全能者的荫下。我要论到耶和华说：他是我的避难所，是我的山寨，是我的神，是我所倚靠的。', theme: '我的避难所' },
  },
  {
    en: { ref: 'Hebrews 6:19', text: 'This hope we have as an anchor of the soul, a hope both sure and steadfast and entering into that which is within the veil;', theme: 'Anchor of the soul' },
    zh: { ref: '希伯来书 6:19', text: '我们有这指望，如同灵魂的锚，又坚固又牢靠，且通入幔内。', theme: '灵魂的锚' },
  },
  {
    en: { ref: 'Proverbs 3:13-18', text: 'Happy is the man who finds wisdom, the man who gets understanding. For her good profit is better than getting silver, and her return is better than fine gold. She is more precious than rubies. None of the things you can desire are to be compared to her. Length of days is in her right hand. In her left hand are riches and honor. Her ways are ways of pleasantness. All her paths are peace. She is a tree of life to those who lay hold of her. Happy is everyone who retains her.', theme: 'Finding wisdom' },
    zh: { ref: '箴言 3:13-18', text: '得智慧，得聪明的，这人便为有福。因为得智慧胜过得银子，其利益强如精金，比珍珠宝贵；你一切所喜爱的，都不足与比较。她右手有长寿，左手有富贵。她的道是安乐；她的路全是平安。她与持守她的作生命树；持定她的，俱各有福。', theme: '寻得智慧' },
  },
  {
    en: { ref: 'Proverbs 1:7', text: 'The fear of the LORD is the beginning of knowledge; but the foolish despise wisdom and instruction.', theme: 'Beginning of knowledge' },
    zh: { ref: '箴言 1:7', text: '敬畏耶和华是知识的开端；愚妄人藐视智慧和训诲。', theme: '知识的开端' },
  },
  {
    en: { ref: 'Ecclesiastes 3:1-8', text: 'For everything there is a season, and a time for every purpose under heaven: a time to be born, and a time to die; a time to plant, and a time to pluck up that which is planted; a time to kill, and a time to heal; a time to break down, and a time to build up; a time to weep, and a time to laugh; a time to mourn, and a time to dance; a time to cast away stones, and a time to gather stones together; a time to embrace, and a time to refrain from embracing; a time to seek, and a time to lose; a time to keep, and a time to cast away; a time to tear, and a time to sew; a time to keep silence, and a time to speak; a time to love, and a time to hate; a time for war, and a time for peace.', theme: 'A time for everything' },
    zh: { ref: '传道书 3:1-8', text: '凡事都有定期，天下万务都有定时。生有时，死有时；栽种有时，拔出所栽种的也有时；杀戮有时，医治有时；拆毁有时，建造有时；哭有时，笑有时；哀恸有时，跳舞有时；抛掷石头有时，堆聚石头有时；怀抱有时，不怀抱有时；寻找有时，失落有时；保守有时，舍弃有时；撕裂有时，缝补有时；静默有时，言语有时；喜爱有时，恨恶有时；争战有时，和好有时。', theme: '凡事有时' },
  },
  {
    en: { ref: 'Proverbs 4:7', text: 'Wisdom is supreme. Get wisdom. Yes, though it costs all your possessions, get understanding.', theme: 'Get wisdom' },
    zh: { ref: '箴言 4:7', text: '智慧为首；所以，要得智慧。在你一切所得之内必得聪明。', theme: '智慧为首' },
  },
  {
    en: { ref: 'Colossians 3:23-24', text: 'And whatever you do, work heartily, as for the Lord, and not for men, knowing that from the Lord you will receive the reward of the inheritance; for you serve the Lord Christ.', theme: 'Work heartily' },
    zh: { ref: '歌罗西书 3:23-24', text: '无论做甚么，都要从心里做，像是给主做的，不是给人做的，因你们知道从主那里必得着基业为赏赐；你们所事奉的乃是主基督。', theme: '尽心而作' },
  },
  {
    en: { ref: 'Proverbs 16:9', text: "A man's heart plans his course, but the LORD directs his steps.", theme: 'The LORD directs steps' },
    zh: { ref: '箴言 16:9', text: '人心筹算自己的道路；惟耶和华指引他的脚步。', theme: '主定脚步' },
  },
  {
    en: { ref: 'Matthew 7:24-27', text: "'Everyone therefore who hears these words of mine, and does them, I will liken him to a wise man, who built his house on a rock. The rain came down, the floods came, and the winds blew, and beat on that house; and it didn't fall, for it was founded on the rock. Everyone who hears these words of mine, and doesn't do them will be like a foolish man, who built his house on the sand. The rain came down, the floods came, and the winds blew, and beat on that house; and it fell—and great was its fall.'", theme: 'Built on rock' },
    zh: { ref: '马太福音 7:24-27', text: '所以，凡听见我这话就去行的，好比一个聪明人，把房子盖在磐石上；雨淋，水冲，风吹，撞着那房子，房子总不倒塌，因为根基立在磐石上。凡听见我这话不去行的，好比一个无知的人，把房子盖在沙土上；雨淋，水冲，风吹，撞着那房子，房子就倒塌了，并且倒塌得很大。', theme: '根基在磐石' },
  },
  {
    en: { ref: 'Proverbs 11:14', text: 'Where there is no wise guidance, the nation falls, but in the multitude of counselors there is victory.', theme: 'Wise counsel' },
    zh: { ref: '箴言 11:14', text: '无智谋，民就败落；谋士多，人便安居。', theme: '多有谋士' },
  },
  {
    en: { ref: 'Psalm 37:5', text: 'Commit your way to the LORD. Trust also in him, and he will do this:', theme: 'Commit your way' },
    zh: { ref: '诗篇 37:5', text: '当将你的事交托耶和华，并倚靠他，他就必成全。', theme: '交托所行' },
  },
  {
    en: { ref: 'Philippians 4:10-13', text: "But I rejoice in the Lord greatly, that now at last you have revived your thought for me; indeed, you were concerned before, but you lacked opportunity. Not that I speak because of lack, for I have learned in whatever state I am, to be content in it. I know how to be abased, and I know also how to abound. In everything and in all things I have learned both to be filled and to be hungry, both to abound and to be in need. I can do all things through Christ, who strengthens me.", theme: 'Content in all things' },
    zh: { ref: '腓立比书 4:10-13', text: '我靠主大大地喜乐，因为你们思念我的心如今又发生；你们向来就思念我，只是没得机会。我并不是因缺乏说这话；我无论在什么景况都可以知足，这是我已经学会了。我知道怎样处卑贱，也知道怎样处丰富；或饱足，或饥饿；或有余，或缺乏，随事随在，我都得了秘诀。我靠着那加给我力量的，凡事都能做。', theme: '凡事知足' },
  },
  {
    en: { ref: 'Philippians 4:8', text: 'Finally, brothers, whatever things are true, whatever things are honorable, whatever things are just, whatever things are pure, whatever things are lovely, whatever things are of good report; if there is any virtue, and if there is any praise, think about these things.', theme: 'Think on these things' },
    zh: { ref: '腓立比书 4:8', text: '弟兄们，我还有未尽的话：凡是真实的、可敬的、公义的、清洁的、可爱的、有美名的，若有甚么德行，若有甚么称赞，这些事你们都要思念。', theme: '思念美善' },
  },
  {
    en: { ref: 'Proverbs 13:20', text: 'One who walks with wise men grows wise, but a companion of fools suffers harm.', theme: 'Walk with the wise' },
    zh: { ref: '箴言 13:20', text: '与智慧人同行的，必得智慧；和愚昧人作伴的，必受亏损。', theme: '与智慧人同行' },
  },
  {
    en: { ref: 'Ephesians 5:15-16', text: 'Therefore watch carefully how you walk, not as unwise, but as wise; redeeming the time, because the days are evil.', theme: 'Redeem the time' },
    zh: { ref: '以弗所书 5:15-16', text: '你们要谨慎行事，不要像愚昧人，当像智慧人。要爱惜光阴，因为现今的世代邪恶。', theme: '爱惜光阴' },
  },
  {
    en: { ref: 'Proverbs 21:5', text: 'The plans of the diligent surely lead to profit; and everyone who is hasty surely rushes to poverty.', theme: 'Diligent planning' },
    zh: { ref: '箴言 21:5', text: '殷勤筹划的，足致丰裕；行事急躁的，都必缺乏。', theme: '殷勤筹划' },
  },
  {
    en: { ref: 'Luke 14:28', text: "For which of you, desiring to build a tower, doesn't first sit down and count the cost, to see if he has enough to complete it?", theme: 'Count the cost' },
    zh: { ref: '路加福音 14:28', text: '你们哪一个要盖一座楼，不先坐下算计花费，能盖成不能呢？', theme: '先算计花费' },
  },
  {
    en: { ref: 'Proverbs 30:8-9', text: "Remove far from me falsehood and lies. Give me neither poverty nor riches. Feed me with the food that is needful for me; or I will be full, deny you, and say, 'Who is the LORD?' or lest I be poor, and steal, and so dishonor the name of my God.", theme: 'Neither poverty nor riches' },
    zh: { ref: '箴言 30:8-9', text: '求你使虚假和谎言远离我；使我也不贫穷也不富足；赐给我需用的饮食，恐怕我饱足不认你，说：耶和华是谁呢？又恐怕我贫穷就偷窃，以致亵渎我神的名。', theme: '不贫不富' },
  },
  {
    en: { ref: 'Proverbs 27:17', text: "Iron sharpens iron; so a man sharpens his friend's countenance.", theme: 'Iron sharpens iron' },
    zh: { ref: '箴言 27:17', text: '铁磨铁，磨出刃来；朋友相感也是如此。', theme: '铁磨铁' },
  },
  {
    en: { ref: 'Proverbs 22:6', text: 'Train up a child in the way he should go, and when he is old he will not depart from it.', theme: 'Train up a child' },
    zh: { ref: '箴言 22:6', text: '教养孩童，使他走当行的道，就是到老他也不偏离。', theme: '教养孩童' },
  },
  {
    en: { ref: 'James 3:17', text: 'But the wisdom that is from above is first pure, then peaceful, gentle, reasonable, full of mercy and good fruits, without partiality, and without hypocrisy.', theme: 'Wisdom from above' },
    zh: { ref: '雅各书 3:17', text: '惟独从上头来的智慧，先是清洁，后是和平，温良柔顺，满有怜悯，多结善果，没有偏见，没有假冒。', theme: '从上头来的智慧' },
  },
  {
    en: { ref: 'Ephesians 2:8-9', text: 'for by grace you have been saved through faith, and that not of yourselves; it is the gift of God, not of works, that no one would boast.', theme: 'Saved by grace' },
    zh: { ref: '以弗所书 2:8-9', text: '你们得救是本乎恩，也因着信；这并不是出于自己，乃是神所赐的；也不是出于行为，免得有人自夸。', theme: '本乎恩得救' },
  },
  {
    en: { ref: '1 John 4:7-8', text: "Beloved, let us love one another, for love is of God; and everyone who loves has been born of God, and knows God. He who doesn't love doesn't know God, for God is love.", theme: 'God is love' },
    zh: { ref: '约翰一书 4:7-8', text: '亲爱的弟兄啊，我们应当彼此相爱，因为爱是从神来的。凡有爱心的，都是由神而生，并且认识神。没有爱心的，就不认识神，因为神就是爱。', theme: '神就是爱' },
  },
  {
    en: { ref: 'Titus 3:4-5', text: 'But when the kindness of God our Savior and his love toward mankind appeared, not by works of righteousness, which we did ourselves, but according to his mercy, he saved us, through the washing of regeneration and renewing by the Holy Spirit,', theme: 'His kindness appeared' },
    zh: { ref: '提多书 3:4-5', text: '但到了神―我们救主的恩慈和他向人所施的慈爱显明的时候，他便救了我们；并不是因我们自己所行的义，乃是照他的怜悯，藉着重生的洗和圣灵的更新。', theme: '恩慈显明' },
  },
  {
    en: { ref: 'Psalm 103:8-12', text: 'The LORD is merciful and gracious, slow to anger, and abundant in loving kindness. He will not always accuse; neither will he stay angry forever. He has not dealt with us according to our sins, nor repaid us for our iniquities. For as the heavens are high above the earth, so great is his loving kindness toward those who fear him. As far as the east is from the west, so far has he removed our transgressions from us.', theme: 'Merciful and gracious' },
    zh: { ref: '诗篇 103:8-12', text: '耶和华有怜悯，有恩典，不轻易发怒，且有丰盛的慈爱。他不长久责备，也不永远怀怒。他没有按我们的罪过待我们，也没有照我们的罪孽报应我们。天离地何等的高，他的慈爱向敬畏他的人也是何等的大！东离西有多远，他叫我们的过犯离我们也有多远！', theme: '有怜悯有恩典' },
  },
  {
    en: { ref: '1 Corinthians 13:4-7', text: "Love is patient and is kind; love doesn't envy. Love doesn't brag, is not proud, doesn't behave itself inappropriately, doesn't seek its own way, is not provoked, takes no account of evil; doesn't rejoice in unrighteousness, but rejoices with the truth; bears all things, believes all things, hopes all things, endures all things.", theme: 'Love is patient' },
    zh: { ref: '哥林多前书 13:4-7', text: '爱是恒久忍耐，又有恩慈；爱是不嫉妒；爱是不自夸，不张狂，不做害羞的事，不求自己的益处，不轻易发怒，不计算人的恶，不喜欢不义，只喜欢真理；凡事包容，凡事相信，凡事盼望，凡事忍耐。', theme: '爱是恒久忍耐' },
  },
  {
    en: { ref: 'Romans 8:38-39', text: 'For I am persuaded, that neither death, nor life, nor angels, nor principalities, nor things present, nor things to come, nor powers, nor height, nor depth, nor any other created thing, will be able to separate us from the love of God, which is in Christ Jesus our Lord.', theme: 'Nothing can separate' },
    zh: { ref: '罗马书 8:38-39', text: '因为我深信无论是死，是生，是天使，是掌权的，是有能的，是现在的事，是将来的事，是高处的，是低处的，是别的受造之物，都不能叫我们与神的爱隔绝；这爱是在我们的主基督耶稣里的。', theme: '不能隔绝' },
  },
  {
    en: { ref: 'Isaiah 54:10', text: "For the mountains may depart, and the hills be removed; but my loving kindness shall not depart from you, neither shall my covenant of peace be removed,' says the LORD who has mercy on you.", theme: 'Unshakable kindness' },
    zh: { ref: '以赛亚书 54:10', text: '大山可以挪开，小山可以迁移；但我的慈爱必不离开你；我平安的约也不迁移。这是怜恤你的耶和华说的。', theme: '慈爱不离' },
  },
  {
    en: { ref: '1 John 4:19', text: 'We love him, because he first loved us.', theme: 'He first loved us' },
    zh: { ref: '约翰一书 4:19', text: '我们爱，因为神先爱我们。', theme: '神先爱我们' },
  },
  {
    en: { ref: 'Romans 12:9-10', text: 'Let love be without hypocrisy. Abhor that which is evil. Cling to that which is good. In love of the brothers be tenderly affectionate one to another; in honor preferring one another;', theme: 'Sincere love' },
    zh: { ref: '罗马书 12:9-10', text: '爱人不可虚假。恶，要厌恶；善，要亲近。爱弟兄，要彼此亲热；恭敬人，要彼此推让。', theme: '爱人不虚假' },
  },
  {
    en: { ref: '1 John 3:1', text: "See how great a love the Father has bestowed on us, that we should be called children of God! For this cause the world doesn't know us, because it didn't know him.", theme: 'Children of God' },
    zh: { ref: '约翰一书 3:1', text: '你看父赐给我们是何等的慈爱，使我们得称为神的儿女；我们也真是他的儿女。世人所以不认识我们，是因未曾认识他。', theme: '神的儿女' },
  },
  {
    en: { ref: 'Ephesians 3:17-19', text: "that Christ may dwell in your hearts through faith; to the end that you, being rooted and grounded in love, may be strengthened to comprehend with all the saints what is the breadth and length and height and depth, and to know Christ's love which surpasses knowledge, that you may be filled with all the fullness of God.", theme: 'Rooted in love' },
    zh: { ref: '以弗所书 3:17-19', text: '使基督因你们的信，住在你们心里，叫你们的爱心有根有基，能以和众圣徒一同明白基督的爱是何等长阔高深，并知道这爱是过于人所能测度的，便叫神一切所充满的，充满了你们。', theme: '扎根于爱' },
  },
  {
    en: { ref: 'Galatians 2:20', text: 'I have been crucified with Christ, and it is no longer I that live, but Christ living in me. That life which I now live in the flesh, I live by faith in the Son of God, who loved me, and gave himself up for me.', theme: 'Christ lives in me' },
    zh: { ref: '加拉太书 2:20', text: '我已经与基督同钉十字架，现在活着的不再是我，乃是基督在我里面活着；并且我如今在肉身活着，是因信神的儿子而活；他是爱我，为我舍己。', theme: '基督在我里面活着' },
  },
  {
    en: { ref: 'Psalm 136:1', text: 'Give thanks to the LORD, for he is good; for his loving kindness endures forever.', theme: 'His mercy endures' },
    zh: { ref: '诗篇 136:1', text: '你们要称谢耶和华，因他本为善；他的慈爱永远长存。', theme: '慈爱永远长存' },
  },
  {
    en: { ref: 'Matthew 22:37-39', text: "Jesus said to him, ''You shall love the Lord your God with all your heart, with all your soul, and with all your mind.' This is the first and great commandment. A second likewise is this, 'You shall love your neighbor as yourself.'", theme: 'The great commandment' },
    zh: { ref: '马太福音 22:37-39', text: '耶稣对他说：你要尽心、尽性、尽意爱主―你的神。这是诫命中的第一，且是最大的。其次也相仿，就是要爱人如己。', theme: '最大的诫命' },
  },
  {
    en: { ref: 'Ephesians 4:2-3', text: 'with all lowliness and humility, with patience, bearing with one another in love; being eager to keep the unity of the Spirit in the bond of peace.', theme: 'Keep the unity' },
    zh: { ref: '以弗所书 4:2-3', text: '凡事谦虚、温柔、忍耐，用爱心互相宽容，用和平彼此联络，竭力保守圣灵所赐合而为一的心。', theme: '保守合一' },
  },
  {
    en: { ref: '1 Corinthians 13:13', text: 'But now faith, hope, and love remain—these three. The greatest of these is love.', theme: 'The greatest is love' },
    zh: { ref: '哥林多前书 13:13', text: '如今常存的有信，有望，有爱这三样，其中最大的是爱。', theme: '其中最大的是爱' },
  },
  {
    en: { ref: 'Colossians 3:12-14', text: "Put on therefore, as God's chosen ones, holy and beloved, a heart of compassion, kindness, lowliness, humility, and perseverance; bearing with one another, and forgiving each other, if any man has a complaint against any; even as Christ forgave you, so you also do. Above all these things, walk in love, which is the bond of perfection.", theme: 'Put on love' },
    zh: { ref: '歌罗西书 3:12-14', text: '所以，你们既是神的选民，圣洁蒙爱的人，就要存怜悯、恩慈、谦虚、温柔、忍耐的心。倘若这人与那人有嫌隙，总要彼此包容，彼此饶恕；主怎样饶恕了你们，你们也要怎样饶恕人。在这一切之外，要存着爱心，爱心就是联络全德的。', theme: '穿上爱心' },
  },
  {
    en: { ref: '1 Peter 3:7', text: 'You husbands, in the same way, live with your wives according to knowledge, giving honor to the woman, as to the weaker vessel, as being also joint heirs of the grace of life; that your prayers may not be hindered.', theme: 'Honour your wife' },
    zh: { ref: '彼得前书 3:7', text: '你们作丈夫的也要按情理和妻子同住；因她比你软弱，与你一同承受生命之恩的，所以要敬重她。这样，便叫你们的祷告没有阻碍。', theme: '敬重妻子' },
  },
  {
    en: { ref: 'Proverbs 18:22', text: 'Whoever finds a wife finds a good thing, and obtains favor of the LORD.', theme: 'A good thing' },
    zh: { ref: '箴言 18:22', text: '得着贤妻的，是得着好处，也是蒙了耶和华的恩惠。', theme: '得着好处' },
  },
  {
    en: { ref: 'Genesis 2:24', text: 'Therefore a man will leave his father and his mother, and will join with his wife, and they will be one flesh.', theme: 'One flesh' },
    zh: { ref: '创世记 2:24', text: '因此，人要离开父母，与妻子连合，二人成为一体。', theme: '二人一体' },
  },
  {
    en: { ref: 'John 15:13', text: 'Greater love has no one than this, that someone lay down his life for his friends.', theme: 'Greater love' },
    zh: { ref: '约翰福音 15:13', text: '人为朋友舍命，人的爱心没有比这个大的。', theme: '最大的爱' },
  },
  {
    en: { ref: 'Matthew 5:9', text: 'Blessed are the peacemakers, for they shall be called children of God.', theme: 'Peacemakers' },
    zh: { ref: '马太福音 5:9', text: '使人和睦的人有福了！因为他们必称为神的儿子。', theme: '使人和睦' },
  },
  {
    en: { ref: 'Romans 12:10', text: 'In love of the brothers be tenderly affectionate one to another; in honor preferring one another;', theme: 'Brotherly affection' },
    zh: { ref: '罗马书 12:10', text: '爱弟兄，要彼此亲热；恭敬人，要彼此推让。', theme: '彼此亲热' },
  },
  {
    en: { ref: 'Ecclesiastes 4:9-10', text: "Two are better than one, because they have a good reward for their labor. For if they fall, the one will lift up his fellow; but woe to him who is alone when he falls, and doesn't have another to lift him up.", theme: 'Two are better' },
    zh: { ref: '传道书 4:9-10', text: '两个人总比一个人好，因为二人劳碌同得美好的果效。若是跌倒，这人可以扶起他的同伴；若是孤身跌倒，没有别人扶起他来，这人就有祸了。', theme: '二人胜一人' },
  },
  {
    en: { ref: 'Proverbs 31:10', text: 'Who can find a worthy woman? For her price is far above rubies.', theme: 'A worthy woman' },
    zh: { ref: '箴言 31:10', text: '才德的妇人谁能得着呢？她的价值远胜过珍珠。', theme: '才德的妇人' },
  },
  {
    en: { ref: 'Hebrews 10:24-25', text: 'Let us consider how to provoke one another to love and good works, not forsaking our own assembling together, as the custom of some is, but exhorting one another; and so much the more, as you see the Day approaching.', theme: 'Spur one another on' },
    zh: { ref: '希伯来书 10:24-25', text: '又要彼此相顾，激发爱心，勉励行善。你们不可停止聚会，好像那些停止惯了的人，倒要彼此劝勉，既知道那日子临近，就更当如此。', theme: '激发爱心' },
  },
  {
    en: { ref: 'Luke 6:31', text: "'As you would like people to do to you, do exactly so to them.", theme: 'The golden rule' },
    zh: { ref: '路加福音 6:31', text: '你们愿意人怎样待你们，你们也要怎样待人。', theme: '待人如己' },
  },
  {
    en: { ref: '1 Corinthians 7:3-4', text: "Let the husband render to his wife the affection owed her, and likewise also the wife to her husband. The wife doesn't have authority over her own body, but the husband. Likewise also the husband doesn't have authority over his own body, but the wife.", theme: 'Belonging to each other' },
    zh: { ref: '哥林多前书 7:3-4', text: '丈夫当用合宜之分待妻子；妻子待丈夫也要如此。妻子没有权柄主张自己的身子，乃在丈夫；丈夫也没有权柄主张自己的身子，乃在妻子。', theme: '彼此相属' },
  },
  {
    en: { ref: 'Proverbs 12:4', text: 'A worthy woman is the crown of her husband, but a disgraceful wife is as rottenness in his bones.', theme: 'A crown to her husband' },
    zh: { ref: '箴言 12:4', text: '才德的妇人是丈夫的冠冕；贻羞的妇人如同朽烂在她丈夫的骨中。', theme: '丈夫的冠冕' },
  },
  {
    en: { ref: 'Philippians 2:3-4', text: 'doing nothing through rivalry or through conceit, but in humility, each counting others better than himself; each of you not just looking to his own things, but each of you also to the things of others.', theme: 'Consider others' },
    zh: { ref: '腓立比书 2:3-4', text: '凡事不可结党，不可贪图虚浮的荣耀；只要存心谦卑，各人看别人比自己强。各人不要单顾自己的事，也要顾别人的事。', theme: '看别人比自己强' },
  },
  {
    en: { ref: '1 Peter 4:9', text: 'Be hospitable to one another without grumbling.', theme: 'Hospitality' },
    zh: { ref: '彼得前书 4:9', text: '你们要互相款待，不发怨言。', theme: '互相款待' },
  },
  {
    en: { ref: 'Ephesians 5:21-25', text: 'subjecting yourselves one to another in the fear of Christ. Wives, be subject to your own husbands, as to the Lord. For the husband is the head of the wife, and Christ also is the head of the assembly, being himself the savior of the body. But as the assembly is subject to Christ, so let the wives also be to their own husbands in everything. Husbands, love your wives, even as Christ also loved the assembly, and gave himself up for it;', theme: 'Submit to one another' },
    zh: { ref: '以弗所书 5:21-25', text: '又当存敬畏基督的心，彼此顺服。你们作妻子的，当顺服自己的丈夫，如同顺服主。因为丈夫是妻子的头，如同基督是教会的头；他又是教会全体的救主。教会怎样顺服基督，妻子也要怎样凡事顺服丈夫。你们作丈夫的，要爱你们的妻子，正如基督爱教会，为教会舍己。', theme: '彼此顺服' },
  },
  {
    en: { ref: 'Romans 10:17', text: 'So faith comes by hearing, and hearing by the word of God.', theme: 'Faith comes by hearing' },
    zh: { ref: '罗马书 10:17', text: '可见，信道是从听道来的，听道是从基督的话来的。', theme: '信道从听道来' },
  },
  {
    en: { ref: 'James 1:22', text: 'But be doers of the word, and not only hearers, deluding your own selves.', theme: 'Be doers' },
    zh: { ref: '雅各书 1:22', text: '只是你们要行道，不要单单听道，自己欺哄自己。', theme: '要行道' },
  },
  {
    en: { ref: 'James 2:17', text: 'Even so faith, if it has no works, is dead in itself.', theme: 'Faith with works' },
    zh: { ref: '雅各书 2:17', text: '这样，信心若没有行为就是死的。', theme: '信心与行为' },
  },
  {
    en: { ref: '2 Corinthians 5:7', text: 'for we walk by faith, not by sight.', theme: 'Walk by faith' },
    zh: { ref: '哥林多后书 5:7', text: '因我们行事为人是凭着信心，不是凭着眼见。', theme: '凭信而行' },
  },
  {
    en: { ref: '1 Peter 1:8-9', text: "whom not having known you love; in whom, though now you don't see him, yet believing, you rejoice greatly with joy unspeakable and full of glory— receiving the result of your faith, the salvation of your souls.", theme: 'Joy unspeakable' },
    zh: { ref: '彼得前书 1:8-9', text: '你们虽然没有见过他，却是爱他；如今虽不得看见，却因信他就有说不出来、满有荣光的大喜乐；并且得着你们信心的果效，就是灵魂的救恩。', theme: '说不出的喜乐' },
  },
  {
    en: { ref: 'James 1:3', text: 'knowing that the testing of your faith produces endurance.', theme: 'Testing produces patience' },
    zh: { ref: '雅各书 1:3', text: '因为知道你们的信心经过试验，就生忍耐。', theme: '试验生忍耐' },
  },
  {
    en: { ref: '1 John 5:4', text: 'For whatever is born of God overcomes the world. This is the victory that has overcome the world: your faith.', theme: 'Overcoming the world' },
    zh: { ref: '约翰一书 5:4', text: '因为凡从神生的，就胜过世界；使我们胜了世界的，就是我们的信心。', theme: '胜过世界' },
  },
  {
    en: { ref: 'Mark 11:24', text: 'Therefore I tell you, all things whatever you pray and ask for, believe that you have received them, and you shall have them.', theme: 'Believe you receive' },
    zh: { ref: '马可福音 11:24', text: '所以我告诉你们，凡你们祷告祈求的，无论是甚么，只要信是得着的，就必得着。', theme: '信必得着' },
  },
  {
    en: { ref: 'Matthew 17:20', text: "He said to them, 'Because of your unbelief. For most certainly I tell you, if you have faith as a grain of mustard seed, you will tell this mountain, 'Move from here to there,' and it will move; and nothing will be impossible for you.", theme: 'Faith like a mustard seed' },
    zh: { ref: '马太福音 17:20', text: '耶稣说：是因你们的信心小。我实在告诉你们，你们若有信心，像一粒芥菜种，就是对这座山说：你从这边挪到那边，它也必挪去；并且你们没有一件不能做的事了。', theme: '芥菜种的信心' },
  },
  {
    en: { ref: 'Hebrews 12:2', text: 'looking to Jesus, the author and perfecter of faith, who for the joy that was set before him endured the cross, despising its shame, and has sat down at the right hand of the throne of God.', theme: 'Looking to Jesus' },
    zh: { ref: '希伯来书 12:2', text: '仰望为我们信心创始成终的耶稣。他因那摆在前面的喜乐，就轻看羞辱，忍受了十字架的苦难，便坐在神宝座的右边。', theme: '仰望耶稣' },
  },
  {
    en: { ref: 'John 20:29', text: "Jesus said to him, 'Because you have seen me,you have believed. Blessed are those who have not seen, and have believed.'", theme: 'Blessed who believe' },
    zh: { ref: '约翰福音 20:29', text: '耶稣对他说：你因看见了我才信；那没有看见就信的有福了。', theme: '未见而信' },
  },
  {
    en: { ref: 'Hebrews 13:5', text: "Be free from the love of money, content with such things as you have, for he has said, 'I will in no way leave you, neither will I in any way forsake you.'", theme: 'Never forsake you' },
    zh: { ref: '希伯来书 13:5', text: '你们存心不可贪爱钱财，要以自己所有的为足；因为主曾说：我总不撇下你，也不丢弃你。', theme: '必不撇下你' },
  },
  {
    en: { ref: 'Colossians 2:6-7', text: 'As therefore you received Christ Jesus, the Lord, walk in him, rooted and built up in him, and established in the faith, even as you were taught, abounding in it in thanksgiving.', theme: 'Rooted and built up' },
    zh: { ref: '歌罗西书 2:6-7', text: '你们既然接受了主基督耶稣，就当遵他而行，在他里面生根建造，信心坚固，正如你们所领的教训，感谢的心也更增长了。', theme: '生根建造' },
  },
  {
    en: { ref: 'Matthew 21:21', text: "Jesus answered them, 'Most certainly I tell you, if you have faith, and don't doubt, you will not only do what was done to the fig tree, but even if you told this mountain, 'Be taken up and cast into the sea,' it would be done.", theme: 'Faith without doubt' },
    zh: { ref: '马太福音 21:21', text: '耶稣回答说：我实在告诉你们，你们若有信心，不疑惑，不但能行无花果树上所行的事，就是对这座山说：你挪开此地，投在海里！也必成就。', theme: '信而不疑' },
  },
  {
    en: { ref: 'Romans 1:17', text: "For in it is revealed God's righteousness from faith to faith. As it is written, 'But the righteous shall live by faith.'", theme: 'The just live by faith' },
    zh: { ref: '罗马书 1:17', text: '因为神的义正在这福音上显明出来；这义是本于信，以至于信。如经上所记：义人必因信得生。', theme: '义人因信得生' },
  },
];
