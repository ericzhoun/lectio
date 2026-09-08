-- The website's six movements, kept private and local to the current reading.
local Practice={order={"silencio","lectio","meditatio","oratio","contemplatio","actio"}}
local copy={
    silencio={"Stillness","静默","Be still. Let the noise settle before you read.","安静下来。在诵读之前，让心中的喧嚣沉淀。","prompt"},
    lectio={"Read","诵读","Read it slowly, twice. There is no hurry.","慢慢地读两遍。不用急。","scripture"},
    meditatio={"Reflect","默想","What word or phrase caught you?","哪一个词、哪一句话触动了你？","reflection"},
    oratio={"Respond","祈祷","What do you want to say to God about it? Respond quietly, in your own words.","关于这句话，你想对神说什么？安静地用自己的话回应。","prompt"},
    contemplatio={"Rest","默观","Nothing more to do now. Rest here a while.","现在无需再做什么。在这里安歇片刻。","prompt"},
    actio={"Carry into today","践行","One thing you will do today. Carry a phrase from this reading with you.","今天你要做的一件事。带着这次阅读中的一句话，走入今天。","summary"},
}
function Practice.get(key,lang)
    key=copy[key] and key or "lectio"
    local row=copy[key]
    local index=1
    for i,name in ipairs(Practice.order) do if name==key then index=i end end
    return {title=lang=="zh" and row[2] or row[1],prompt=lang=="zh" and row[4] or row[3],
        view=row[5],narrate=key=="lectio",index=index,key=key}
end
function Practice.next(key)
    for i,name in ipairs(Practice.order) do if name==key then return Practice.order[i+1] end end
end
return Practice
