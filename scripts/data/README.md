# Vendored lectionary data

## `bcp-daily-office.json`

The Daily Office Lectionary of the 1979 US Book of Common Prayer (pp. 936-1001): a two-year daily
cycle of psalms, Old Testament, epistle and gospel readings.

- **Source:** <https://www.bcponline.org/DOLectionary/> (six season pages: Advent, Christmas,
  Epiphany, Lent, Easter, Pentecost)
- **Retrieved:** 2026-09-04
- **Terms:** The Episcopal Church has never claimed copyright in the Book of Common Prayer. The
  English text is in the public domain and freely reproducible.

Regenerate by running the fetcher, never by editing this file:

```bash
node scripts/fetch-bcp-lectionary.mjs
```

The fetcher reports any unexpected gap and exits non-zero, so a change at the source that breaks
parsing fails loudly rather than silently shipping a day with no readings.

### Why not the Revised Common Lectionary?

The design originally specified the RCL. It was rejected on inspection: the RCL tables are a
copyrighted compilation (Consultation on Common Texts / Augsburg Fortress, 2005). The Vanderbilt
Divinity Library, the usual online source, states plainly that it reproduces them "by permission" -
a permission this project does not hold, and one that would not obviously extend to a product with
paid tiers.

The BCP lectionary is the better choice on the merits as well: it is a genuine daily cycle, so every
day has its own readings, where the RCL's free tables are Sunday-centred.

### Shape

```jsonc
{
  "provenance": { "source": "...", "url": "...", "retrieved": "...", "terms": "..." },
  "weeks": {
    "proper17": {
      "label": "Proper 17",
      "placement": { "rule": "sundayClosestTo", "month": 8, "day": 31 },
      "1": { "sunday": { "psalmsMorning": "...", "psalmsEvening": "...",
                         "ot": "...", "epistle": "...", "gospel": "..." }, ... },
      "2": { ... }
    }
  },
  "dated": { "12-29": { ...readings } },
  "named": { "Christmas Day": { ...readings } }
}
```

`placement` rules, all parsed from the gloss the BCP prints beside each heading:

| Rule | Meaning |
|---|---|
| `sundayClosestTo` | The Propers, e.g. "Week of the Sunday closest to August 31" |
| `adventWeek` | Advent 1-4 |
| `epiphanyWeek` | Epiphany 1-8, and `"last"` for Last Epiphany |
| `lentWeek` | Lent 1-5 |
| `holyWeek` | Holy Week |
| `easterWeek` | Easter 1-7; "Easter Week" itself is week 1 |

In the Christmas and Epiphany seasons the BCP keys days by date rather than by weekday, and a few
weekdays are displaced by a named holy day (Christmas Eve, Ash Wednesday, Palm Sunday, the Triduum,
Easter Day, Ascension Day). Those readings live in `dated` and `named`; the generator layers them
over the weekly table. Propers 1 and 2 have no Sunday, because those Sundays fall before Pentecost.
