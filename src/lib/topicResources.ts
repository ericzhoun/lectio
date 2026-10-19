// Curated external resources attached to a verse topic — rendered by
// TopicResourceSection.astro under the topic's verse grid.
//
// The first (and so far only) section integrates Called To Work
// (calledtowork.org, 职场使命) into the /topics/work page: a global workplace
// ministry founded in 1996 whose TGIM devotions and Theology of Work material
// pair naturally with the Work and Calling verses.
//
// Content policy — this file summarizes, it does not mirror:
//   - The intro is our own factual summary of their published history.
//   - Vision and mission are short attributed quotations, lightly trimmed,
//     linked to the source site.
//   - Theme lines are the TGIM devotion titles (short phrases), each linked to
//     the devotion post it comes from.
//   - Everything else is a link out. Called To Work's own pages are
//     copyrighted; the Theology of Work Project material they republish is
//     CC BY-NC 4.0 and stays on their site.
// Chinese links point at their zh_simp (simplified-Chinese) pages where those
// exist; every URL below was verified live (HTTP 200) on 2026-10-19. When a
// Chinese page does not exist, urlZh is omitted and Chinese readers fall back
// to the English page.

import type { Lang } from './reading';

export interface TopicResourceTheme {
  textEn: string;
  textZh: string;
  url: string;
  /** Simplified-Chinese page for the same theme; omit to use `url`. */
  urlZh?: string;
}

export interface TopicResourceLink {
  labelEn: string;
  labelZh: string;
  noteEn: string;
  noteZh: string;
  url: string;
  /** Simplified-Chinese page for the same resource; omit to use `url`. */
  urlZh?: string;
}

export interface TopicResources {
  topicSlug: string;
  headingEn: string;
  headingZh: string;
  orgNameEn: string;
  orgNameZh: string;
  orgTaglineEn: string;
  orgTaglineZh: string;
  orgUrl: string;
  orgUrlZh: string;
  introEn: readonly string[];
  introZh: readonly string[];
  visionEn: string;
  visionZh: string;
  missionEn: string;
  missionZh: string;
  themesTitleEn: string;
  themesTitleZh: string;
  themes: readonly TopicResourceTheme[];
  linksTitleEn: string;
  linksTitleZh: string;
  links: readonly TopicResourceLink[];
  attributionEn: string;
  attributionZh: string;
}

export const TOPIC_RESOURCES: Readonly<Record<string, TopicResources>> = {
  work: {
    topicSlug: 'work',
    headingEn: 'Going deeper: Called To Work',
    headingZh: '延伸探索：职场使命',
    orgNameEn: 'Called To Work',
    orgNameZh: '职场使命（Called To Work）',
    orgTaglineEn: 'A global workplace ministry since 1996',
    orgTaglineZh: '自 1996 年起的全球职场事工',
    orgUrl: 'https://www.calledtowork.org/',
    orgUrlZh: 'https://www.calledtowork.org/zh_simp/',
    introEn: [
      'Called To Work is a global workplace ministry founded in 1996. It began as an annual workplace-Christianity and professional-development conference hosted by Rutgers Community Christian Church in New Jersey, and is led today by co-founder Elaine Kung and co-chair Drew Crandall, reaching workplaces from coast to coast and around the world.',
      'The name comes from Karen Johnson Moy’s 1996 keynote of the same title, and its conviction is worth carrying into any workweek: every Christian has a divine calling — not only pastors, teachers, and missionaries. Many are called to work in business, non-profits, institutions, and government.',
    ],
    introZh: [
      '「职场使命」（Called To Work）成立于 1996 年，是一个总部位于美国的全球性职场事工。它最初是新泽西州若歌教会（Rutgers Community Christian Church）举办的年度职场信仰与专业发展大会，如今由联合创办人孔雷汉卿（Elaine Kung）与联席主席 Drew Crandall 带领，服事的足迹遍及美国东西两岸和世界各地。',
      '事工的名称出自 Karen Johnson Moy 1996 年的同名主题讲道，其中的信念值得带进每一个工作周：每一位基督徒都领受了属天的呼召——不只有牧师、教师与宣教士；许多人蒙召进入商业、非营利机构、学校与政府工作。',
    ],
    visionEn:
      '“Advance God’s kingdom in the workplace around the world through Discipleship and Evangelism of working Christians as Spirit-filled Ambassadors for Christ in their everyday lives.”',
    visionZh:
      '「通过对职场基督徒的门徒训练和传福音，建造他们在日常生活中成为『被圣灵充满的基督使者』，在世界各地的工作场所扩展神的国度。」',
    missionEn:
      'Encourage workers · Equip leaders and organizations · Expand workplace-ministry partnerships and networks',
    missionZh: '鼓励职场信徒 · 装备领袖与机构 · 拓展职场事工的伙伴与网络',
    themesTitleEn: 'Themes from their TGIM workplace devotions',
    themesTitleZh: '来自 TGIM 职场灵修系列的默想主题',
    themes: [
      {
        textEn: 'Work is a blessing, not a curse',
        textZh: '工作乃是祝福，不是诅咒',
        url: 'https://www.calledtowork.org/work-is-a-blessing-not-a-curse/',
        urlZh: 'https://www.calledtowork.org/%e5%b7%a5%e4%bd%9c%e4%b9%83%e6%98%af%e7%a5%9d%e7%a6%8f-%e5%b7%a5%e4%bd%9c%e4%b8%8d%e6%98%af%e8%af%85%e5%92%92%e3%80%82/',
      },
      {
        textEn: 'Thank God it’s Monday — bridge the Sunday gap to Monday',
        textZh: '感谢神，星期一又到了！除去主日与周一的分割',
        url: 'https://www.calledtowork.org/thank-god-its-monday-bridge-the-sunday-gap-to-monday/',
        urlZh: 'https://www.calledtowork.org/%e6%84%9f%e8%b0%a2%e7%a5%9e-%e6%98%9f%e6%9c%9f%e4%b8%80%e5%8f%88%e5%88%b0%e4%ba%86-%e9%99%a4%e5%8e%bb-%e4%b8%bb%e6%97%a5%e4%b8%8e%e5%91%a8%e4%b8%80-%e7%9a%84%e5%88%86%e5%89%b2%e3%80%82/',
      },
      {
        textEn: 'Bridge the sacred–secular divide',
        textZh: '打破圣与俗的隔阂',
        url: 'https://www.calledtowork.org/bridge-the-sacred-and-secular-divide/',
      },
      {
        textEn: 'Work is a ministry, not just a job',
        textZh: '工作是事工，不只是一份职业',
        url: 'https://www.calledtowork.org/work-is-a-ministry-not-just-a-job/',
        urlZh: 'https://www.calledtowork.org/%e4%ba%8b%e6%a5%ad-vocation-%e5%b7%a5%e4%bd%9c-job-ministry-%e4%ba%8b%e5%b7%a5/',
      },
      {
        textEn: 'Work as worship — work is more than a paycheck',
        textZh: '工作即敬拜——工作不只是一份薪水',
        url: 'https://www.calledtowork.org/work-as-worship-work-is-more-than-a-paycheck/',
      },
      {
        textEn: 'Receive God’s blessings and be a blessing at work',
        textZh: '在职场领受上帝的祝福，也成为职场的祝福',
        url: 'https://www.calledtowork.org/receive-blessings-from-god-and-be-a-blessing-at-work/',
        urlZh: 'https://www.calledtowork.org/%e5%9c%a8%e5%b7%a5%e5%9c%ba%e9%a2%86%e5%8f%97%e4%b8%8a%e5%b8%9d%e7%9a%84%e7%a5%9d%e7%a6%8f%ef%bc%8c%e8%ae%a9%e8%87%aa%e5%b7%b1%e6%88%90%e4%b8%ba%e5%b7%a5%e5%9c%ba%e7%9a%84%e7%a5%9d%e7%a6%8f%e3%80%82/',
      },
      {
        textEn: 'Keep an empty seat for Jesus at work',
        textZh: '在办公室为耶稣留个座位',
        url: 'https://www.calledtowork.org/keep-an-empty-seat-for-jesus-at-work-a-reminder-to-invite-jesus-to-intervene-integrate-our-faith-at-work/',
        urlZh: 'https://www.calledtowork.org/%e5%9c%a8%e5%8a%9e%e5%85%ac%e5%ae%a4%e4%b8%ba%e8%80%b6%e7%a8%a3%e7%95%99%e4%b8%aa%e5%ba%a7%e4%bd%8d-%e9%82%80%e8%af%b7%e8%80%b6%e7%a8%a3%e4%bb%8b%e5%85%a5%ef%bc%8c%e5%9c%a8%e5%b7%a5%e4%bd%9c/',
      },
      {
        textEn: 'Take Jesus to work — don’t leave him at home',
        textZh: '带耶稣去工作——别把耶稣留在家里',
        url: 'https://www.calledtowork.org/take-jesus-to-work-dont-leave-jesus-at-home/',
        urlZh: 'https://www.calledtowork.org/%e5%b8%a6%e8%80%b6%e7%a8%a3%e5%8e%bb%e5%b7%a5%e4%bd%9c-%e5%88%ab%e6%8a%8a%e8%80%b6%e7%a8%a3%e7%95%99%e5%9c%a8%e5%ae%b6%e9%87%8c%e3%80%82%e4%b8%8d%e8%a6%81%e6%8a%8a%e8%80%b6%e7%a8%a3%e9%94%81/',
      },
      {
        textEn: 'God’s 5P blessings: Presence, Power, Promises, Provisions, Pleasant surprises',
        textZh: '上帝的 5P 祝福：同在、能力、应许、供应、惊喜',
        url: 'https://www.calledtowork.org/embrace-and-enjoy-our-work-with-gods-5p-blessings-his-presence-power-promises-provisions-pleasant-surprises/',
        urlZh: 'https://www.calledtowork.org/%e4%bb%a5%e4%b8%8a%e5%b8%9d%e7%9a%84-5p-%e7%a5%9d%e7%a6%8f%e6%8b%a5%e6%8a%b1%e5%b9%b6%e4%ba%ab%e5%8f%97%e6%88%91%e4%bb%ac%e7%9a%84%e5%b7%a5%e4%bd%9c-%e7%a5%9e%e7%9a%84-%e5%90%8c%e5%9c%a8-%e8%83%bd/',
      },
    ],
    linksTitleEn: 'Explore their resources',
    linksTitleZh: '探索职场使命的资源',
    links: [
      {
        labelEn: 'Devotions & Prayers',
        labelZh: '灵修和祷告',
        noteEn: 'Weekly TGIM workplace devotions and daily workplace prayer models',
        noteZh: '每周 TGIM 职场灵修系列与职场祷告模型',
        url: 'https://www.calledtowork.org/devotions-and-prayers/',
        urlZh: 'https://www.calledtowork.org/chinese_devotion_prayers/',
      },
      {
        labelEn: 'Theology of Work: Work Through the Whole Bible',
        labelZh: '工作神学：尽览圣经职场行灵修系列',
        noteEn: 'A devotional journey from Genesis to Revelation, by the Theology of Work Project',
        noteZh: '由工作神学项目（Theology of Work Project）编写、从创世记读到启示录的职场灵修系列',
        url: 'https://www.calledtowork.org/theology-of-work-work-through-the-whole-bible-devotional/',
        urlZh: 'https://www.calledtowork.org/%e5%b7%a5%e4%bd%9c%e7%a5%9e%e5%ad%a6-%e5%b0%bd%e8%a7%88%e5%9c%a3%e7%bb%8f%e8%81%8c%e5%9c%ba%e8%a1%8c-%e7%81%b5%e4%bf%ae%e7%b3%bb%e5%88%97/',
      },
      {
        labelEn: 'Theology of Work on YouVersion',
        labelZh: '工作神学：YouVersion 灵修系列',
        noteEn: 'Work-themed devotional plans in the YouVersion Bible app',
        noteZh: 'YouVersion 圣经 App 中的职场灵修计划',
        url: 'https://www.calledtowork.org/encourage/theology-of-work-youversion-devotions/',
        urlZh: 'https://www.calledtowork.org/%e9%bc%93%e5%8a%b1-2/%e5%b7%a5%e4%bd%9c%e7%a5%9e%e5%ad%a6%ef%bc%9ayouversion-%e7%81%b5%e4%bf%ae%e7%b3%bb%e5%88%97/',
      },
      {
        labelEn: 'Public Reading of Scripture — video series',
        labelZh: '工作神学：宣读圣经职场行视频系列',
        noteEn: 'Scripture read aloud over workplace imagery',
        noteZh: '以职场画面配搭圣经诵读的视频系列',
        url: 'https://www.calledtowork.org/theology-of-work-public-reading-of-scripture-video-series/',
        urlZh: 'https://www.calledtowork.org/%e5%b7%a5%e4%bd%9c%e7%a5%9e%e5%ad%b8-%e5%85%ac%e8%ae%80%e8%81%96%e7%b6%93%e8%81%b7%e5%a0%b4%e8%a1%8c-%e8%a6%96%e9%a0%bb%e7%b3%bb%e5%88%97-2/',
      },
      {
        labelEn: 'GoodTV interview: The Best of All Worlds',
        labelZh: 'GoodTV 专访：孔雷汉卿的三全其美',
        noteEn: 'Co-founder Elaine Kung’s story of faith at work',
        noteZh: '联合创办人孔雷汉卿（Elaine Kung）的职场信仰故事',
        url: 'https://youtu.be/9ejC6DiX-g8',
      },
      {
        labelEn: 'Theology of Work Project',
        labelZh: '工作神学项目',
        noteEn: 'The deepest and most trusted biblical resource on faith and work',
        noteZh: '关于信仰与工作最深入、最可信的圣经资源',
        url: 'https://www.theologyofwork.org/',
      },
    ],
    attributionEn: 'Summarized and quoted from calledtowork.org, with gratitude to Called To Work.',
    attributionZh: '内容摘译自 calledtowork.org（职场使命），谨此致谢。',
  },
};

/** Resources attached to a topic slug, or null when the topic has none. */
export function getTopicResources(slug: string): TopicResources | null {
  return TOPIC_RESOURCES[slug] ?? null;
}

/** Pick the URL for a reader's language: the Chinese page when one exists. */
export function linkHref(link: { url: string; urlZh?: string }, lang: Lang): string {
  return lang === 'zh' && link.urlZh ? link.urlZh : link.url;
}
