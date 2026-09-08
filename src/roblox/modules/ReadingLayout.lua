-- Screen-space placement keeps the physical encounter visible at every camera angle.
local Layout={}
local function overlaps(a,b)
    return a.x<b.x+b.width and b.x<a.x+a.width and a.y<b.y+b.height and b.y<a.y+a.height
end
function Layout.place(width,height,protected,previousEdge)
    local margin,top=12,48
    local function choose(w,h,collapsed,compact)
        local left,right=margin,width-margin-w
        local upper,lower=top,height-margin-h
        if right<left or lower<upper then return end
        local centerX=(width-w)/2
        local centerY=math.max(upper,math.min(lower,(height-h)/2))
        local candidates={
            {edge="right",x=right,y=centerY},{edge="left",x=left,y=centerY},
            {edge="top",x=centerX,y=upper},{edge="bottom",x=centerX,y=lower},
            {edge="top-right",x=right,y=upper},{edge="top-left",x=left,y=upper},
            {edge="bottom-right",x=right,y=lower},{edge="bottom-left",x=left,y=lower},
        }
        local function safe(c)
            c.width=w; c.height=h; c.collapsed=collapsed; c.compact=compact or false; c.visible=true
            c.bodyHeight=collapsed and 0 or h-(compact and 144 or 220)
            for _,rect in ipairs(protected or {}) do if overlaps(c,rect) then return false end end
            return true
        end
        for _,c in ipairs(candidates) do if c.edge==previousEdge and safe(c) then return c end end
        for _,c in ipairs(candidates) do if safe(c) then return c end end
    end
    local w=math.min(320,width-24)
    local h=math.min(430,height-72)
    local full=h>=316 and choose(w,h,false)
    if full then return full end
    local compact=choose(math.min(280,width-24),240,false,true)
    if compact then return compact end
    return choose(math.min(260,width-24),48,true) or {visible=false,collapsed=true,bodyHeight=0}
end
return Layout
