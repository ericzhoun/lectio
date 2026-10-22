// The library reading guide "Work and Calling" — the synthesis of Marx's
// account of creative labour (species-essence, objectification, alienation)
// with the biblical doctrine of work.
//
// Rendered by src/pages/library/work-and-calling.astro. Kept as data (rather
// than prose inside the page) so the unit tests can assert that every passage
// it links still exists in the deck, and that both languages are complete.
//
// Every `refs` entry must be an English deck reference — the page resolves
// them through getLibraryVerseByRef() and silently drops unknown ones, but the
// test makes a typo fail loudly instead of shrinking the guide.

export interface GuideSection {
  /** Short label above the heading, e.g. "The claim". */
  kickerEn: string;
  kickerZh: string;
  headingEn: string;
  headingZh: string;
  paragraphsEn: readonly string[];
  paragraphsZh: readonly string[];
  /** Deck references shown as chips under the section. */
  refs: readonly string[];
}

export interface GuideThesis {
  titleEn: string;
  titleZh: string;
  bodyEn: string;
  bodyZh: string;
  refs: readonly string[];
}

export interface LibraryGuide {
  slug: string;
  titleEn: string;
  titleZh: string;
  standfirstEn: string;
  standfirstZh: string;
  sections: readonly GuideSection[];
  thesisHeadingEn: string;
  thesisHeadingZh: string;
  theses: readonly GuideThesis[];
  closingEn: readonly string[];
  closingZh: readonly string[];
  readingListHeadingEn: string;
  readingListHeadingZh: string;
  /** Topic page this guide belongs with, if any. */
  topicSlug?: string;
}

const CONVERGENCE_REFS = [
  'Genesis 2:15',
  'Genesis 1:26-28',
  'Exodus 31:1-5',
  'Ephesians 4:28',
  '1 Thessalonians 4:11-12',
  'James 5:1-6',
] as const;

const CORRECTION_REFS = [
  'Psalm 100:3',
  'Genesis 3:17-19',
  'Colossians 3:23-24',
  '1 Corinthians 10:31',
  'Micah 6:8',
  'Hebrews 4:9-10',
] as const;

export const WORK_GUIDE: LibraryGuide = {
  slug: 'work-and-calling',
  titleEn: 'Work and Calling: What Marx Got Right',
  titleZh: '工作与呼召：马克思说对了什么',
  standfirstEn:
    'Marx argued that free, creative work is what makes us human — that in making things we express ourselves and recognize ourselves. Scripture agrees more than you might expect, and then goes further. A reading guide on work, creativity, alienation, and rest.',
  standfirstZh:
    '马克思认为，自由而有创造性的劳动才是人之所以为人的本质——我们在制造事物时表达自己，也认出自己。圣经比想象中更同意这一点，然后又走得更远。这是一份关于工作、创造力、异化与安息的阅读指南。',
  sections: [
    {
      kickerEn: 'The claim',
      kickerZh: '问题的提出',
      headingEn: 'What makes work human?',
      headingZh: '什么使工作成为人的工作？',
      paragraphsEn: [
        'In the Economic and Philosophic Manuscripts of 1844, Marx describes human beings as species-beings whose distinguishing mark is free, conscious activity. An animal works by instinct; a person can make his own life activity the object of his will. Work is therefore not merely a means of survival but the place where someone pours himself into the world and sees himself reflected back: ‘the object of labour is therefore the objectification of man’s species-life.’',
        'When that mirror breaks — when the worker is separated from the product, from the process, from other people, and finally from his own capacities — Marx calls it alienation. The worker ‘does not affirm himself but denies himself.’ The diagnosis is sharp, and much of it is true. The question is whether the cure he proposes — humanity grounded in itself, labour become the meaning of life — can bear that weight.',
      ],
      paragraphsZh: [
        '在《1844年经济学哲学手稿》中，马克思把人描述为「类存在」，其标志是自由而有意识的活动。动物按本能劳作，人却能把自己的生命活动当作意志与意识的对象。因此，工作不只是谋生的手段，而是人把自己倾注进世界、又从世界中认出自己的地方：「劳动的对象因此就是人的类生活的对象化。」',
        '当这面镜子破碎——当工人与产品、与过程、与他人、最终与自己的能力相隔绝——马克思称之为异化。工人「不是肯定自己，而是否定自己」。这个诊断是锐利的，而且大部分是真实的。问题在于，他提出的解药——以人类自身为根基、让劳动成为生命的意义——能否承受这个重量。',
      ],
      refs: [],
    },
    {
      kickerEn: 'Convergence',
      kickerZh: '相通之处',
      headingEn: 'Where Scripture agrees',
      headingZh: '圣经同意的地方',
      paragraphsEn: [
        'Scripture does not treat work as a punishment. Before there is any sin, God places the man in the garden ‘to cultivate and keep it’ (Genesis 2:15). Work belongs to the creation order, not to the fall — which is exactly Marx’s instinct that work is essential to being human.',
        'The Bible grounds that instinct differently. Humans are made in the image of a working God (Genesis 1:26–28), and the first person in Scripture said to be filled with the Spirit is not a prophet or a priest but Bezalel, a craftsman called by name to design and build (Exodus 31:1–5). Creativity is not a rival to faith; it is one of its ordinary forms.',
        'Marx insisted that we are species-beings, not isolated individuals, and Scripture agrees: work is cooperative by design. Paul tells the thief to labour ‘so that he may have something to give to him who has need’ (Ephesians 4:28), and commends the quiet life of working with one’s own hands (1 Thessalonians 4:11–12). The purpose of work runs outward, toward the neighbour.',
        'And Marx’s anger at exploitation has a biblical analogue. James lets the withheld wages of the harvesters ‘cry out’ into the ears of the Lord of Armies (James 5:1–6). Scripture is not sentimental about labour; it hears the cry of the worker.',
      ],
      paragraphsZh: [
        '圣经并不把工作当作惩罚。在罪进入世界以前，神就把人安置在园中「修理，看守」（创世记 2:15）。工作属于创造的秩序，而不是堕落的后果——这正是马克思「工作对人本质重要」的直觉。',
        '但圣经给这个直觉一个不同的根基。人是照着一位工作的神的形像造的（创世记 1:26-28）；圣经中第一个被说成被圣灵充满的人，不是先知或祭司，而是比撒列——一个被点名呼召去设计、建造的工匠（出埃及记 31:1-5）。创造力不是信仰的对手，而是信仰寻常的形式之一。',
        '马克思坚持人是「类存在」，不是孤立的个体；圣经同意：工作按设计就是彼此配搭的。保罗劝勉从前偷窃的人劳力，「就可有余分给那缺少的人」（以弗所书 4:28），又称赞安静生活、亲手做工（帖撒罗尼迦前书 4:11-12）。工作的方向是向外的，朝着邻舍。',
        '而马克思对剥削的愤怒，在圣经里有对应。雅各让被亏欠的工钱「有声音呼叫」，进入万军之主的耳中（雅各书 5:1-6）。圣经对劳动并不感伤；它听见工人的呼声。',
      ],
      refs: CONVERGENCE_REFS,
    },
    {
      kickerEn: 'Correction',
      kickerZh: '需要更正之处',
      headingEn: 'Where Scripture answers back',
      headingZh: '圣经回应的地方',
      paragraphsEn: [
        'The first correction is anthropological. Marx’s human is self-grounding; the Bible’s human is a creature. ‘It is he who has made us, and we are his’ (Psalm 100:3). Work expresses the image of God; it does not constitute the person. Our worth is therefore received before it is produced — and the unemployed, the disabled, the retired, and the child are not less human for not working.',
        'The second correction concerns the root of alienation. Marx locates it in private property and the division of labour; Scripture locates it deeper, in sin and idolatry. The ground is cursed and work becomes toil (Genesis 3:17–19), but the problem is not only the system — it is the heart that turns work into an identity, a god, or a weapon. Structures matter and must be reformed; no reordering of labour, however just, removes the need for redemption.',
        'The third correction concerns freedom. Marx’s freedom is autonomy — freedom from external determination. Biblical freedom is freedom for love: work is rendered ‘as for the Lord’ (Colossians 3:23–24), done ‘to the glory of God’ (1 Corinthians 10:31), and measured by justice, mercy, and humility (Micah 6:8). Self-realization is not the goal; it is a by-product of faithfulness.',
        'The fourth correction is eschatological. Marx hoped that unalienated labour would bring salvation; Scripture sets a Sabbath limit around work and locates the end of history in God’s gift, not in our production. ‘There remains therefore a Sabbath rest for the people of God’ (Hebrews 4:9–10). Work is not the messiah.',
      ],
      paragraphsZh: [
        '第一个更正关于人论。马克思的人是自我奠基的；圣经的人是受造的。「我们是他造的，也是属他的」（诗篇 100:3）。工作表达神的形像，却不构成人；因此人的价值是先领受的，然后才谈得上产出——失业的、残障的、退休的、年幼的，并不因为不工作就少一分人性。',
        '第二个更正关于异化的根源。马克思把它定位在私有制与分工；圣经定位得更深——在罪与偶像崇拜。地受了咒诅，工作成为劳苦（创世记 3:17-19），但问题不只是制度，也是那颗把工作变成身份、偶像或武器的心。制度重要，也必须被更新；但任何劳动秩序的重整，都不能除去人对救赎的需要。',
        '第三个更正关于自由。马克思的自由是自主——脱离外在的决定。圣经的自由是为爱而有的自由：工作「像是给主做的」（歌罗西书 3:23-24），「为荣耀神而行」（哥林多前书 10:31），以公义、怜悯、谦卑为尺度（弥迦书 6:8）。自我实现不是目标，而是忠心的副产品。',
        '第四个更正关于终末。马克思盼望消除异化的劳动能带来拯救；圣经却用安息日为工作划界，并把历史的终点放在神的恩赐里，而不是我们的产出里。「必另有一安息日的安息为神的子民存留」（希伯来书 4:9-10）。工作不是弥赛亚。',
      ],
      refs: CORRECTION_REFS,
    },
  ],
  thesisHeadingEn: 'A way to hold it together',
  thesisHeadingZh: '如何把两者放在一起',
  theses: [
    {
      titleEn: 'Work is cooperation with the working God',
      titleZh: '工作是与工作的神同工',
      bodyEn:
        'Jesus said, ‘My Father is still working, so I am working, too’ (John 5:17). Human work is not self-creation but participation — a creaturely share in God’s ongoing care for the world. Marx’s ‘objectification’ becomes stewardship: we make things, and in making them we answer a calling that precedes us.',
      bodyZh:
        '耶稣说：「我父做事直到如今，我也做事」（约翰福音 5:17）。人的工作不是自我创造，而是参与——在受造的地位上分担神对世界持续的看顾。马克思的「对象化」在这里成为管家职分：我们制造事物，也在制造中回应一个先于我们的呼召。',
      refs: ['John 5:17'],
    },
    {
      titleEn: 'Dignity precedes productivity',
      titleZh: '尊严先于生产力',
      bodyEn:
        'Because we are image-bearers before we are workers, our value cannot be measured by output. The birds are fed and the lilies clothed (Matthew 6:26), and the Sabbath says: stop, and remember whose you are. This is the pastoral heart of the matter — and the reason the gospel can speak to the burned-out, the passed over, and the unemployed.',
      bodyZh:
        '因为我们在成为工作者以前就是形像的承载者，我们的价值不能被产量衡量。飞鸟被养活，百合被妆饰（马太福音 6:26）；安息日则说：停下来，记得你属于谁。这是整件事牧养性的核心——也是福音能对着耗尽的人、被忽略的人、失业的人说话的原因。',
      refs: ['Psalm 100:3', 'Genesis 1:26-28', 'Matthew 6:26'],
    },
    {
      titleEn: 'The goal of work is love, not self-realization',
      titleZh: '工作的目标是爱，不是自我实现',
      bodyEn:
        'Work is the ordinary place where love of neighbour takes material form: food grown, houses built, code written, patients cared for, children raised. ‘Whatever you do, work heartily, as for the Lord’ (Colossians 3:23–24). When love is the goal, self-realization arrives as a gift rather than a demand.',
      bodyZh:
        '工作是爱邻舍取得物质形式的寻常场所：种出的粮食、建起的房屋、写下的代码、照护的病人、养大的孩子。「无论做什么，都要从心里做，像是给主做的」（歌罗西书 3:23-24）。当爱是目标，自我实现就成了礼物，而不是要求。',
      refs: ['Colossians 3:23-24', 'Ephesians 4:28', 'Micah 6:8'],
    },
    {
      titleEn: 'Work is bounded by rest and completed by resurrection',
      titleZh: '工作以安息为界，以复活为终',
      bodyEn:
        'The week ends in Sabbath, and history ends in a city where the nations bring their glory in (Revelation 21:24–26). ‘Your labor is not in vain in the Lord’ (1 Corinthians 15:58) — not because work saves us, but because the resurrection vindicates it. Marx wanted alienation abolished; the gospel promises work healed, not abolished.',
      bodyZh:
        '一周以安息日结束，历史终结于一座城——列国把他们的荣耀带进去（启示录 21:24-26）。「你们的劳苦在主里面不是徒然的」（哥林多前书 15:58）——不是因为工作能拯救我们，而是因为复活为它作保。马克思想要废除异化；福音应许工作得医治，而不是被废除。',
      refs: ['Hebrews 4:9-10', '1 Corinthians 15:58', 'Revelation 21:24-26'],
    },
  ],
  closingEn: [
    'Put compactly: we are made for work, but not made by it. Marx is a superb diagnostician and a poor physician — right that alienated labour dehumanizes, wrong that unalienated labour divinizes. The biblical answer is not a better system alone, nor a private spirituality alone, but a redeemed worker: worth received, work offered as love, rest kept, and hope lodged in a resurrection rather than a revolution.',
    'Read these passages slowly. Let the ones that resist you be the ones you stay with.',
  ],
  closingZh: [
    '一句话：我们是为工作而被造的，却不是由工作造成的。马克思是极好的诊断者，却是糟糕的医生——他说对了异化的劳动使人失去人性，却说错了消除异化的劳动能使人成为神。圣经的答案不是单靠更好的制度，也不是单靠私人的灵修，而是一个被救赎的工作者：价值是领受的，工作是作为爱献上的，安息是守住的，盼望放在复活里，而不是革命里。',
    '读这些经文时慢一点。那些让你抗拒的，正是值得你停留的。',
  ],
  readingListHeadingEn: 'The passages in this guide',
  readingListHeadingZh: '本指南引用的经文',
  topicSlug: 'work',
};

/** Every deck reference the guide cites, in first-appearance order. */
export function guideRefs(guide: LibraryGuide = WORK_GUIDE): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  const add = (list: readonly string[]) => {
    for (const ref of list) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
  };
  for (const section of guide.sections) add(section.refs);
  for (const thesis of guide.theses) add(thesis.refs);
  return refs;
}
