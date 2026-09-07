local Segments={}
function Segments.split(text,limit)
    limit=limit or 180
    local chars,parts={},{}
    for _,code in utf8.codes(text or "") do table.insert(chars,utf8.char(code)) end
    local start=1
    while start <= #chars do
        local last=math.min(start+limit-1,#chars)
        if last < #chars then
            for i=last,math.max(start,last-60),-1 do
                if chars[i]:match("[%s%.%!%?%;,]") or chars[i]=="。" or chars[i]=="，" or chars[i]=="；" then last=i; break end
            end
        end
        table.insert(parts,table.concat(chars,"",start,last))
        start=last+1
    end
    return parts
end
return Segments
