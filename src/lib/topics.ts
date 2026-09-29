// Verse topics — curated thematic groupings of the library deck, rendered as
// /topics hub pages for readers and crawlers.
//
// A topic is a slug plus bilingual name/description and an ordered list of
// English deck references. Every ref must exist in the deck; the unit tests
// enforce that, the 5-verse floor, and unique slugs. Order inside a topic is
// editorial (reading order), not canonical.

import { getLibraryVerseByRef, type LibraryVerse } from './scripture';

export interface Topic {
  slug: string;
  nameEn: string;
  nameZh: string;
  descEn: string;
  descZh: string;
  refs: readonly string[];
}

export const TOPICS: readonly Topic[] = [
  {
    slug: 'anxiety',
    nameEn: 'Anxiety and Peace',
    nameZh: '忧虑与平安',
    descEn: "Passages for anxious moments: God's invitation to trade worry for peace, and to rest in his care.",
    descZh: '为焦虑时刻预备的经文：神邀请我们把忧虑交给他，在他的看顾里得平安。',
    refs: [
      'Philippians 4:6-7', '1 Peter 5:7', 'Isaiah 26:3', 'John 14:27', 'Psalm 56:3',
      'Isaiah 41:10', 'Matthew 6:26', 'Matthew 6:33', 'Psalm 23:4', 'Matthew 11:28',
    ],
  },
  {
    slug: 'strength',
    nameEn: 'Strength and Courage',
    nameZh: '力量与勇气',
    descEn: 'When you feel small or worn down: courage, endurance, and a strength that does not come from yourself.',
    descZh: '当你觉得软弱疲惫时：关于刚强、忍耐与从神而来的力量的经文。',
    refs: [
      'Joshua 1:9', 'Isaiah 40:31', 'Isaiah 41:10', 'Philippians 4:13', '2 Timothy 1:7',
      'Deuteronomy 31:6', 'Psalm 27:1', 'Psalm 46:1', '2 Corinthians 12:9', 'Isaiah 43:2',
      '1 Corinthians 16:13-14',
    ],
  },
  {
    slug: 'hope',
    nameEn: 'Hope and Comfort',
    nameZh: '盼望与安慰',
    descEn: 'For seasons of grief and waiting — promises that sorrow does not have the last word.',
    descZh: '在悲伤与等待的季节：应许我们，忧愁不是结局。',
    refs: [
      'Jeremiah 29:11', 'Romans 15:13', 'Psalm 30:5', 'Lamentations 3:22-23', 'Psalm 34:18',
      'Psalm 147:3', 'Hebrews 6:19', 'Romans 8:28', '2 Corinthians 4:16-18', 'Psalm 23:4',
    ],
  },
  {
    slug: 'gods-love',
    nameEn: 'The Love of God',
    nameZh: '神的爱',
    descEn: 'Scriptures on the love of God: its depth, its persistence, and what it means to be held by it.',
    descZh: '关于神的爱的经文：它的长阔高深，以及在爱中被扶持的意义。',
    refs: [
      'John 3:16', 'Romans 5:8', '1 John 4:7-8', '1 John 4:18', '1 John 4:19',
      'Ephesians 3:17-19', 'Romans 8:38-39', 'Isaiah 54:10', 'Psalm 136:1', '1 John 3:1',
    ],
  },
  {
    slug: 'faith',
    nameEn: 'Faith and Trust',
    nameZh: '信心与信靠',
    descEn: 'What it means to trust God when you cannot see the whole road.',
    descZh: '在看不见全路的时候信靠神——关于信心与往前行走的经文。',
    refs: [
      'Hebrews 11:1', 'Proverbs 3:5-6', '2 Corinthians 5:7', 'James 1:3', 'Matthew 17:20',
      'Mark 9:23', 'Mark 11:24', 'Matthew 21:21', 'Romans 10:17', 'Galatians 2:20',
      'Hebrews 12:2', 'James 2:17',
    ],
  },
  {
    slug: 'prayer',
    nameEn: 'Prayer',
    nameZh: '祷告',
    descEn: 'Coming to God in prayer: asking, listening, and the peace that follows.',
    descZh: '来到神面前的祷告：祈求、聆听，以及随之而来的平安。',
    refs: [
      'Psalm 5:3', 'Matthew 7:7', 'James 1:5', 'Philippians 4:6-7', 'Mark 11:24',
      'Psalm 121:1-2', 'Psalm 32:8',
    ],
  },
  {
    slug: 'wisdom',
    nameEn: 'Wisdom and Guidance',
    nameZh: '智慧与引导',
    descEn: 'For decisions and crossroads: seeking wisdom and being led along the right path.',
    descZh: '面对抉择与十字路口：寻求智慧、被引导走正路的经文。',
    refs: [
      'Proverbs 3:5-6', 'Proverbs 1:7', 'Proverbs 4:7', 'Proverbs 3:13-18', 'James 1:5',
      'James 3:17', 'Psalm 119:105', 'Psalm 32:8', 'Isaiah 30:21', 'Proverbs 11:14',
      'Psalm 37:5', 'Proverbs 16:9',
    ],
  },
  {
    slug: 'relationships',
    nameEn: 'Relationships and Family',
    nameZh: '关系与家庭',
    descEn: 'Love that is patient in real life — for marriage, friendship, family, and community.',
    descZh: '在生活中恒久忍耐的爱——为婚姻、友谊、家庭与群体预备的经文。',
    refs: [
      '1 Corinthians 13:4-7', 'Ephesians 4:2-3', 'Colossians 3:12-14', '1 Peter 4:8',
      'Romans 12:10', 'Proverbs 27:17', 'Proverbs 18:22', 'Genesis 2:24',
      'Ecclesiastes 4:9-10', 'Luke 6:31', 'Matthew 22:37-39', 'Proverbs 17:17',
      '1 Peter 3:7', 'Matthew 5:9',
    ],
  },
  {
    slug: 'work',
    nameEn: 'Work and Calling',
    nameZh: '工作与呼召',
    descEn: 'Diligence, purpose, integrity, and committing your plans to God.',
    descZh: '殷勤、目标、正直，并把手中的计划交托给神。',
    refs: [
      'Ecclesiastes 3:1', 'Philippians 4:13', 'Proverbs 16:9', 'Colossians 3:23-24',
      '1 Corinthians 10:31', 'Matthew 5:16', 'Galatians 6:9', 'Luke 14:28',
      'Proverbs 21:5', 'Ephesians 5:15-16', 'Micah 6:8', 'Proverbs 16:3',
    ],
  },
  {
    slug: 'rest',
    nameEn: 'Rest and Stillness',
    nameZh: '安息与安静',
    descEn: 'An invitation to stop striving: rest for the weary and stillness before God.',
    descZh: '停止劳碌的邀请：为疲乏的人预备的安息，以及在神面前的安静。',
    refs: [
      'Matthew 11:28', 'Matthew 11:29', 'Matthew 11:28-30', 'Psalm 23:1', 'Psalm 23:4',
      'Psalm 46:10',
    ],
  },
  {
    slug: 'joy',
    nameEn: 'Joy and Gratitude',
    nameZh: '喜乐与感恩',
    descEn: 'Joy, praise, and thanksgiving that rest on God rather than on circumstances.',
    descZh: '不依赖环境、扎根于神的喜乐、赞美与感恩。',
    refs: [
      'Psalm 118:24', 'Psalm 30:5', 'James 1:2-3', '1 Peter 1:8-9', 'Psalm 126:5',
      'Zephaniah 3:17', 'Psalm 34:8', 'Psalm 136:1', 'Philippians 4:8',
    ],
  },
  {
    slug: 'grace',
    nameEn: 'Grace and Salvation',
    nameZh: '恩典与救恩',
    descEn: 'The heart of the gospel: sin and grace, death and life, and the free gift of God in Christ.',
    descZh: '福音的核心：罪与恩典、死与生，以及神在基督里白白的恩赐。',
    refs: [
      'John 3:16', 'Romans 5:8', 'Ephesians 2:8-9', 'Romans 6:23', 'Titus 3:4-5',
      'John 10:10', '2 Corinthians 5:17', '1 John 3:1', 'Ephesians 2:10', 'Galatians 5:1',
    ],
  },
  {
    slug: 'protection',
    nameEn: 'Refuge and Protection',
    nameZh: '庇护与保护',
    descEn: 'A shelter in trouble: verses for fear, danger, and finding refuge in God.',
    descZh: '患难中的避难所——为恐惧、危险与寻求神庇护的时刻预备的经文。',
    refs: [
      'Psalm 46:1', 'Psalm 91:1-2', 'Proverbs 18:10', 'Psalm 121:1-2', '2 Thessalonians 3:3',
      'Deuteronomy 31:6', 'Psalm 27:1', 'Psalm 56:3', 'Nahum 1:7', 'Isaiah 43:2',
    ],
  },
  {
    slug: 'beginnings',
    nameEn: 'Beginnings and New Life',
    nameZh: '起初与新生',
    descEn: 'From the first verse of the Bible to new life in Christ — beginnings and being made new.',
    descZh: '从圣经的第一节到在基督里的新生命——关于创造与生命更新的经文。',
    refs: [
      'Genesis 1:1', '2 Corinthians 5:17', 'Ephesians 2:10', 'Lamentations 3:22-23',
      'Psalm 30:5', 'Isaiah 43:2',
    ],
  },
  {
    slug: 'following',
    nameEn: 'Following Jesus',
    nameZh: '跟随耶稣',
    descEn: 'What it looks like to follow Jesus day by day — the way, the truth, the life, and the calling to make him known.',
    descZh: '日复一日跟随耶稣的样子——道路、真理、生命，以及使人作门徒的呼召。',
    refs: [
      'John 14:6', 'John 10:10', 'John 15:5', 'Matthew 28:19', 'Romans 10:17',
      'Galatians 2:20', 'Hebrews 12:2', 'Matthew 5:16',
    ],
  },
];

/** A topic by its URL slug, or null when the slug is unknown. */
export function getTopicBySlug(slug: string): Topic | null {
  return TOPICS.find((t) => t.slug === slug) ?? null;
}

/** Resolve a topic's refs to library entries, in topic order. */
export function topicVerses(topic: Topic): LibraryVerse[] {
  return topic.refs
    .map((ref) => getLibraryVerseByRef(ref))
    .filter((v): v is LibraryVerse => v !== null);
}

/** Topics that include a given deck reference. */
export function topicsForVerse(refEn: string): Topic[] {
  return TOPICS.filter((t) => t.refs.includes(refEn));
}
