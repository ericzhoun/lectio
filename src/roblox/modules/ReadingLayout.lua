local Layout={}
function Layout.forViewport(width,height)
    local compact=width<700 or height<500
    return {
        width=compact and 248 or 286,
        height=compact and 258 or 286,
        offsetX=compact and 2.7 or 3.6,
        offsetY=compact and 0.45 or 0.65,
        maxDistance=compact and 14 or 18,
        alwaysOnTop=false,
    }
end
return Layout
