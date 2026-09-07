-- Presentation content only. Fallback prompts are labeled, never passed off as AI interpretation.
local ReadingText={}
local function present(value)
    return type(value)=="string" and value:find("%S")~=nil
end
function ReadingText.build(reading,page,lang,scripture,view)
    local zh=lang=="zh"
    local verse=reading.verses[page]
    local reflection=verse.interp
    local reflectionTitle=zh and "默想" or "Reflection"
    if not present(reflection) then
        reflectionTitle=zh and "默想提示" or "Reflection prompt"
        reflection=zh and "再读一遍这段经文。哪个词句吸引了你？它与你今天的经历有什么联系？安静片刻，用自己的话回应。" or
            "Read this passage again. Which word or phrase stands out? How does it connect with your day? Pause, then respond in your own words."
    end
    local summary=reading.summary
    local summaryTitle=zh and "阅读小结" or "Reading summary"
    if not present(summary) then
        summaryTitle=zh and "阅读回顾" or "Reading recap"
        local references={}
        for _,v in ipairs(reading.verses) do
            local reference=zh and v.refZh or v.refEn
            if present(reference) then table.insert(references,reference) end
        end
        summary=(zh and "本次阅读：" or "Passages in this reading: ")..table.concat(references,zh and "、" or "; ")..
            (zh and "。\n\n回顾这些经文，选一句今天愿意记住的话，并想一想如何在生活中回应。" or
                ".\n\nLook back over these passages. Choose a phrase to carry with you today and consider one way to respond.")
    end
    if view=="reflection" then return {heading=reflectionTitle,body=reflection} end
    if view=="summary" then return {heading=summaryTitle,body=summary} end
    local body=(scripture or "").."\n\n"..reflectionTitle.."\n"..reflection
    if page==#reading.verses then body=body.."\n\n"..summaryTitle.."\n"..summary end
    return {heading=zh and "经文与默想 · 向下滚动" or "Scripture & reflection · scroll to read",body=body}
end
return ReadingText
